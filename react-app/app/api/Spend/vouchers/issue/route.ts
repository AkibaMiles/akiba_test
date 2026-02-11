import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  recoverMessageAddress,
  type Address,
} from "viem";
import { celo } from "viem/chains";
import minimilesAbi from "@/contexts/minimiles.json";
import { safeBurnMiniPoints, safeMintRefund } from "@/lib/minipoints";
import { supabase } from "@/lib/supabaseClient";
import {
  buildVoucherIssueMessage,
  isFreshVoucherProofTimestamp,
} from "@/lib/voucherIssueAuth";

type IssuePayload = {
  merchant_id?: string;
  voucher_template_id?: string;
  user_address?: string;
  idempotency_key?: string;
  proof?: {
    address?: string;
    timestamp?: number;
    nonce?: string;
    signature?: string;
  };
};

type TemplateRow = {
  id: string;
  merchant_id: string;
  title: string;
  miles_cost: number;
  active: boolean;
  expires_at: string | null;
  cooldown_seconds: number | null;
  global_cap: number | null;
  rules: unknown;
};

type IssuedVoucherRow = {
  created_at: string;
};

type IdempotencyCacheEntry = {
  timestamp: number;
  response: {
    voucher_code: string;
    qr_payload: string;
    expires_at: string;
    rules_snapshot: string[];
    burn_tx_hash: string;
  };
};

type RateLimitEntry = {
  windowStart: number;
  count: number;
};

const MILES_TOKEN_ADDRESS = (process.env.MINIPOINTS_ADDRESS ??
  "0xEeD878017f027FE96316007D0ca5fDA58Ee93a6b") as Address;

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 8;
const ISSUE_LOCK_TTL_MS = 30_000;

const publicClient = createPublicClient({
  chain: celo,
  transport: http(),
});

const issueLocks: Map<string, number> =
  (globalThis as any).__akibaVoucherIssueLocks ??
  ((globalThis as any).__akibaVoucherIssueLocks = new Map<string, number>());
const issueRateLimit: Map<string, RateLimitEntry> =
  (globalThis as any).__akibaVoucherIssueRateLimit ??
  ((globalThis as any).__akibaVoucherIssueRateLimit = new Map<string, RateLimitEntry>());

function asRulesSnapshot(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function makeVoucherCode() {
  const stamp = Date.now().toString(36).toUpperCase();
  const suffix = randomUUID().split("-")[0].toUpperCase();
  return `AKB-${stamp}-${suffix}`;
}

function resolveAddress(req: Request, body: any): Address | null {
  const fromBody = body?.user_address;
  const fromHeader =
    req.headers.get("x-user-address") ?? req.headers.get("x-wallet-address");

  const candidate =
    typeof fromBody === "string" && fromBody.trim()
      ? fromBody.trim()
      : fromHeader?.trim();

  if (!candidate || !isAddress(candidate)) return null;
  return getAddress(candidate);
}

function makeIssueKey(userAddress: string, merchantId: string, templateId: string) {
  return `${userAddress.toLowerCase()}::${merchantId}::${templateId}`;
}

function rateLimitCheck(userAddress: string) {
  const key = userAddress.toLowerCase();
  const now = Date.now();
  const entry = issueRateLimit.get(key);

  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    issueRateLimit.set(key, { windowStart: now, count: 1 });
    return null;
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return NextResponse.json(
      { error: "Too many voucher requests. Try again shortly." },
      { status: 429 }
    );
  }

  entry.count += 1;
  issueRateLimit.set(key, entry);
  return null;
}

function cleanupCaches() {
  const now = Date.now();
  for (const [key, value] of issueLocks.entries()) {
    if (now - value > ISSUE_LOCK_TTL_MS) issueLocks.delete(key);
  }
  for (const [key, value] of issueRateLimit.entries()) {
    if (now - value.windowStart > RATE_LIMIT_WINDOW_MS * 2) issueRateLimit.delete(key);
  }
}

export async function POST(req: Request) {
  cleanupCaches();

  let payload: IssuePayload;

  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const merchantId = String(payload?.merchant_id ?? "").trim();
  const templateId = String(payload?.voucher_template_id ?? "").trim();

  if (!merchantId || !templateId) {
    return NextResponse.json(
      { error: "merchant_id and voucher_template_id are required" },
      { status: 400 }
    );
  }

  const proof = payload?.proof;
  const proofAddress = typeof proof?.address === "string" ? proof.address.trim() : "";
  const proofTimestamp = Number(proof?.timestamp);
  const proofNonce = typeof proof?.nonce === "string" ? proof.nonce.trim() : "";
  const proofSignature =
    typeof proof?.signature === "string" ? proof.signature.trim() : "";

  if (
    !proofAddress ||
    !isAddress(proofAddress) ||
    !proofSignature ||
    !/^0x[a-fA-F0-9]{130}$/.test(proofSignature) ||
    !proofNonce ||
    proofNonce.length < 8 ||
    !isFreshVoucherProofTimestamp(proofTimestamp)
  ) {
    return NextResponse.json(
      { error: "Invalid or expired wallet proof" },
      { status: 401 }
    );
  }

  const fallbackAddress = resolveAddress(req, payload);
  const normalizedProofAddress = getAddress(proofAddress);

  if (fallbackAddress && fallbackAddress.toLowerCase() !== normalizedProofAddress.toLowerCase()) {
    return NextResponse.json(
      { error: "Address mismatch between proof and request header/body" },
      { status: 401 }
    );
  }

  try {
    const message = buildVoucherIssueMessage({
      address: normalizedProofAddress as `0x${string}`,
      merchant_id: merchantId,
      voucher_template_id: templateId,
      timestamp: proofTimestamp,
      nonce: proofNonce,
    });

    const recovered = await recoverMessageAddress({
      message,
      signature: proofSignature as `0x${string}`,
    });

    if (recovered.toLowerCase() !== normalizedProofAddress.toLowerCase()) {
      return NextResponse.json({ error: "Invalid wallet signature" }, { status: 401 });
    }

    const userAddress = normalizedProofAddress;
    const userAddressLower = userAddress.toLowerCase();
    const idempotencyKey = String(
      payload?.idempotency_key ?? req.headers.get("x-idempotency-key") ?? ""
    ).trim();
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      return NextResponse.json(
        { error: "Valid idempotency_key is required" },
        { status: 400 }
      );
    }

    // DB-backed replay protection for signed nonces
    const { error: nonceErr } = await supabase.from("voucher_issue_nonces").insert({
      user_address: userAddressLower,
      nonce: proofNonce,
    });

    if (nonceErr) {
      const msg = String((nonceErr as any)?.message ?? "");
      const duplicate =
        (nonceErr as any)?.code === "23505" ||
        msg.toLowerCase().includes("duplicate key");
      if (duplicate) {
        return NextResponse.json(
          { error: "Proof nonce already used (replay detected)" },
          { status: 409 }
        );
      }
      console.error("[issue voucher] nonce insert failed:", nonceErr);
      return NextResponse.json({ error: "Failed nonce validation" }, { status: 500 });
    }

    const issueKey = makeIssueKey(userAddressLower, merchantId, templateId);

    // DB-backed idempotency check
    const { data: existingForIdempotency, error: existingErr } = await supabase
      .from("issued_vouchers")
      .select(
        "code, qr_payload, expires_at, rules_snapshot, burn_tx_hash, idempotency_key"
      )
      .eq("user_address", userAddressLower)
      .eq("voucher_template_id", templateId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existingErr) {
      console.error("[issue voucher] idempotency lookup failed:", existingErr);
      return NextResponse.json({ error: "Failed idempotency validation" }, { status: 500 });
    }

    if (existingForIdempotency) {
      return NextResponse.json({
        voucher_code: (existingForIdempotency as any).code,
        qr_payload: (existingForIdempotency as any).qr_payload,
        expires_at: (existingForIdempotency as any).expires_at,
        rules_snapshot: ((existingForIdempotency as any).rules_snapshot ?? []) as string[],
        burn_tx_hash: (existingForIdempotency as any).burn_tx_hash,
      });
    }

    const limited = rateLimitCheck(userAddressLower);
    if (limited) return limited;

    if (issueLocks.has(issueKey)) {
      return NextResponse.json(
        { error: "A voucher issue is already in progress for this template." },
        { status: 429 }
      );
    }

    issueLocks.set(issueKey, Date.now());

    const { data: template, error: templateErr } = await supabase
      .from("spend_voucher_templates")
      .select(
        "id, merchant_id, title, miles_cost, active, expires_at, cooldown_seconds, global_cap, rules"
      )
      .eq("id", templateId)
      .eq("merchant_id", merchantId)
      .maybeSingle();

    if (templateErr || !template) {
      return NextResponse.json({ error: "Voucher template not found" }, { status: 404 });
    }

    const voucherTemplate = template as TemplateRow;

    if (!voucherTemplate.active) {
      return NextResponse.json({ error: "Voucher template is inactive" }, { status: 409 });
    }

    if (
      voucherTemplate.expires_at &&
      new Date(voucherTemplate.expires_at).getTime() <= Date.now()
    ) {
      return NextResponse.json({ error: "Voucher template has expired" }, { status: 409 });
    }

    if (voucherTemplate.cooldown_seconds && voucherTemplate.cooldown_seconds > 0) {
      const { data: recentVoucher, error: cooldownErr } = await supabase
        .from("issued_vouchers")
        .select("created_at, status")
        .eq("voucher_template_id", templateId)
        .eq("user_address", userAddressLower)
        .in("status", ["issued", "redeemed"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cooldownErr) {
        console.error("[issue voucher] cooldown query failed:", cooldownErr);
        return NextResponse.json({ error: "Failed cooldown validation" }, { status: 500 });
      }

      if (recentVoucher) {
        const lastIssuedAt = new Date((recentVoucher as IssuedVoucherRow).created_at).getTime();
        const cooldownEnd = lastIssuedAt + voucherTemplate.cooldown_seconds * 1000;
        if (Date.now() < cooldownEnd) {
          return NextResponse.json(
            {
              error: "Per-user cooldown active",
              next_eligible_at: new Date(cooldownEnd).toISOString(),
            },
            { status: 429 }
          );
        }
      }
    }

    if (voucherTemplate.global_cap && voucherTemplate.global_cap > 0) {
      const { count, error: capErr } = await supabase
        .from("issued_vouchers")
        .select("id", { count: "exact", head: true })
        .eq("voucher_template_id", templateId)
        .in("status", ["issued", "redeemed"]);

      if (capErr) {
        console.error("[issue voucher] cap query failed:", capErr);
        return NextResponse.json({ error: "Failed cap validation" }, { status: 500 });
      }

      if ((count ?? 0) >= voucherTemplate.global_cap) {
        return NextResponse.json({ error: "Voucher cap reached" }, { status: 409 });
      }
    }

    const rawBalance = (await publicClient.readContract({
      address: MILES_TOKEN_ADDRESS,
      abi: minimilesAbi.abi,
      functionName: "balanceOf",
      args: [userAddress],
    })) as bigint;

    const required = BigInt(voucherTemplate.miles_cost);

    if (rawBalance < required * 10n ** 18n) {
      return NextResponse.json(
        { error: "Insufficient miles balance" },
        { status: 400 }
      );
    }

    const burnTxHash = await safeBurnMiniPoints({
      from: userAddress as `0x${string}`,
      points: voucherTemplate.miles_cost,
      reason: `voucher:${templateId}`,
    });

    const rulesSnapshot = asRulesSnapshot(voucherTemplate.rules);
    const voucherCode = makeVoucherCode();

    const expiresAt = voucherTemplate.expires_at
      ? new Date(voucherTemplate.expires_at).toISOString()
      : new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();

    const qrPayload = JSON.stringify({
      type: "merchant_voucher",
      code: voucherCode,
      merchant_id: merchantId,
      voucher_template_id: templateId,
      user_address: userAddress.toLowerCase(),
      expires_at: expiresAt,
    });

    const { error: insertErr } = await supabase.from("issued_vouchers").insert({
      merchant_id: merchantId,
      voucher_template_id: templateId,
      user_address: userAddressLower,
      code: voucherCode,
      qr_payload: qrPayload,
      expires_at: expiresAt,
      burn_tx_hash: burnTxHash,
      rules_snapshot: rulesSnapshot,
      status: "issued",
      idempotency_key: idempotencyKey,
    });

    if (insertErr) {
      console.error("[issue voucher] insert failed:", insertErr);

      // Handle duplicate idempotency conflict by returning existing voucher.
      const insertMsg = String((insertErr as any)?.message ?? "").toLowerCase();
      if ((insertErr as any)?.code === "23505" || insertMsg.includes("duplicate key")) {
        const { data: existingAfterConflict } = await supabase
          .from("issued_vouchers")
          .select("code, qr_payload, expires_at, rules_snapshot, burn_tx_hash")
          .eq("user_address", userAddressLower)
          .eq("voucher_template_id", templateId)
          .eq("idempotency_key", idempotencyKey)
          .maybeSingle();

        if (existingAfterConflict) {
          return NextResponse.json({
            voucher_code: (existingAfterConflict as any).code,
            qr_payload: (existingAfterConflict as any).qr_payload,
            expires_at: (existingAfterConflict as any).expires_at,
            rules_snapshot: ((existingAfterConflict as any).rules_snapshot ?? []) as string[],
            burn_tx_hash: (existingAfterConflict as any).burn_tx_hash,
          });
        }
      }

      let refundTxHash: string | null = null;
      try {
        refundTxHash = await safeMintRefund({
          to: userAddress as `0x${string}`,
          points: voucherTemplate.miles_cost,
          reason: `voucher-compensation:${templateId}`,
        });
      } catch (refundErr) {
        console.error("[issue voucher] compensation mint failed:", refundErr);
      }

      // Best-effort audit trail row when issue failed after burn.
      // If a row with this code cannot be inserted, we still return both hashes.
      try {
        await supabase.from("issued_vouchers").insert({
          merchant_id: merchantId,
          voucher_template_id: templateId,
          user_address: userAddressLower,
          code: `${voucherCode}-ERR`,
          qr_payload: qrPayload,
          expires_at: expiresAt,
          burn_tx_hash: burnTxHash,
          refund_tx_hash: refundTxHash,
          issue_error: String((insertErr as any)?.message ?? "insert failed"),
          rules_snapshot: rulesSnapshot,
          status: "void",
          idempotency_key: idempotencyKey,
        });
      } catch {
        // keep response-level visibility if audit write fails
      }

      return NextResponse.json(
        {
          error: "Voucher burn succeeded, but issuing record failed",
          burn_tx_hash: burnTxHash,
          refund_tx_hash: refundTxHash,
        },
        { status: 500 }
      );
    }

    const response = {
      voucher_code: voucherCode,
      qr_payload: qrPayload,
      expires_at: expiresAt,
      rules_snapshot: rulesSnapshot,
      burn_tx_hash: burnTxHash,
    };

    issueLocks.delete(issueKey);
    return NextResponse.json(response);
  } catch (error: any) {
    console.error("[POST /api/spend/vouchers/issue] error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Failed to issue voucher" },
      { status: 500 }
    );
  } finally {
    const fallbackAddress = resolveAddress(req, payload);
    const proofAddressSafe =
      typeof payload?.proof?.address === "string" && isAddress(payload.proof.address)
        ? getAddress(payload.proof.address).toLowerCase()
        : fallbackAddress?.toLowerCase() ?? null;

    if (proofAddressSafe) {
      const issueKey = makeIssueKey(proofAddressSafe, merchantId, templateId);
      issueLocks.delete(issueKey);
    }
  }
}
