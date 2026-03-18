"use client";

import Image from "next/image";
import { formatUnits } from "viem";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { ClawSessionView, ClawTierConfig } from "@/lib/clawGame";

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtMiles(raw: bigint) {
  return `${Number(formatUnits(raw, 18)).toLocaleString(undefined, { maximumFractionDigits: 0 })} Miles`;
}
function fmtUsdt(raw: bigint) {
  return `$${Number(formatUnits(raw, 6)).toFixed(2)} USDT`;
}

function buildXShareUrl(rewardClass: "rare" | "legendary"): string {
  const discount = rewardClass === "legendary" ? "100%" : "20%";
  const emoji    = rewardClass === "legendary" ? "⭐" : "🎫";
  const appUrl   = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const text = `Just won a ${discount} off voucher on Akiba Claw! ${emoji} Valid at any participating merchant. #AkibaClaw #Web3${appUrl ? `\n${appUrl}` : ""}`;
  return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

function buildVoucherQrUrl(session: ClawSessionView, tierConfig: ClawTierConfig): string {
  const discountBps =
    session.rewardClass === "legendary"
      ? tierConfig.legendaryVoucherBps
      : tierConfig.rareVoucherBps;
  const expiresAt = new Date(
    (Number(session.settledAt) + 14 * 24 * 3600) * 1000,
  ).toISOString();
  const payload = JSON.stringify({
    type: "claw_voucher",
    voucherId: session.voucherId.toString(),
    owner: session.player,
    discountBps,
    expiresAt,
  });
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(payload)}`;
}

// ── Config ─────────────────────────────────────────────────────────────────

const TIER_CFG = {
  rare: {
    emoji: "🎫",
    label: "RARE VOUCHER",
    discount: "20% OFF",
    gradFrom: "#06b6d4",
    gradTo: "#0c4a6e",
    glow: "rgba(6,182,212,0.55)",
    pulseAnim: undefined as string | undefined,
    btnCls: "bg-gradient-to-r from-cyan-500 to-cyan-700 shadow-cyan-300",
  },
  legendary: {
    emoji: "⭐",
    label: "LEGENDARY VOUCHER",
    discount: "100% OFF",
    gradFrom: "#fbbf24",
    gradTo: "#78350f",
    glow: "rgba(251,191,36,0.7)",
    pulseAnim: "vwsPulse 1.6s ease-in-out infinite" as string | undefined,
    btnCls: "bg-gradient-to-r from-amber-400 to-amber-600 shadow-amber-300",
  },
};

// ── Types ──────────────────────────────────────────────────────────────────

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: ClawSessionView;
  tierConfig: ClawTierConfig;
  actionLoading: string | null;
  onBurn: () => void;
  onKeep: () => void;
};

// ── Component ──────────────────────────────────────────────────────────────

export function VoucherWinSheet({
  open,
  onOpenChange,
  session,
  tierConfig,
  actionLoading,
  onBurn,
  onKeep,
}: Props) {
  const rc = session.rewardClass as "rare" | "legendary";
  const cfg = TIER_CFG[rc];

  const isClaimed = session.status === "claimed" && session.voucherId > 0n;
  const burnLabel = rc === "rare" ? fmtMiles(session.rewardAmount) : fmtUsdt(session.rewardAmount);
  const sid = session.sessionId.toString();
  const isBurning = actionLoading === `burn-${sid}`;
  const anyLoading = !!actionLoading;

  const expiryDate = new Date(
    (Number(session.settledAt) + 14 * 24 * 3600) * 1000,
  ).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[28px] border-0 bg-white px-5 pb-8 pt-0 max-h-[85vh] overflow-y-auto"
      >
        {/* Keyframes */}
        <style>{`
          @keyframes vwsPulse {
            0%,100% { box-shadow: 0 0 28px rgba(251,191,36,0.7), 0 0 56px rgba(251,191,36,0.25); }
            50%     { box-shadow: 0 0 56px rgba(251,191,36,1),   0 0 100px rgba(251,191,36,0.45); }
          }
          @keyframes vwsSpin {
            to { transform: rotate(360deg); }
          }
        `}</style>

        {/* Drag handle */}
        <div className="mx-auto mb-4 mt-3 h-1 w-10 rounded-full bg-slate-200" />

        {/* Header */}
        <div className="mb-5 text-center">
          <span className="block text-4xl leading-none">{cfg.emoji}</span>
          <h2 className="mt-2 text-lg font-bold text-slate-900">You won a voucher!</h2>
          <p className="mt-0.5 text-[12px] text-slate-500">Present this at any participating merchant</p>
        </div>

        {/* Voucher card */}
        <div
          className="relative mx-auto w-full max-w-xs overflow-hidden rounded-3xl px-6 py-7"
          style={{
            background: `linear-gradient(145deg, ${cfg.gradFrom} 0%, ${cfg.gradTo} 100%)`,
            boxShadow: cfg.pulseAnim
              ? undefined
              : `0 0 32px ${cfg.glow}, 0 4px 20px rgba(0,0,0,0.25)`,
            animation: cfg.pulseAnim,
          }}
        >
          {/* Decorative circles */}
          <div
            className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full opacity-20"
            style={{ background: "rgba(255,255,255,0.3)" }}
          />
          <div
            className="pointer-events-none absolute -bottom-8 -left-8 h-28 w-28 rounded-full opacity-15"
            style={{ background: "rgba(255,255,255,0.25)" }}
          />

          {/* Tier label */}
          <p className="text-[10px] font-bold tracking-[0.2em] text-white/70">{cfg.label}</p>

          {/* Discount */}
          <p className="mt-1 text-5xl font-black text-white leading-none drop-shadow-sm">{cfg.discount}</p>

          {/* Merchant line */}
          <p className="mt-2 text-[12px] font-medium text-white/80">Valid at any participating merchant</p>

          {/* QR / loading */}
          <div className="mt-5 flex justify-center">
            {isClaimed ? (
              <div className="rounded-2xl bg-white p-2.5 shadow-inner">
                <Image
                  src={buildVoucherQrUrl(session, tierConfig)}
                  alt="Voucher QR code"
                  width={148}
                  height={148}
                  unoptimized
                  className="block rounded-xl"
                />
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 rounded-2xl bg-white/15 px-8 py-5">
                <div
                  className="h-6 w-6 rounded-full border-2 border-white/40 border-t-white"
                  style={{ animation: "vwsSpin 0.8s linear infinite" }}
                />
                <p className="text-[11px] font-medium text-white/80">Securing on-chain…</p>
              </div>
            )}
          </div>

          {/* Voucher ID + expiry */}
          {isClaimed && (
            <div className="mt-3 text-center">
              <p className="font-mono text-[11px] text-white/60">#{session.voucherId.toString()}</p>
            </div>
          )}
          <p className="mt-1 text-center text-[10px] text-white/50">Expires {expiryDate}</p>
        </div>

        {/* Fallback reward hint */}
        <p className="mt-4 text-center text-[12px] text-slate-400">
          Or take your fallback reward:{" "}
          <span className="font-semibold text-slate-600">{burnLabel}</span>
        </p>

        {/* CTAs */}
        <div className="mt-4 flex flex-col gap-2.5">
          {/* Primary: Keep */}
          <button
            onClick={onKeep}
            disabled={anyLoading}
            className={`w-full rounded-2xl py-3.5 text-sm font-bold text-white shadow-md transition active:scale-[0.97] disabled:opacity-50 ${cfg.btnCls}`}
          >
            Keep Voucher · Use at Merchants
          </button>

          {/* Secondary: Burn */}
          <button
            onClick={onBurn}
            disabled={anyLoading}
            className="w-full rounded-2xl border border-slate-200 bg-white py-3.5 text-sm font-semibold text-slate-700 shadow-sm transition active:scale-[0.97] disabled:opacity-40"
          >
            {isBurning ? "Processing…" : `Take ${burnLabel} instead`}
          </button>

          {/* Tertiary: Share on X */}
          <a
            href={buildXShareUrl(rc)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-semibold text-slate-400 transition hover:text-slate-700 active:scale-[0.97]"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M9.16 6.77 14.43 0h-1.25L8.6 5.9 4.72 0H.5l5.54 7.87L.5 16h1.25l4.84-5.45L10.78 16H15L9.16 6.77Zm-1.71 1.93-.56-.78L2.24 1.04h1.92l3.6 5.02.56.78 4.67 6.52h-1.92L7.45 8.7Z"/>
            </svg>
            Share your win on X
          </a>
        </div>
      </SheetContent>
    </Sheet>
  );
}
