"use client";

import type { BatchInventory } from "@/lib/clawGame";

type Props = {
  inventory: BatchInventory | null;
  loading?: boolean;
};

export function BatchInventoryBar({ inventory, loading }: Props) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-slate-100 bg-white px-3 py-2 shadow-sm">
        <div className="h-1.5 w-full animate-pulse rounded-full bg-slate-100" />
      </div>
    );
  }

  if (!inventory) return null;

  const { totalRemaining, totalPlays, legendarys, epics, rares, commons, active, batchId } = inventory;

  const pct = totalPlays > 0n
    ? Number((totalRemaining * 100n) / totalPlays)
    : 0;

  // Progress bar colour shifts from green → amber → red as inventory depletes
  const barColor =
    pct > 50 ? "#22c55e" :
    pct > 20 ? "#f59e0b" :
               "#ef4444";

  if (!active && totalRemaining === 0n) {
    return (
      <div className="flex items-center justify-center gap-1.5 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2">
        <span className="text-sm">🔄</span>
        <span className="text-[11px] font-semibold text-amber-700">New machine loading…</span>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-100 bg-white px-3 py-2 shadow-sm">
      {/* Title row */}
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-semibold text-slate-500 tracking-wide uppercase">
          Machine #{batchId.toString()} · prizes left
        </span>
        <span className="text-[11px] font-bold text-slate-700">
          {totalRemaining.toString()}
          <span className="font-normal text-slate-400"> / {totalPlays.toString()}</span>
        </span>
      </div>

      {/* Progress bar */}
      <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: barColor }}
        />
      </div>

      {/* Prize type chips */}
      <div className="flex gap-1.5 flex-wrap">
        {legendarys > 0n && (
          <span className="flex items-center gap-0.5 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 border border-amber-200">
            ⭐ {legendarys.toString()}
          </span>
        )}
        {epics > 0n && (
          <span className="flex items-center gap-0.5 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700 border border-violet-200">
            💎 {epics.toString()}
          </span>
        )}
        {rares > 0n && (
          <span className="flex items-center gap-0.5 rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-semibold text-cyan-700 border border-cyan-200">
            🎫 {rares.toString()}
          </span>
        )}
        {commons > 0n && (
          <span className="flex items-center gap-0.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
            🪙 {commons.toString()}
          </span>
        )}
      </div>
    </div>
  );
}
