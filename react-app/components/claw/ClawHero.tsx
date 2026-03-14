"use client";

import { CaretLeft, Info, Stack } from "@phosphor-icons/react";

type Props = {
  onBack: () => void;
  onOpenSessions: () => void;
  onOpenInfo: () => void;
  urgentCount?: number;
};

export function ClawHero({ onBack, onOpenSessions, onOpenInfo, urgentCount = 0 }: Props) {
  return (
    <header className="flex items-center justify-between gap-2">
      {/* Back */}
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-sm active:scale-[0.97] transition"
      >
        <CaretLeft size={13} weight="bold" />
        Back
      </button>

      {/* Title badge */}
      <div className="flex items-center gap-1.5 rounded-full border border-cyan-100 bg-cyan-50 px-3 py-1">
        <span
          className="text-[9px] font-black text-cyan-400"
          style={{ textShadow: "0 0 6px #06b6d4" }}
        >
          ✦
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-widest text-cyan-700">
          Akiba Claw
        </span>
        <span className="rounded-full bg-emerald-100 px-1.5 py-px text-[9px] font-medium text-emerald-700">
          Beta
        </span>
      </div>

      {/* Action icons */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onOpenSessions}
          aria-label="View sessions"
          className="relative flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm active:scale-[0.97] transition"
        >
          <Stack size={15} />
          {urgentCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white">
              {urgentCount > 9 ? "9+" : urgentCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onOpenInfo}
          aria-label="Game info"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm active:scale-[0.97] transition"
        >
          <Info size={15} />
        </button>
      </div>
    </header>
  );
}
