import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const merchantId = searchParams.get("merchant_id");

  if (!merchantId || !UUID_RE.test(merchantId)) {
    return NextResponse.json({ error: "Invalid merchant_id" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("merchant_products")
    .select("id, name, description, image_url, price_cusd, category")
    .eq("merchant_id", merchantId)
    .eq("active", true)
    .order("name", { ascending: true });

  if (error) {
    console.error("[GET /api/Spend/orders/products]", error);
    return NextResponse.json({ error: "Failed to fetch products" }, { status: 500 });
  }

  return NextResponse.json({ products: data ?? [] });
}
