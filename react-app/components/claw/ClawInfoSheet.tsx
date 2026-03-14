"use client";

import { Clock } from "@phosphor-icons/react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatClawAmount, CLAW_TIERS, tierName, type ClawTierConfig } from "@/lib/clawGame";

const ODDS_ROWS = [
  { key: "lose",      emoji: "❌", label: "Miss",      color: "text-slate-500"   },
  { key: "common",    emoji: "🪙", label: "Miles",     color: "text-emerald-600" },
  { key: "rare",      emoji: "🎫", label: "Voucher",   color: "text-cyan-600"    },
  { key: "epic",      emoji: "💎", label: "USDT",      color: "text-violet-600"  },
  { key: "legendary", emoji: "⭐", label: "Legendary", color: "text-amber-600"   },
] as const;

function fmtPct(weight: number) {
  const p = weight / 100;
  return p < 1 ? p.toFixed(1) + "%" : p.toFixed(p % 1 === 0 ? 0 : 1) + "%";
}

function prizeLabel(key: string, cfg: ClawTierConfig): string {
  switch (key) {
    case "common":    return formatClawAmount(cfg.commonMilesReward, 18, "Mi");
    case "rare":      return `${Math.round(cfg.rareVoucherBps / 100)}% voucher`;
    case "epic":      return formatClawAmount(cfg.epicUsdtReward, 6, "USDT");
    case "legendary": return formatClawAmount(cfg.legendaryVoucherCap, 6, "cap");
    default:          return "";
  }
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedConfig: ClawTierConfig | null;
  tierConfigs?: Record<number, ClawTierConfig | null>;
};

export function ClawInfoSheet({ open, onOpenChange, selectedConfig, tierConfigs }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-[28px] bg-white px-4 pb-8 pt-6 font-sterling max-h-[85vh] overflow-auto"
      >
        <SheetHeader className="mb-4">
          <SheetTitle className="text-left text-xl font-semibold">Rewards &amp; Odds</SheetTitle>
        </SheetHeader>

        {/* Win odds comparison table */}
        {tierConfigs && (
          <div className="mb-4 overflow-hidden rounded-2xl border border-slate-100">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-slate-50">
                  <th className="px-3 py-2 text-left font-semibold text-slate-500">Outcome</th>
                  {CLAW_TIERS.map((tid) => (
                    <th key={tid} className="px-2 py-2 text-center font-semibold text-slate-700">
                      {tierName(tid)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {ODDS_ROWS.map(({ key, emoji, label, color }) => (
                  <tr key={key} className="bg-white">
                    <td className="px-3 py-1.5">
                      <span className="mr-1">{emoji}</span>
                      <span className={`font-medium ${color}`}>{label}</span>
                    </td>
                    {CLAW_TIERS.map((tid) => {
                      const cfg = tierConfigs[tid];
                      const w =
                        !cfg ? null :
                        key === "lose"      ? cfg.loseWeight      :
                        key === "common"    ? cfg.commonWeight     :
                        key === "rare"      ? cfg.rareWeight       :
                        key === "epic"      ? cfg.epicWeight       :
                                              cfg.legendaryWeight;
                      const prize = cfg && key !== "lose" ? prizeLabel(key, cfg) : "";
                      return (
                        <td key={tid} className="px-2 py-1.5 text-center">
                          <div className={`text-[11px] font-bold ${color}`}>
                            {w != null ? fmtPct(w) : "—"}
                          </div>
                          {prize && (
                            <div className="mt-0.5 text-[9px] font-medium text-slate-400 leading-tight">
                              {prize}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Reward type legend */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { emoji: "🪙", name: "Common",    desc: "Miles credited directly to your account.", color: "border-emerald-100 bg-emerald-50" },
            { emoji: "💎", name: "Epic",       desc: "USDT paid out to your wallet.",            color: "border-violet-100 bg-violet-50"  },
            { emoji: "🎫", name: "Rare",       desc: "20% merchant discount voucher. Burn for Miles if unused.", color: "border-cyan-100 bg-cyan-50" },
            { emoji: "⭐", name: "Legendary",  desc: "Full-value capped voucher. Burn for USDT fallback.",       color: "border-amber-100 bg-amber-50" },
          ].map(({ emoji, name, desc, color }) => (
            <div key={name} className={`rounded-2xl border p-3 ${color}`}>
              <p className="text-[12px] font-semibold text-slate-900">{emoji} {name}</p>
              <p className="mt-1 text-[10px] leading-snug text-slate-600">{desc}</p>
            </div>
          ))}
        </div>

        <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
          <div className="flex items-center gap-2 text-[12px] font-medium text-slate-900">
            <Clock size={15} />
            Testing note
          </div>
          <p className="mt-1.5 text-[11px]">
            On your local fork, new pulls may take longer to reveal. Use the Sessions sheet to track and settle existing sessions.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
