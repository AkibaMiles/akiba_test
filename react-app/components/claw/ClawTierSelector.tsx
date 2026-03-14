"use client";

import Image from "next/image";
import { formatUnits } from "viem";
import { CLAW_TIERS, CLAW_TIER_STYLES, tierName, type ClawTierConfig } from "@/lib/clawGame";

type Props = {
  selectedTier: (typeof CLAW_TIERS)[number];
  tierConfigs: Record<number, ClawTierConfig | null>;
  onTierChange: (tier: (typeof CLAW_TIERS)[number]) => void;
};

const REWARD_ODDS = [
  { key: "lose",      label: "❌", colorBg: "bg-slate-100",   colorTxt: "text-slate-600"   },
  { key: "common",    label: "🪙", colorBg: "bg-emerald-100", colorTxt: "text-emerald-700" },
  { key: "rare",      label: "🎫", colorBg: "bg-cyan-100",    colorTxt: "text-cyan-700"    },
  { key: "epic",      label: "💎", colorBg: "bg-violet-100",  colorTxt: "text-violet-700"  },
  { key: "legendary", label: "⭐", colorBg: "bg-amber-100",   colorTxt: "text-amber-700"   },
] as const;

export function ClawTierSelector({ selectedTier, tierConfigs, onTierChange }: Props) {
  const selectedConfig = tierConfigs[selectedTier] ?? null;

  return (
    <div className="space-y-2">
      {/* ── Tier chips ── */}
      <div className="flex gap-2">
        {CLAW_TIERS.map((tierId) => {
          const cfg        = tierConfigs[tierId];
          const style      = CLAW_TIER_STYLES[tierId];
          const isSelected = tierId === selectedTier;

          const costAmt = cfg
            ? cfg.payInMiles
              ? Number(formatUnits(cfg.playCost, 18)).toFixed(0)
              : Number(formatUnits(cfg.playCost, 6)).toFixed(0)
            : "…";
          const payInMiles = cfg?.payInMiles ?? false;

          return (
            <button
              key={tierId}
              type="button"
              onClick={() => onTierChange(tierId)}
              className={`flex flex-1 flex-col items-start rounded-2xl border px-2.5 py-2 transition-all active:scale-[0.97] ${
                isSelected
                  ? `border-current bg-white shadow-sm ${style.accent}`
                  : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300"
              }`}
            >
              <div className="flex items-center gap-1 leading-tight">
                <span className={`text-[11px] font-semibold ${isSelected ? style.accent : "text-slate-700"}`}>
                  {tierName(tierId)}
                </span>
                {tierId === 1 && (
                  <span className="rounded-full bg-emerald-100 px-1 py-px text-[8px] font-bold uppercase tracking-wide text-emerald-700">
                    Popular
                  </span>
                )}
              </div>
              {/* Cost pill with token icon */}
              <div className="mt-1 flex items-center gap-1">
                {payInMiles ? (
                  <Image
                    src="/svg/minimiles-symbol.svg"
                    alt="Miles"
                    width={12}
                    height={12}
                    className="shrink-0"
                  />
                ) : (
                  <span className="flex h-3 w-3 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[7px] font-black text-white leading-none">
                    T
                  </span>
                )}
                <span className="text-[10px] font-semibold text-slate-600">
                  {costAmt} {payInMiles ? "Mi" : "USDT"}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Odds strip for selected tier ── */}
      {selectedConfig && (
        <div className="flex gap-1.5">
          {REWARD_ODDS.map(({ key, label, colorBg, colorTxt }) => {
            const weight =
              key === "lose"      ? selectedConfig.loseWeight      :
              key === "common"    ? selectedConfig.commonWeight     :
              key === "rare"      ? selectedConfig.rareWeight       :
              key === "epic"      ? selectedConfig.epicWeight       :
                                    selectedConfig.legendaryWeight;

            const pct    = weight / 100;
            const pctStr = pct < 1
              ? pct.toFixed(1) + "%"
              : pct.toFixed(pct % 1 === 0 ? 0 : 1) + "%";

            return (
              <div
                key={key}
                className={`flex flex-1 flex-col items-center rounded-xl py-1.5 ${colorBg}`}
              >
                <span className="text-xs leading-none">{label}</span>
                <span className={`mt-0.5 text-[9px] font-semibold ${colorTxt}`}>{pctStr}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
