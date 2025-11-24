// components/dice/DiceStatsSheet.tsx
"use client";

import Image from "next/image";
import { akibaMilesSymbol } from "@/lib/svg";
import type { DiceTier, TierStats, PlayerStats } from "@/lib/diceTypes";

type Props = {
  open: boolean;
  onClose: () => void;
  selectedTier: DiceTier;
  tierStats: TierStats;
  playerStats: PlayerStats;
};

function formatMilesAmount(x?: bigint | null) {
  if (!x) return "0";
  const num = Number(x) / 1e18;
  return num.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

export function DiceStatsSheet({
  open,
  onClose,
  selectedTier,
  tierStats,
  playerStats,
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 backdrop-blur-sm">
      <button
        className="absolute inset-0 w-full h-full"
        onClick={onClose}
        aria-label="Close stats"
      />
      <div className="relative w-full max-w-md mx-auto rounded-t-3xl bg-white border-t border-slate-200 p-4 space-y-4 shadow-2xl">
        <div className="mx-auto h-1 w-12 rounded-full bg-slate-200" />

        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-400">
              Dice stats
            </p>
            <h2 className="text-sm font-semibold text-slate-900">
              Six-Sided Pot · {selectedTier.toLocaleString()} Miles
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-xs text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* Tier-level stats */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3 space-y-2">
            <p className="text-[11px] font-semibold text-slate-700 uppercase tracking-wide">
              Pot history
            </p>
            <div className="space-y-1.5 text-[11px] text-slate-600">
              <div className="flex items-center justify-between">
                <span>Rounds created</span>
                <span className="font-semibold">
                  {tierStats?.roundsCreated ?? 0}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Rounds resolved</span>
                <span className="font-semibold">
                  {tierStats?.roundsResolved ?? 0}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Total staked</span>
                <span className="inline-flex items-center gap-1 font-semibold">
                  <Image
                    src={akibaMilesSymbol}
                    alt="Miles"
                    className="h-3 w-3"
                  />
                  {formatMilesAmount(tierStats?.totalStaked)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Total payout</span>
                <span className="inline-flex items-center gap-1 font-semibold">
                  <Image
                    src={akibaMilesSymbol}
                    alt="Miles"
                    className="h-3 w-3"
                  />
                  {formatMilesAmount(tierStats?.totalPayout)}
                </span>
              </div>
            </div>
          </div>

          {/* Player-level stats */}
          <div className="rounded-2xl border border-slate-200 bg-white p-3 space-y-2">
            <p className="text-[11px] font-semibold text-slate-700 uppercase tracking-wide">
              Your record
            </p>
            <div className="space-y-1.5 text-[11px] text-slate-600">
              <div className="flex items-center justify-between">
                <span>Rounds joined</span>
                <span className="font-semibold">
                  {playerStats?.roundsJoined ?? 0}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Rounds won</span>
                <span className="font-semibold">
                  {playerStats?.roundsWon ?? 0}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Total staked</span>
                <span className="inline-flex items-center gap-1 font-semibold">
                  <Image
                    src={akibaMilesSymbol}
                    alt="Miles"
                    className="h-3 w-3"
                  />
                  {formatMilesAmount(playerStats?.totalStaked)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Total won</span>
                <span className="inline-flex items-center gap-1 font-semibold">
                  <Image
                    src={akibaMilesSymbol}
                    alt="Miles"
                    className="h-3 w-3"
                  />
                  {formatMilesAmount(playerStats?.totalWon)}
                </span>
              </div>
            </div>
          </div>
        </div>

        <p className="text-[11px] text-slate-500">
          Stats are calculated on-chain from all completed rounds. Use them to
          track how your luck runs over time.
        </p>
      </div>
    </div>
  );
}
