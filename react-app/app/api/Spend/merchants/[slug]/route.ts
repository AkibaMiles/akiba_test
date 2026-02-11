import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import {
  FALLBACK_MERCHANTS,
  FALLBACK_VOUCHER_TEMPLATES,
} from "@/lib/spendVouchers";

type RouteContext = {
  params: Promise<{ slug?: string }>;
};

type MerchantRow = {
  id: string;
  slug: string;
  name: string;
  country: string;
  image_key: string | null;
  image_url: string | null;
};

type TemplateRow = {
  id: string;
  merchant_id: string;
  title: string;
  description: string | null;
  miles_cost: number;
  active: boolean;
  expires_at: string | null;
  cooldown_seconds: number | null;
  global_cap: number | null;
  rules: string[] | null;
};

const validSlug = (value: string) => /^[a-z0-9-]{2,80}$/i.test(value);

function fallbackDetail(slug: string) {
  const merchant = FALLBACK_MERCHANTS.find((entry) => entry.slug === slug);
  if (!merchant) return null;

  const vouchers = FALLBACK_VOUCHER_TEMPLATES.filter(
    (template) => template.merchant_id === merchant.id
  );

  return {
    ...merchant,
    vouchers_available: vouchers.filter(
      (template) => template.active && new Date(template.expires_at).getTime() > Date.now()
    ).length,
    vouchers,
  };
}

export async function GET(_req: Request, { params }: RouteContext) {
  const { slug } = await params;

  if (!slug || !validSlug(slug)) {
    return NextResponse.json({ error: "Invalid slug" }, { status: 400 });
  }

  try {
    const { data: merchant, error: merchantErr } = await supabase
      .from("spend_merchants")
      .select("id, slug, name, country, image_key, image_url")
      .eq("slug", slug)
      .maybeSingle();

    if (merchantErr || !merchant) {
      const fallback = fallbackDetail(slug);
      if (!fallback) {
        return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
      }
      return NextResponse.json({ merchant: fallback, source: "fallback" });
    }

    const merchantRow = merchant as MerchantRow;

    const { data: templates, error: templateErr } = await supabase
      .from("spend_voucher_templates")
      .select(
        "id, merchant_id, title, description, miles_cost, active, expires_at, cooldown_seconds, global_cap, rules"
      )
      .eq("merchant_id", merchantRow.id)
      .order("miles_cost", { ascending: true });

    if (templateErr) {
      console.error("[GET /api/spend/merchants/:slug] template error:", templateErr);
      return NextResponse.json({ error: "Failed to load vouchers" }, { status: 500 });
    }

    const templateRows = (templates ?? []) as TemplateRow[];
    const vouchersAvailable = templateRows.filter((template) => {
      if (!template.active) return false;
      if (!template.expires_at) return true;
      return new Date(template.expires_at).getTime() > Date.now();
    }).length;

    return NextResponse.json({
      source: "db",
      merchant: {
        ...merchantRow,
        vouchers_available: vouchersAvailable,
        vouchers: templateRows,
      },
    });
  } catch (error) {
    console.error("[GET /api/spend/merchants/:slug] error:", error);
    const fallback = fallbackDetail(slug);
    if (!fallback) {
      return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
    }
    return NextResponse.json({ merchant: fallback, source: "fallback" });
  }
}
