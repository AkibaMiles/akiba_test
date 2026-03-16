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

const RESULT_CFG = {
  lose:      { emoji: "💨", title: "No grab this time",    bg: "bg-slate-50  border-slate-200", titleCls: "text-slate-700",   sub: "Better luck next play!" },
  common:    { emoji: "🪙", title: "Miles sent!",          bg: "bg-emerald-50 border-emerald-200", titleCls: "text-emerald-800", sub: "Landed in your wallet." },
  rare:      { emoji: "🎫", title: "Rare voucher issued!", bg: "bg-cyan-50   border-cyan-200",    titleCls: "text-cyan-800",    sub: "Keep the voucher or take Miles." },
  epic:      { emoji: "💎", title: "USDT sent!",           bg: "bg-violet-50 border-violet-200",  titleCls: "text-violet-800",  sub: "Landed in your wallet." },
  legendary: { emoji: "⭐", title: "Legendary voucher!",  bg: "bg-amber-50  border-amber-200",   titleCls: "text-amber-800",   sub: "Keep the voucher or take USDT." },
  none:      { emoji: "?",  title: "Awaiting outcome",     bg: "bg-slate-50  border-slate-200",   titleCls: "text-slate-700",   sub: "" },
};

export function ClawActionBanner({ session, actionLoading, onSettle, onClaim, onBurn }: Props) {
  const sid = session.sessionId.toString();
  const isLoadingClaim  = actionLoading === `claim-${sid}`;
  const isLoadingBurn   = actionLoading === `burn-${sid}`;
  const anyLoading = !!actionLoading;

  /* ── PENDING ─────────────────────────────────────────────── */
  if (session.status === "pending") {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-cyan-200 bg-cyan-50 px-3 py-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-cyan-100 text-base animate-spin">
          🎰
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-cyan-800">Revealing your prize…</p>
          <p className="text-[10px] text-cyan-600">Session #{sid} · no extra signature needed</p>
        </div>
      </div>
    );
  }

  /* ── SETTLED (relayer should auto-claim) ─────────────────── */
  if (session.status === "settled") {
    const rc  = session.rewardClass;
    const cfg = RESULT_CFG[rc] ?? RESULT_CFG.none;
    const isVoucher = rc === "rare" || rc === "legendary";
    const isLose    = rc === "lose";
    const burnLabel =
      rc === "rare"      ? fmtMiles(session.rewardAmount) :
      rc === "legendary" ? fmtUsdt(session.rewardAmount)  : "";

    return (
      <div className={`rounded-2xl border px-3 py-2.5 ${cfg.bg}`}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-base leading-none">{cfg.emoji}</span>
          <div className="flex-1 min-w-0">
            <p className={`text-xs font-semibold ${cfg.titleCls}`}>{cfg.title}</p>
            <p className="text-[10px] text-slate-500">
              {isLose ? "Closing your play…" : isVoucher ? "Issuing your voucher…" : "Sending reward…"}
            </p>
          </div>
        </div>
        {!isLose ? (
          <div className="rounded-xl bg-white/70 px-3 py-2 text-[11px] text-slate-600">
            {isVoucher
              ? "Your voucher should appear automatically. If it gets stuck, use Sessions."
              : "This reward should complete automatically in the background."}
          </div>
        ) : null}
      </div>
    );
  }

  /* ── CLAIMED ─────────────────────────────────────────────── */
  if (session.status === "claimed") {
    const rc  = session.rewardClass;
    const cfg = RESULT_CFG[rc] ?? RESULT_CFG.none;
    const isVoucher = rc === "rare" || rc === "legendary";
    const burnLabel =
      rc === "rare"      ? fmtMiles(session.rewardAmount) :
      rc === "legendary" ? fmtUsdt(session.rewardAmount)  : "";

    return (
      <div className={`rounded-2xl border px-3 py-2.5 ${cfg.bg}`}>
        <div className="flex items-center gap-2">
          <span className="text-base leading-none">{cfg.emoji}</span>
          <div className="flex-1 min-w-0">
            <p className={`text-xs font-semibold ${cfg.titleCls}`}>{cfg.title}</p>
            <p className="text-[10px] text-slate-500">{cfg.sub}</p>
          </div>
          {isVoucher && (
            <button
              disabled={anyLoading}
              onClick={onBurn}
              className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm active:scale-[0.97] disabled:opacity-50"
            >
              {isLoadingBurn ? "…" : `Take ${burnLabel}`}
            </button>
          )}
        </div>
      </div>
    );
  }

  return null;
}
