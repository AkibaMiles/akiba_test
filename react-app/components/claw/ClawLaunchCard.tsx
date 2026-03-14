"use client";

import { Lightning, ShieldCheck, WarningCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { CLAW_TIER_STYLES, tierName, type ClawTierConfig } from "@/lib/clawGame";

type Props = {
  selectedTier: number;
  selectedConfig: ClawTierConfig | null;
  selectedTierCostLabel: string;
  usdtAllowance: bigint;
  address: string | null;
  loading: boolean;
  actionLoading: string | null;
  error: string | null;
  success: string | null;
  onStart: () => Promise<void> | void;
  onApprove: () => Promise<void> | void;
};

export function ClawLaunchCard({
  selectedTier,
  selectedConfig,
  selectedTierCostLabel,
  usdtAllowance,
  address,
  loading,
  actionLoading,
  error,
  success,
  onStart,
  onApprove,
}: Props) {
  const selectedStyle = CLAW_TIER_STYLES[selectedTier];
  const needsApproval =
    !!selectedConfig && !selectedConfig.payInMiles && usdtAllowance < selectedConfig.playCost;

  return (
    <section className="mt-5 rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <Lightning size={18} className="text-cyan-700" />
          <div>
            <p className="text-sm font-semibold text-slate-950">{tierName(selectedTier)}</p>
            <p className="mt-1 text-[11px] uppercase tracking-[0.16em] text-slate-500">Play now</p>
          </div>
        </div>
        <div className={`rounded-2xl px-4 py-3 text-right ${selectedStyle.chip} text-white`}>
          <p className="text-[11px] uppercase tracking-[0.18em] text-white/70">Cost</p>
          <p className="mt-1 text-sm font-semibold">{selectedTierCostLabel}</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-slate-50 p-3">
          <div className="flex items-center gap-2 text-slate-900">
            <Lightning size={16} className="text-cyan-700" />
            <p className="text-xs font-semibold uppercase tracking-[0.16em]">Pay</p>
          </div>
          <p className="mt-2 text-sm font-semibold text-slate-900">
            {selectedConfig?.payInMiles ? "Miles" : "USDT"}
          </p>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <div className="flex items-center gap-2 text-slate-900">
            <ShieldCheck size={16} className="text-emerald-600" />
            <p className="text-xs font-semibold uppercase tracking-[0.16em]">Ready</p>
          </div>
          <p className="mt-2 text-sm font-semibold text-slate-900">
            {selectedConfig?.payInMiles ? "Instant" : needsApproval ? "Approve first" : "Approved"}
          </p>
        </div>
      </div>

      {error ? (
        <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {success ? (
        <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {success}
        </div>
      ) : null}

      {!selectedConfig?.payInMiles ? (
        <div className="mt-3 flex items-center gap-2 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <WarningCircle size={18} className="shrink-0 text-cyan-700" />
          {needsApproval ? "Premium needs one-time approval." : "Premium approval is ready."}
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-3">
        {needsApproval ? (
          <Button
            title="Approve USDT"
            variant="outline"
            className="h-12 rounded-2xl border-slate-300"
            disabled={!address || !!actionLoading}
            onClick={onApprove}
          >
            {actionLoading === "approve" ? "Approving…" : "Approve USDT first"}
          </Button>
        ) : null}

        <Button
          title={`Start ${tierName(selectedTier)} claw`}
          className="h-14 rounded-2xl bg-slate-950 text-base text-white hover:bg-slate-800"
          disabled={!address || !selectedConfig?.active || !!actionLoading || loading}
          onClick={onStart}
        >
          {actionLoading === "start" ? "Starting…" : `Start ${tierName(selectedTier)} claw`}
        </Button>
      </div>
    </section>
  );
}
