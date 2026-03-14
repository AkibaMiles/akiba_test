import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

type RouteContext = {
  params: Promise<{ address?: string }>;
};

type IssuedVoucherRow = {
  id: string;
  merchant_id: string;
  voucher_template_id: string;
  code: string;
  qr_payload: string;
  expires_at: string;
  burn_tx_hash: string;
  status: string;
  rules_snapshot: string[] | null;
  created_at: string;
};

type PartnerRow = {
  id: string;
  name: string;
};

type TemplateRow = {
  id: string;
  title: string;
  miles_cost: number;
  voucher_type: string | null;
  discount_percent: number | null;
  applicable_category: string | null;
  discount_cusd: number | null;
};

function isEthAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

export async function GET(_req: Request, { params }: RouteContext) {
  const { address } = await params;

  if (!address || !isEthAddress(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  const userAddress = address.toLowerCase();

  try {
    const { data: issued, error: issuedErr } = await supabase
      .from("issued_vouchers")
      .select(
        "id, merchant_id, voucher_template_id, code, qr_payload, expires_at, burn_tx_hash, status, rules_snapshot, created_at"
      )
      .eq("user_address", userAddress)
      .order("created_at", { ascending: false });

    if (issuedErr) {
      console.error("[GET /api/Spend/vouchers/user/:address] issued query error:", issuedErr);
      return NextResponse.json({ error: "Failed to fetch vouchers" }, { status: 500 });
    }

    const vouchers = (issued ?? []) as IssuedVoucherRow[];

    if (vouchers.length === 0) {
      return NextResponse.json({ vouchers: [] });
    }

    const merchantIds = Array.from(new Set(vouchers.map((v) => v.merchant_id)));
    const templateIds = Array.from(new Set(vouchers.map((v) => v.voucher_template_id)));

    const [{ data: partners, error: partnersErr }, { data: templates, error: templatesErr }] =
      await Promise.all([
        supabase.from("partners").select("id, name").in("id", merchantIds),
        supabase
          .from("spend_voucher_templates")
          .select("id, title, miles_cost, voucher_type, discount_percent, applicable_category, discount_cusd")
          .in("id", templateIds),
      ]);

    if (partnersErr || templatesErr) {
      console.error("[GET /api/Spend/vouchers/user/:address] lookup error:", {
        partnersErr,
        templatesErr,
      });
      return NextResponse.json({ error: "Failed to resolve voucher details" }, { status: 500 });
    }

    const partnerMap = new Map(
      ((partners ?? []) as PartnerRow[]).map((partner) => [partner.id, partner])
    );
    const templateMap = new Map(
      ((templates ?? []) as TemplateRow[]).map((template) => [template.id, template])
    );

    return NextResponse.json({
      vouchers: vouchers.map((voucher) => {
        const partner = partnerMap.get(voucher.merchant_id);
        const template = templateMap.get(voucher.voucher_template_id);
        const derivedStatus =
          voucher.status === "issued" &&
          new Date(voucher.expires_at).getTime() <= Date.now()
            ? "expired"
            : voucher.status;

        return {
          id: voucher.id,
          code: voucher.code,
          qr_payload: voucher.qr_payload,
          expires_at: voucher.expires_at,
          burn_tx_hash: voucher.burn_tx_hash,
          status: derivedStatus,
          rules_snapshot: voucher.rules_snapshot ?? [],
          created_at: voucher.created_at,
          merchant_id: voucher.merchant_id,
          voucher_template_id: voucher.voucher_template_id,
          merchant_name: partner?.name ?? "Merchant",
          voucher_title: template?.title ?? "Voucher",
          miles_cost: template?.miles_cost ?? null,
          voucher_type: template?.voucher_type ?? "free",
          discount_percent: template?.discount_percent ?? null,
          applicable_category: template?.applicable_category ?? null,
          discount_cusd: template?.discount_cusd ?? null,
        };
      }),
    });
  } catch (error) {
    console.error("[GET /api/Spend/vouchers/user/:address] error:", error);
    return NextResponse.json({ error: "Failed to fetch vouchers" }, { status: 500 });
  }
}
