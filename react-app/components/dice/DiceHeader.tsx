// components/dice/DiceHeader.tsx
"use client";

import { BarChart3 } from "lucide-react";
import type { DiceTier, TierStats, PlayerStats } from "@/lib/diceTypes";
import { akibaMilesSymbol } from "@/lib/svg";

type DiceHeaderProps = {
  onBack: () => void;
  selectedTier: DiceTier;
  onTierChange: (tier: DiceTier) => void;
  tierStats: TierStats;
  playerStats: PlayerStats;
  onOpenStats: () => void;
};

const TIERS: DiceTier[] = [10, 20, 30];

export function DiceHeader({
  onBack,
  selectedTier,
  onTierChange,
  tierStats,
  playerStats,
  onOpenStats,
}: DiceHeaderProps) {
  return (
    <header className="space-y-3 relative z-10">
      {/* Top row: back + stats icon button */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
        >
          <span className="text-base leading-none">←</span>
          <span>Back</span>
        </button>

        {(tierStats || playerStats) && (
          <button
            onClick={onOpenStats}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] text-slate-700 shadow-sm hover:border-emerald-300 hover:text-emerald-700 active:scale-[0.97] transition"
          >
            <BarChart3 className="h-3.5 w-3.5" />
            <span>Stats</span>
          </button>
        )}
      </div>

      {/* Title + description */}
      <div className="space-y-1">
        <div className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-100 px-2 py-0.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          <span className="text-[10px] font-medium text-emerald-700 tracking-wide uppercase">
            Akiba Dice
          </span>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">
          Six-Sided Pot
        </h1>
        <p className="text-[13px] text-slate-600 leading-snug">
          6 players, 6 numbers. Pick your number – when the pot fills, the dice
          decides who takes it all.
        </p>
      </div>

      {/* Tier selector – compact */}
      <section className="flex items-center gap-2 pt-1">
        {TIERS.map((tier) => (
          <button
            key={tier}
            onClick={() => onTierChange(tier)}
            className={`flex-1 rounded-2xl border px-2.5 py-2 text-[13px] font-medium transition-all
              ${
                selectedTier === tier
                  ? "border-emerald-500 bg-gradient-to-r from-emerald-500 to-emerald-400 text-white shadow-md shadow-emerald-200"
                  : "border-slate-200 bg-white text-slate-700 hover:border-emerald-200 hover:bg-emerald-50"
              }`}
          >
            
            <span>{tier.toLocaleString()} </span>
          </button>
        ))}
      </section>
    </header>
  );
}
