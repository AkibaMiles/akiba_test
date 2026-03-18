/**
 * POST /api/claw/vouchers/redeem
 *
 * Called by merchant systems after scanning a claw-game voucher QR code.
 * Validates the voucher on-chain, confirms the merchant exists in the system,
 * then calls markRedeemed() via the admin wallet.
 *
 * Claw vouchers issued with merchantId == bytes32(0) are universal —
 * any merchant in the partners table can redeem them.
 */

import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, zeroHash } from "viem";
import { celo } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { supabase } from "@/lib/supabaseClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VOUCHER_REGISTRY_ADDRESS = (process.env.NEXT_PUBLIC_VOUCHER_REGISTRY_ADDRESS ?? "") as `0x${string}`;
const CELO_RPC_URL = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const ADMIN_PK = process.env.PRIVATE_KEY;

const voucherRegistryAbi = [
  {
    name: "getVoucher",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "voucherId", type: "uint256" }],
    outputs: [{
      name: "",
      type: "tuple",
      components: [
        { name: "voucherId",   type: "uint256" },
        { name: "owner",       type: "address" },
        { name: "tierId",      type: "uint8"   },
        { name: "rewardClass", type: "uint8"   },
        { name: "discountBps", type: "uint16"  },
        { name: "maxValue",    type: "uint256" },
        { name: "expiresAt",   type: "uint256" },
        { name: "redeemed",    type: "bool"    },
        { name: "burned",      type: "bool"    },
        { name: "merchantId",  type: "bytes32" },
      ],
    }],
  },
  {
    name: "isValid",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "voucherId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "markRedeemed",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "voucherId", type: "uint256" }],
    outputs: [],
  },
] as const;

export async function POST(req: Request) {
  if (!VOUCHER_REGISTRY_ADDRESS) {
    return NextResponse.json({ error: "Voucher registry not configured" }, { status: 500 });
  }
  if (!ADMIN_PK) {
    return NextResponse.json({ error: "Admin key not configured" }, { status: 500 });
  }

  let body: { voucherId?: string; merchantId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { voucherId: voucherIdStr, merchantId } = body ?? {};

  if (!voucherIdStr || !/^\d+$/.test(voucherIdStr)) {
    return NextResponse.json({ error: "voucherId must be a numeric string" }, { status: 400 });
  }
  if (!merchantId || !UUID_RE.test(merchantId)) {
    return NextResponse.json({ error: "merchantId must be a valid UUID" }, { status: 400 });
  }

  // Confirm merchant exists in the system
  const { data: merchant, error: merchantErr } = await supabase
    .from("partners")
    .select("id, name")
    .eq("id", merchantId)
    .maybeSingle();

  if (merchantErr || !merchant) {
    return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
  }

  const voucherId = BigInt(voucherIdStr);
  const publicClient = createPublicClient({ chain: celo, transport: http(CELO_RPC_URL) });

  // Check on-chain validity (covers expired / burned / already redeemed)
  const valid = await publicClient.readContract({
    address: VOUCHER_REGISTRY_ADDRESS,
    abi: voucherRegistryAbi,
    functionName: "isValid",
    args: [voucherId],
  });

  if (!valid) {
    return NextResponse.json(
      { error: "Voucher is expired, already redeemed, or burned" },
      { status: 409 },
    );
  }

  // Read full voucher to check merchantId binding
  const voucher = await publicClient.readContract({
    address: VOUCHER_REGISTRY_ADDRESS,
    abi: voucherRegistryAbi,
    functionName: "getVoucher",
    args: [voucherId],
  }) as {
    voucherId: bigint;
    owner: `0x${string}`;
    tierId: number;
    rewardClass: number;
    discountBps: number;
    maxValue: bigint;
    expiresAt: bigint;
    redeemed: boolean;
    burned: boolean;
    merchantId: `0x${string}`;
  };

  // bytes32(0) = universal — any merchant can redeem.
  // Non-zero merchantId = reserved for a specific merchant (future use).
  if (voucher.merchantId !== zeroHash) {
    return NextResponse.json(
      { error: "Voucher is not valid for this merchant" },
      { status: 409 },
    );
  }

  // Call markRedeemed via admin wallet
  const adminAccount = privateKeyToAccount(`0x${ADMIN_PK}`);
  const adminWallet = createWalletClient({
    chain: celo,
    transport: http(CELO_RPC_URL),
    account: adminAccount,
  });

  const txHash = await adminWallet.writeContract({
    address: VOUCHER_REGISTRY_ADDRESS,
    abi: voucherRegistryAbi,
    functionName: "markRedeemed",
    args: [voucherId],
    account: adminAccount,
  });

  await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });

  return NextResponse.json({
    ok: true,
    voucherId: voucherIdStr,
    merchantName: (merchant as { name: string }).name,
    discountBps: voucher.discountBps,
    txHash,
  });
}
