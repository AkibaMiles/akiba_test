// src/app/api/raffles/validate-physical/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const ALLOWED_COUNTRIES = (process.env.ALLOWED_COUNTRY_CODES || "KE")
  .split(",")
  .map((s) => s.trim().toUpperCase());

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const emailLooksValid = (s: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s ?? "").trim());
const phoneIsE164254 = (s: string) =>
  /^\+254\d{9}$/.test(String(s ?? "").trim());

export async function POST(req: Request) {
  try {
    // Geo from headers (Vercel sets these in prod)
    const headers = req.headers;
    const country = (headers.get("x-vercel-ip-country") || "XX").toUpperCase();
    const region = headers.get("x-vercel-ip-country-region") || null;
    const city = headers.get("x-vercel-ip-city") || null;
    const ip = (headers.get("x-forwarded-for") || "").split(",")[0]?.trim() || null;

    // Kenya-only in production
    if (process.env.NODE_ENV === "production" && !ALLOWED_COUNTRIES.includes(country)) {
      return NextResponse.json(
        { ok: false, reason: "Kenya-only raffle. Not available in your region." },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { raffleId, address, twitter, email, phone } = body;
    const tickets = body?.tickets; // optional

    if (!raffleId || !address || !twitter || !email) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }
    if (!emailLooksValid(email)) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    }
    // phone is optional; if present, must be +254…
    if (phone && !phoneIsE164254(phone)) {
      return NextResponse.json({ error: "Phone must be Kenyan +2547xxxxxxxx or omitted" }, { status: 400 });
    }

    const wallet = String(address).toLowerCase();

    // upsert user profile (avoid wiping phone if none provided)
    const updatePayload: Record<string, any> = {
      twitter_handle: twitter,
      email,
    };
    if (phone) updatePayload.phone = phone;

    await supabase.from("users").update(updatePayload).eq("wallet", wallet);

    // If tickets provided → upsert participation (persist intent / audit)
    if (typeof tickets !== "undefined" && tickets !== null) {
      const { data: existing } = await supabase
        .from("physical_raffle_entries")
        .select("id")
        .eq("raffle_id", raffleId)
        .eq("user_address", wallet)
        .maybeSingle();

      const payload = {
        raffle_id: raffleId,
        user_address: wallet,
        tickets: Number(tickets),
        twitter_handle: twitter,
        email,
        phone: phone ?? null,
        country_code: country,
        region,
        city,
        ip_addr: ip,
        updated_at: new Date().toISOString(),
      };

      if (existing?.id) {
        await supabase.from("physical_raffle_entries").update(payload).eq("id", existing.id);
      } else {
        await supabase.from("physical_raffle_entries").insert(payload);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Server error", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
