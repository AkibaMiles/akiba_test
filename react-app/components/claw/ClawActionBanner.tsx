"use client";

import { formatUnits } from "viem";
import type { ClawSessionView } from "@/lib/clawGame";

type Props = {
  session: ClawSessionView;
  actionLoading: string | null;
  onSettle: () => void;
  onClaim: () => void;
  onBurn: () => void;
};

function fmtMiles(raw: bigint) {
  return `${Number(formatUnits(raw, 18)).toLocaleString(undefined, { maximumFractionDigits: 0 })} Miles`;
}
function fmtUsdt(raw: bigint) {
  return `${Number(formatUnits(raw, 6)).toFixed(2)} USDT`;
}

const SETTLED_CFG = {
  lose:      { emoji: "💨", title: "No grab this time",    bg: "bg-slate-50  border-slate-200", titleCls: "text-slate-700" },
  common:    { emoji: "🪙", title: "Miles reward won!",    bg: "bg-emerald-50 border-emerald-200", titleCls: "text-emerald-800" },
  rare:      { emoji: "🎫", title: "Rare voucher won!",    bg: "bg-cyan-50   border-cyan-200",    titleCls: "text-cyan-800"   },
  epic:      { emoji: "💎", title: "USDT payout won!",     bg: "bg-violet-50 border-violet-200",  titleCls: "text-violet-800" },
  legendary: { emoji: "⭐", title: "Legendary reward!",    bg: "bg-amber-50  border-amber-200",   titleCls: "text-amber-800"  },
  none:      { emoji: "?",  title: "Awaiting outcome",     bg: "bg-slate-50  border-slate-200", titleCls: "text-slate-700" },
};

export function ClawActionBanner({ session, actionLoading, onSettle, onClaim, onBurn }: Props) {
  const sid = session.sessionId.toString();
  const isLoadingSettle = actionLoading === `settle-${sid}`;
  const isLoadingClaim  = actionLoading === `claim-${sid}`;
  const isLoadingBurn   = actionLoading === `burn-${sid}`;
  const anyLoading = !!actionLoading;

  /* ── PENDING (canSettle) ──────────────────────────────────── */
  if (session.status === "pending") {
    if (!session.canSettle) return null;
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-cyan-200 bg-cyan-50 px-3 py-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-cyan-100 text-base">
          🎰
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-cyan-800">Session #{sid}</p>
          <p className="text-[10px] text-cyan-600">Prize ready — settle to confirm on-chain!</p>
        </div>
        <button
          disabled={anyLoading}
          onClick={onSettle}
          className="shrink-0 rounded-xl bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm active:scale-[0.97] disabled:opacity-50"
        >
          {isLoadingSettle ? "…" : "Reveal →"}
        </button>
      </div>
    );
  }

  /* ── SETTLED ──────────────────────────────────────────────── */
  if (session.status === "settled") {
    const rc  = session.rewardClass;
    const cfg = SETTLED_CFG[rc] ?? SETTLED_CFG.none;

    const isVoucher = rc === "rare" || rc === "legendary";
    const isLose    = rc === "lose";

    // Fallback label for voucher burn option
    const burnLabel =
      rc === "rare"      ? fmtMiles(session.rewardAmount) :
      rc === "legendary" ? fmtUsdt(session.rewardAmount)  : "";

    return (
      <div className={`rounded-2xl border px-3 py-2.5 ${cfg.bg}`}>
        {/* Header row */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-base leading-none">{cfg.emoji}</span>
          <div className="flex-1 min-w-0">
            <p className={`text-xs font-semibold ${cfg.titleCls}`}>{cfg.title}</p>
            <p className="text-[10px] text-slate-500">Session #{sid}</p>
          </div>
        </div>

        {/* Voucher explanation */}
        {isVoucher && (
          <p className="mb-2 text-[10px] text-slate-600 leading-relaxed">
            {rc === "rare"
              ? "Keep a 20% merchant discount voucher, or take Miles instantly."
              : "Keep a 100%-capped merchant voucher, or take the USDT fallback."}
          </p>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          {!isLose && (
            <button
              disabled={anyLoading}
              onClick={onClaim}
              className={`flex-1 rounded-xl py-1.5 text-xs font-semibold text-white shadow-sm active:scale-[0.97] disabled:opacity-50 ${
                rc === "legendary" ? "bg-amber-500" :
                rc === "epic"      ? "bg-violet-600" :
                rc === "rare"      ? "bg-cyan-600" :
                                     "bg-emerald-600"
              }`}
            >
              {isLoadingClaim
                ? "…"
                : isVoucher ? "Claim voucher" : "Claim reward"}
            </button>
          )}

          {isVoucher && (
            <button
              disabled={anyLoading}
              onClick={onBurn}
              className="flex-1 rounded-xl border border-slate-200 bg-white py-1.5 text-xs font-medium text-slate-700 shadow-sm active:scale-[0.97] disabled:opacity-50"
            >
              {isLoadingBurn ? "…" : `Take ${burnLabel}`}
            </button>
          )}

          {isLose && (
            <button
              disabled={anyLoading}
              onClick={onClaim}
              className="flex-1 rounded-xl border border-slate-200 bg-white py-1.5 text-xs font-medium text-slate-600 active:scale-[0.97] disabled:opacity-50"
            >
              {isLoadingClaim ? "…" : "Dismiss"}
            </button>
          )}
        </div>
      </div>
    );
  }

  return null;
}
