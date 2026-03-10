import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import {
  FALLBACK_MERCHANTS,
  FALLBACK_VOUCHER_TEMPLATES,
  type MerchantSeed,
} from "@/lib/spendVouchers";

type MerchantRow = {
  id: string;
  slug: string;
  name: string;
  country: string;
  image_key: string | null;
  image_url: string | null;
};

type VoucherTemplateRow = {
  id: string;
  merchant_id: string;
  active: boolean;
  expires_at: string | null;
};

function fallbackList() {
  return FALLBACK_MERCHANTS.filter((m) => m.name === "Leshan Group").map((merchant) => {
    const vouchersAvailable = FALLBACK_VOUCHER_TEMPLATES.filter(
      (template) =>
        template.merchant_id === merchant.id &&
        template.active &&
        new Date(template.expires_at).getTime() > Date.now()
    ).length;

    return {
      ...merchant,
      vouchers_available: vouchersAvailable,
    };
  });
}

function shapeMerchant(
  merchant: MerchantRow | MerchantSeed,
  templates: VoucherTemplateRow[]
) {
  const vouchersAvailable = templates.filter((template) => {
    if (!template.active) return false;
    if (!template.expires_at) return true;
    return new Date(template.expires_at).getTime() > Date.now();
  }).length;

  return {
    id: merchant.id,
    slug: merchant.slug,
    name: merchant.name,
    country: merchant.country,
    image_key: "image_key" in merchant ? merchant.image_key : null,
    image_url: "image_url" in merchant ? merchant.image_url : null,
    vouchers_available: vouchersAvailable,
  };
}

export async function GET() {
  try {
    const { data: merchants, error: merchantErr } = await supabase
      .from("spend_merchants")
      .select("id, slug, name, country, image_key, image_url")
      .eq("name", "Leshan Group")
      .order("name", { ascending: true });

    if (merchantErr || !merchants || merchants.length === 0) {
      return NextResponse.json({ merchants: fallbackList(), source: "fallback" });
    }

    const merchantRows = merchants as MerchantRow[];
    const merchantIds = merchantRows.map((merchant) => merchant.id);

    const { data: templates, error: templateErr } = await supabase
      .from("spend_voucher_templates")
      .select("id, merchant_id, active, expires_at")
      .in("merchant_id", merchantIds);

    if (templateErr) {
      console.error("[GET /api/spend/merchants] template query error:", templateErr);
      return NextResponse.json({ merchants: fallbackList(), source: "fallback" });
    }

    const templateRows = (templates ?? []) as VoucherTemplateRow[];

    const shaped = merchantRows.map((merchant) => {
      const byMerchant = templateRows.filter(
        (template) => template.merchant_id === merchant.id
      );
      return shapeMerchant(merchant, byMerchant);
    });

    return NextResponse.json({ merchants: shaped, source: "db" });
  } catch (error) {
    console.error("[GET /api/spend/merchants] error:", error);
    return NextResponse.json({ merchants: fallbackList(), source: "fallback" });
  }
}
