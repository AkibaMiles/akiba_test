import { NextResponse } from "next/server";
import { ensureActiveClawBatch } from "@/lib/clawBatchAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const log: string[] = [];
  const info = (message: string) => {
    log.push(message);
    console.log("[claw/rotate/ensure]", message);
  };

  try {
    const result = await ensureActiveClawBatch(info);
    return NextResponse.json({ ok: true, ...result, log });
  } catch (err: any) {
    console.error("[claw/rotate/ensure]", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Unknown error", log },
      { status: 500 },
    );
  }
}
