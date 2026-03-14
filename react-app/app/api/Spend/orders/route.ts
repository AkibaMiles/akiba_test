import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import {
  createPublicClient,
  decodeEventLog,
  erc20Abi,
  getAddress,
  http,
  isAddress,
  isAddressEqual,
  parseUnits,
  type Address,
  type Hash,
} from "viem";
import { celo } from "viem/chains";
import { supabase } from "@/lib/supabaseClient";
import { sendTelegramMessage } from "@/lib/telegram";
import {
  MAX_FREE_ITEM_VALUE_CUSD,
  calcProductCost,
  getDeliveryFee,
} from "@/lib/spendOrderPricing";
import {
  ORDER_MILES_REWARD,
  processOrderMilesRewardById,
} from "@/lib/orderMilesReward";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_RE = /^0x[a-fA-F0-9]{64}$/;
const CELO_RPC_URL = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const DELIVERY_FEE_ADDRESS = process.env.DELIVERY_FEE_ADDRESS ?? process.env.NEXT_PUBLIC_DELIVERY_FEE_ADDRESS;

const TOKEN_CONFIG = {
  cUSD: {
    address: "0x765de816845861e75a25fca122bb6898b8b1282a" as Address,
    decimals: 18,
  },
  USDT: {
    address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e" as Address,
    decimals: 6,
  },
} as const;

const publicClient = createPublicClient({
  chain: celo,
  transport: http(CELO_RPC_URL),
});

type OrderBody = {
  product_id: string;
  recipient_name: string;
  phone: string;
  city: string;
  location_details?: string | null;
  delivery_fee_tx_hash: string;
  user_address: string;
  voucher_id?: string | null;
  payment_type?: "voucher_free" | "voucher_discount" | "direct";
  amount_paid_cusd: number;
  currency: "cUSD" | "USDT";
};

type IssuedVoucherRow = {
  id: string;
  status: string;
  merchant_id: string;
  voucher_template_id: string;
};

type VoucherTemplateRow = {
  id: string;
  voucher_type: string | null;
  discount_percent: number | null;
  applicable_category: string | null;
  discount_cusd: number | null;
};

type ProductRow = {
  id: string;
  name: string;
  merchant_id: string;
  category: string | null;
  price_cusd: number;
};

function normalizeHash(value: string): Hash {
  return value.trim().toLowerCase() as Hash;
}

function derivePaymentType(voucher: VoucherTemplateRow | null): "voucher_free" | "voucher_discount" | "direct" {
  if (!voucher) return "direct";
  return voucher.voucher_type === "free" ? "voucher_free" : "voucher_discount";
}

async function txHashAlreadyUsed(hash: Hash) {
  const { data, error } = await supabase
    .from("voucher_orders")
    .select("id")
    .eq("delivery_fee_tx_hash", hash)
    .limit(1);

  if (error) {
    throw new Error("Failed to check prior payments");
  }

  return (data ?? []).length > 0;
}

async function verifyStableTokenPayment(params: {
  txHash: Hash;
  payer: Address;
  tokenAddress: Address;
  recipient: Address;
  expectedAmountRaw: bigint;
}) {
  const { txHash, payer, tokenAddress, recipient, expectedAmountRaw } = params;

  const [transaction, receipt] = await Promise.all([
    publicClient.getTransaction({ hash: txHash }),
    publicClient.getTransactionReceipt({ hash: txHash }),
  ]);

  if (receipt.status !== "success") {
    throw new Error("Payment transaction failed on-chain");
  }

  if (!transaction.to || !isAddressEqual(transaction.to, tokenAddress)) {
    throw new Error("Payment transaction token does not match the selected currency");
  }

  if (!isAddressEqual(transaction.from, payer)) {
    throw new Error("Payment transaction sender does not match the ordering wallet");
  }

  const matchingTransfer = receipt.logs.find((log) => {
    if (!isAddressEqual(log.address, tokenAddress)) return false;

    try {
      const decoded = decodeEventLog({
        abi: erc20Abi,
        data: log.data,
        topics: log.topics,
      });

      if (decoded.eventName !== "Transfer") return false;

      const from = decoded.args.from as Address | undefined;
      const to = decoded.args.to as Address | undefined;
      const value = decoded.args.value as bigint | undefined;

      return !!(
        from &&
        to &&
        value !== undefined &&
        isAddressEqual(from, payer) &&
        isAddressEqual(to, recipient) &&
        value >= expectedAmountRaw
      );
    } catch {
      return false;
    }
  });

  if (!matchingTransfer) {
    throw new Error("Payment transfer does not send the required amount to the delivery wallet");
  }
}

export async function POST(req: Request) {
  let body: OrderBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    product_id,
    recipient_name,
    phone,
    city,
    location_details,
    delivery_fee_tx_hash,
    user_address,
    voucher_id,
    amount_paid_cusd,
    currency,
  } = body ?? {};

  if (
    !UUID_RE.test(product_id ?? "") ||
    !recipient_name?.trim() ||
    !phone?.trim() ||
    !city?.trim() ||
    !HASH_RE.test(delivery_fee_tx_hash ?? "") ||
    !isAddress(user_address ?? "") ||
    typeof amount_paid_cusd !== "number" ||
    !Number.isFinite(amount_paid_cusd) ||
    !["cUSD", "USDT"].includes(currency)
  ) {
    return NextResponse.json({ error: "Missing or invalid fields" }, { status: 400 });
  }

  if (!DELIVERY_FEE_ADDRESS || !isAddress(DELIVERY_FEE_ADDRESS)) {
    return NextResponse.json({ error: "Delivery payment address is not configured" }, { status: 500 });
  }

  if (voucher_id && !UUID_RE.test(voucher_id)) {
    return NextResponse.json({ error: "Invalid voucher_id" }, { status: 400 });
  }

  const normalizedAddress = getAddress(user_address).toLowerCase() as Address;
  const normalizedTxHash = normalizeHash(delivery_fee_tx_hash);
  const deliveryWallet = getAddress(DELIVERY_FEE_ADDRESS);
  const tokenConfig = TOKEN_CONFIG[currency];

  try {
    if (await txHashAlreadyUsed(normalizedTxHash)) {
      return NextResponse.json({ error: "This payment transaction has already been used" }, { status: 409 });
    }
  } catch (error: any) {
    console.error("[POST /api/Spend/orders] tx dedupe check error:", error);
    return NextResponse.json({ error: error.message ?? "Failed to validate payment" }, { status: 500 });
  }

  const { data: product, error: productErr } = await supabase
    .from("merchant_products")
    .select("id, name, merchant_id, category, price_cusd")
    .eq("id", product_id)
    .eq("active", true)
    .maybeSingle();

  if (productErr || !product) {
    return NextResponse.json({ error: "Product not found or inactive" }, { status: 404 });
  }

  const typedProduct = product as ProductRow;

  let voucherTemplate: VoucherTemplateRow | null = null;

  if (voucher_id) {
    const { data: issuedVoucher, error: voucherErr } = await supabase
      .from("issued_vouchers")
      .select("id, status, merchant_id, voucher_template_id")
      .eq("id", voucher_id)
      .eq("user_address", normalizedAddress)
      .maybeSingle();

    if (voucherErr || !issuedVoucher) {
      return NextResponse.json({ error: "Voucher not found" }, { status: 404 });
    }

    const typedIssuedVoucher = issuedVoucher as IssuedVoucherRow;

    if (typedIssuedVoucher.status !== "issued") {
      return NextResponse.json(
        { error: `Voucher not available (status: ${typedIssuedVoucher.status})` },
        { status: 409 },
      );
    }

    if (typedIssuedVoucher.merchant_id !== typedProduct.merchant_id) {
      return NextResponse.json({ error: "Voucher does not belong to this merchant" }, { status: 409 });
    }

    const { data: template, error: templateErr } = await supabase
      .from("spend_voucher_templates")
      .select("id, voucher_type, discount_percent, applicable_category, discount_cusd")
      .eq("id", typedIssuedVoucher.voucher_template_id)
      .maybeSingle();

    if (templateErr || !template) {
      return NextResponse.json({ error: "Voucher template not found" }, { status: 404 });
    }

    voucherTemplate = template as VoucherTemplateRow;

    if (
      voucherTemplate.applicable_category &&
      voucherTemplate.applicable_category !== typedProduct.category
    ) {
      return NextResponse.json({ error: "Voucher does not apply to this product" }, { status: 409 });
    }

    if (
      voucherTemplate.voucher_type === "free" &&
      Number(typedProduct.price_cusd) > MAX_FREE_ITEM_VALUE_CUSD
    ) {
      return NextResponse.json(
        {
          error: `Free-item vouchers can only be used on products up to $${MAX_FREE_ITEM_VALUE_CUSD.toFixed(2)}`,
        },
        { status: 409 },
      );
    }
  }

  const productCost = calcProductCost(Number(typedProduct.price_cusd), voucherTemplate);
  const deliveryFee = getDeliveryFee(city.trim());
  const expectedAmount = productCost + deliveryFee;
  const expectedAmountRaw = parseUnits(expectedAmount.toFixed(tokenConfig.decimals), tokenConfig.decimals);

  try {
    await verifyStableTokenPayment({
      txHash: normalizedTxHash,
      payer: normalizedAddress,
      tokenAddress: tokenConfig.address,
      recipient: deliveryWallet,
      expectedAmountRaw,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message ?? "Payment verification failed" }, { status: 409 });
  }

  const computedPaymentType = derivePaymentType(voucherTemplate);
  const orderId = randomUUID();

  const { error: insertErr } = await supabase.from("voucher_orders").insert({
    id: orderId,
    user_address: normalizedAddress,
    voucher_id: voucher_id ?? null,
    product_id,
    recipient_name: recipient_name.trim(),
    phone: phone.trim(),
    city: city.trim(),
    delivery_fee_tx_hash: normalizedTxHash,
    payment_type: computedPaymentType,
    amount_paid_cusd: expectedAmount,
    currency,
    status: "pending",
    miles_rewarded: false,
    miles_reward_status: "pending",
    miles_reward_attempts: 0,
    miles_reward_tx_hash: null,
    miles_reward_error: null,
  });

  if (insertErr) {
    console.error("[POST /api/Spend/orders] insert error:", insertErr);
    if (insertErr.code === "23505") {
      return NextResponse.json({ error: "This payment transaction has already been used" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
  }

  if (voucher_id) {
    const { error: redeemErr } = await supabase
      .from("issued_vouchers")
      .update({ status: "redeemed" })
      .eq("id", voucher_id);

    if (redeemErr) {
      console.error("[POST /api/Spend/orders] voucher redeem error:", redeemErr);
    }
  }

  void processOrderMilesRewardById(orderId)
    .then((result) => {
      if (result.ok) {
        console.log(`[orders] minted ${ORDER_MILES_REWARD} miles for order ${orderId}, tx: ${result.txHash}`);
      } else {
        console.error("[orders] miles mint deferred/failed:", orderId, result.error);
      }
    })
    .catch((e) => console.error("[orders] miles processor failed:", e));

  sendTelegramMessage(
    `🛒 <b>New Order</b>\n` +
      `Order: <code>${orderId}</code>\n` +
      `Product: ${typedProduct.name}\n` +
      `Payment: ${computedPaymentType} · ${expectedAmount.toFixed(2)} ${currency}\n` +
      `Voucher: ${voucher_id ? `<code>${voucher_id}</code>` : "none"}\n` +
      `User: <code>${normalizedAddress}</code>\n` +
      `Recipient: ${recipient_name.trim()} / ${phone.trim()} / ${city.trim()}\n` +
      `Notes: ${location_details?.trim() || "none"}\n` +
      `TX: <code>${normalizedTxHash}</code>`,
  ).catch((e) => console.error("[orders] telegram failed:", e));

  return NextResponse.json({ order_id: orderId, miles_earned: ORDER_MILES_REWARD, miles_status: "pending" }, { status: 201 });
}
