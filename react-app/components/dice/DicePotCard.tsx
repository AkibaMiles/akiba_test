// components/dice/DicePotCard.tsx
"use client";

import Image from "next/image";
import {
  DiceRoundView,
  DiceRoundStateName,
  DiceTier,
  shortAddress,
  stateLabel,
  statePillClasses,
} from "@/lib/diceTypes";
import { akibaMilesSymbol } from "@/lib/svg";

type DicePotCardProps = {
  round: DiceRoundView | null;
  selectedTier: DiceTier;
  potSize: number;
  selectedNumber: number | null;
  myNumber: number | null;
  isFinished: boolean;
  hasJoinedActive: boolean;
  hasJoinedLastResolved: boolean;
  displayState: DiceRoundStateName;
  onSelectNumber: (n: number) => void;
  onJoin: () => void;
  canJoin: boolean;
  isJoining: boolean;
  isLoading: boolean;
};

export function DicePotCard({
  round,
  selectedTier,
  potSize,
  selectedNumber,
  myNumber,
  isFinished,
  hasJoinedActive,
  hasJoinedLastResolved,
  displayState,
  onSelectNumber,
  onJoin,
  canJoin,
  isJoining,
  isLoading,
}: DicePotCardProps) {
  const filledCount = isFinished ? 0 : round?.filledSlots ?? 0;
  const slotsLeft = 6 - filledCount;

  const label = stateLabel(displayState);
  const pillCls = statePillClasses(displayState);

  return (
    <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-3.5 shadow-sm shadow-emerald-50 relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-emerald-400 via-emerald-300 to-emerald-500" />

      {/* Summary line */}
      <div className="flex items-center justify-between pt-1 text-[13px]">
        <div className="space-y-0.5">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">
            Pot value
          </p>
          <div className="flex items-center gap-1.5">
            <Image src={akibaMilesSymbol} alt="Miles" className="h-3.5 w-3.5" />
            <span className="text-base font-semibold">
              {potSize.toLocaleString()}
            </span>
          </div>
        </div>

        <div className="text-right space-y-0.5">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">
            Players
          </p>
          <p className="text-[13px] font-semibold">
            {filledCount}
            <span className="text-slate-400 text-[11px]"> / 6</span>
          </p>
          <p className="text-[11px] text-emerald-600">
            {slotsLeft} slot{slotsLeft === 1 ? "" : "s"} left
          </p>
        </div>
      </div>

      {/* State pill */}
      <div className="flex justify-end">
        <div
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${pillCls}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
          <span>{label}</span>
        </div>
      </div>

      {/* Number grid – slightly smaller cards */}
      <div className="grid grid-cols-3 gap-1.5 pt-1">
        {Array.from({ length: 6 }, (_, idx) => {
          const n = idx + 1;

          const slotData =
            !isFinished && round
              ? round.slots.find((s) => s.number === n) ?? null
              : null;

          const player = slotData?.player ?? null;
          const isMine = hasJoinedActive && myNumber === n;
          const isTakenByOther = !!player && !isMine;
          const isSelected = selectedNumber === n && !hasJoinedActive && !isTakenByOther;

          const base =
            "aspect-[4/3] rounded-2xl border text-center flex flex-col items-center justify-center text-base font-semibold transition relative overflow-hidden";

          const cls = isMine
            ? "border-emerald-500 bg-gradient-to-br from-emerald-50 to-white text-emerald-700 shadow-sm"
            : isTakenByOther
            ? "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
            : isSelected
            ? "border-emerald-500 bg-gradient-to-br from-emerald-50 to-white text-emerald-700 shadow-sm"
            : "border-slate-200 bg-slate-50 text-slate-900 hover:border-emerald-300 hover:bg-emerald-50";

          return (
            <button
              key={n}
              disabled={isTakenByOther || hasJoinedActive}
              onClick={() => onSelectNumber(n)}
              className={`${base} ${cls}`}
            >
              <span className="leading-none">{n}</span>
              {isMine && (
                <span className="mt-0.5 text-[9px] uppercase tracking-wide text-emerald-600">
                  You
                </span>
              )}
              {isTakenByOther && player && (
                <span className="mt-0.5 text-[9px] text-slate-500">
                  {shortAddress(player)}
                </span>
              )}
              {!player && !isMine && (
                <span className="mt-0.5 text-[9px] text-emerald-500">
                  Free slot
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Join / status copy */}
      <div className="space-y-1.5 border-t border-slate-100 mt-2 pt-2.5">
        {!hasJoinedActive ? (
          <>
            {isFinished && hasJoinedLastResolved && (
              <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-slate-100 text-[9px] text-slate-700 border border-slate-200">
                  ✓
                </span>
                Last pot is done. You can now join a{" "}
                <span className="font-semibold">fresh round</span> for this
                tier.
              </p>
            )}

            {!hasJoinedLastResolved && (
              <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-50 text-[9px] text-emerald-700 border border-emerald-100">
                  🎲
                </span>
                Choose a free number to join this pot.
              </p>
            )}

            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>Entry per player</span>
              <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
                <Image
                  src={akibaMilesSymbol}
                  alt="Miles"
                  className="h-3 w-3"
                />
                {selectedTier.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>Total pot if full</span>
              <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
                <Image
                  src={akibaMilesSymbol}
                  alt="Miles"
                  className="h-3 w-3"
                />
                {potSize.toLocaleString()}
              </span>
            </div>

            <button
              onClick={onJoin}
              disabled={!canJoin}
              className={`mt-1 w-full rounded-full px-4 py-2 text-sm font-medium transition-all
                ${
                  canJoin
                    ? "bg-gradient-to-r from-emerald-500 to-emerald-400 text-white shadow-md shadow-emerald-200 hover:brightness-110"
                    : "bg-slate-200 text-slate-500 cursor-not-allowed"
                }`}
            >
              {isJoining
                ? "Joining..."
                : selectedNumber
                ? isFinished
                  ? "Join next pot"
                  : "Join pot"
                : "Choose a number to join"}
            </button>
          </>
        ) : (
          <p className="text-[11px] text-slate-500 flex items-start gap-1.5">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-50 text-[9px] text-emerald-700 border border-emerald-100">
              #
            </span>
            <span>
              You picked{" "}
              <span className="font-semibold">
                #{myNumber}
              </span>
              . Waiting for{" "}
              <span className="font-semibold">
                {6 - (round?.filledSlots ?? 0)}
              </span>{" "}
              more player
              {6 - (round?.filledSlots ?? 0) === 1 ? "" : "s"}
              …
            </span>
          </p>
        )}
      </div>

      {isLoading && (
        <p className="text-[10px] text-slate-400 pt-0.5">Syncing round…</p>
      )}
    </section>
  );
}
