import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

type RouteContext = {
  params: Promise<{ address?: string }>;
};

function isEthAddress(v: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(v);
}

export async function GET(_req: Request, { params }: RouteContext) {
  const { address } = await params;

  if (!address || !isEthAddress(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  const userAddress = address.toLowerCase();

  const { data: orders, error } = await supabase
    .from("voucher_orders")
    .select(
      "id, product_id, payment_type, amount_paid_cusd, currency, status, miles_rewarded, miles_reward_status, miles_reward_attempts, miles_reward_tx_hash, miles_reward_error, created_at, recipient_name, phone, city, delivery_fee_tx_hash"
    )
    .eq("user_address", userAddress)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[GET /api/Spend/orders/user/:address]", error);
    return NextResponse.json({ error: "Failed to fetch orders" }, { status: 500 });
  }

  if (!orders || orders.length === 0) {
    return NextResponse.json({ orders: [] });
  }

  // Fetch product names
  const productIds = Array.from(new Set(orders.map((o) => o.product_id)));
  const { data: products } = await supabase
    .from("merchant_products")
    .select("id, name")
    .in("id", productIds);

  const productMap = new Map((products ?? []).map((p) => [p.id, p.name]));

  return NextResponse.json({
    orders: orders.map((o) => ({
      ...o,
      product_name: productMap.get(o.product_id) ?? "Product",
    })),
  });
}
