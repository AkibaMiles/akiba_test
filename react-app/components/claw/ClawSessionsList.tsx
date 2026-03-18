"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { ClockCountdown, Gift, HandTap, Sparkle, Trophy } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  clawStatusLabel,
  formatClawAmount,
  rewardLabel,
  tierName,
  type ClawSessionView,
  type ClawTierConfig,
} from "@/lib/clawGame";

function buildVoucherQrUrl(session: ClawSessionView, tierConfig: ClawTierConfig): string {
  const discountBps =
    session.rewardClass === "legendary"
      ? tierConfig.legendaryVoucherBps
      : tierConfig.rareVoucherBps;
  const expiresAt = new Date(
    (Number(session.settledAt) + 14 * 24 * 3600) * 1000,
  ).toISOString();
  const payload = JSON.stringify({
    type: "claw_voucher",
    voucherId: session.voucherId.toString(),
    owner: session.player,
    discountBps,
    expiresAt,
  });
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(payload)}`;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: ClawSessionView[];
  tierConfigs: Record<number, ClawTierConfig | null>;
  loading: boolean;
  refreshing?: boolean;
  actionLoading: string | null;
  onAction: (sessionId: bigint, action: "settle" | "claim" | "burn") => Promise<void> | void;
};

function sessionAmountLabel(session: ClawSessionView) {
  if (session.rewardClass === "common" || session.rewardClass === "rare") {
    return formatClawAmount(session.rewardAmount, 18, "Miles");
  }
  if (session.rewardClass === "epic" || session.rewardClass === "legendary") {
    return formatClawAmount(session.rewardAmount, 6, "USDT");
  }
  return "No payout";
}

function sessionIcon(session: ClawSessionView) {
  if (session.rewardClass === "legendary") return <Trophy size={18} className="text-amber-600" weight="fill" />;
  if (session.rewardClass === "rare" || session.rewardClass === "epic") {
    return <Gift size={18} className="text-cyan-700" weight="fill" />;
  }
  if (session.status === "pending") return <ClockCountdown size={18} className="text-slate-500" weight="fill" />;
  return <Sparkle size={18} className="text-emerald-600" weight="fill" />;
}

export function ClawSessionsList({
  open,
  onOpenChange,
  sessions,
  tierConfigs,
  loading,
  refreshing = false,
  actionLoading,
  onAction,
}: Props) {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.sessionId.toString() === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  );

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(nextOpen) => {
          onOpenChange(nextOpen);
          if (!nextOpen) {
            setSelectedSessionId(null);
          }
        }}
      >
        <SheetContent
          side="bottom"
          className="max-h-[85vh] overflow-auto rounded-t-[28px] bg-white px-4 pb-8 pt-6 font-sterling"
        >
          <SheetHeader className="mb-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <HandTap size={18} className="text-cyan-700" />
                <SheetTitle className="text-left text-xl font-semibold text-slate-950">Sessions</SheetTitle>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                {sessions.length}
              </span>
            </div>
            {refreshing ? (
              <p className="text-left text-[11px] text-slate-400">Refreshing in background…</p>
            ) : null}
          </SheetHeader>

          {loading ? (
            <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-8 text-center text-sm text-slate-500">
              Loading sessions…
            </div>
          ) : sessions.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-center text-sm text-slate-500">
              Your recent claw plays will show here.
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map((session) => (
                <button
                  key={session.sessionId.toString()}
                  type="button"
                  onClick={() => setSelectedSessionId(session.sessionId.toString())}
                  className="flex w-full items-center gap-3 rounded-[22px] border border-slate-200 bg-slate-50 px-3 py-3 text-left transition hover:border-cyan-200 hover:bg-cyan-50/60"
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white shadow-sm">
                    {sessionIcon(session)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-semibold text-slate-950">
                        {tierName(session.tierId)}
                      </p>
                      <span className="text-[11px] font-medium text-slate-500">
                        #{session.sessionId.toString()}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-slate-600">
                      {clawStatusLabel(session.status)}
                      {session.status !== "pending" ? ` · ${rewardLabel(session.rewardClass)}` : ""}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={!!selectedSession} onOpenChange={(open) => setSelectedSessionId(open ? selectedSessionId : null)}>
        <SheetContent
          side="bottom"
          className="max-h-[85vh] overflow-auto rounded-t-[28px] bg-white px-4 pb-8 pt-6 font-sterling"
        >
          {selectedSession ? (
            <>
              <SheetHeader className="mb-5">
                <SheetTitle className="text-left text-xl font-semibold text-slate-950">
                  {tierName(selectedSession.tierId)}
                </SheetTitle>
              </SheetHeader>

              <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm">
                    {sessionIcon(selectedSession)}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-950">
                      {clawStatusLabel(selectedSession.status)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Session #{selectedSession.sessionId.toString()}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-2xl bg-white p-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Reward</p>
                    <p className="mt-2 font-semibold text-slate-900">
                      {rewardLabel(selectedSession.rewardClass)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white p-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Fallback</p>
                    <p className="mt-2 font-semibold text-slate-900">
                      {sessionAmountLabel(selectedSession)}
                    </p>
                  </div>
                </div>
              </div>

              {tierConfigs[selectedSession.tierId] ? (
                <div className="mt-4 rounded-[24px] border border-slate-200 bg-white p-4 text-sm text-slate-600">
                  <p className="font-semibold text-slate-950">Tier rewards</p>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div className="rounded-2xl bg-slate-50 p-3">
                      <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Common</p>
                      <p className="mt-2 font-semibold text-slate-900">
                        {formatClawAmount(tierConfigs[selectedSession.tierId]!.commonMilesReward, 18, "Miles")}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-3">
                      <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Epic</p>
                      <p className="mt-2 font-semibold text-slate-900">
                        {formatClawAmount(tierConfigs[selectedSession.tierId]!.epicUsdtReward, 6, "USDT")}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* ── Voucher QR card (claimed rare/legendary with a live voucherId) ── */}
              {selectedSession.status === "claimed" &&
              (selectedSession.rewardClass === "rare" || selectedSession.rewardClass === "legendary") &&
              selectedSession.voucherId > 0n &&
              tierConfigs[selectedSession.tierId] ? (() => {
                const tc = tierConfigs[selectedSession.tierId]!;
                const label = selectedSession.rewardClass === "legendary" ? "100% off voucher" : "20% off voucher";
                const qrUrl = buildVoucherQrUrl(selectedSession, tc);
                const expiryDate = new Date(
                  (Number(selectedSession.settledAt) + 14 * 24 * 3600) * 1000,
                ).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
                return (
                  <div className="mt-4 rounded-[24px] border border-slate-200 bg-white p-4">
                    <div className="mb-3 text-center">
                      <p className="text-sm font-semibold text-slate-900">{label}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">Valid at any participating merchant</p>
                    </div>
                    <div className="flex justify-center">
                      <Image src={qrUrl} alt="Voucher QR code" width={200} height={200} unoptimized />
                    </div>
                    <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-center">
                      <p className="text-[10px] text-slate-400">Voucher ID</p>
                      <p className="mt-1 font-mono text-sm font-semibold text-slate-800">
                        #{selectedSession.voucherId.toString()}
                      </p>
                    </div>
                    <p className="mt-2 text-center text-[10px] text-slate-400">Expires {expiryDate}</p>
                  </div>
                );
              })() : null}

              <div className="mt-5 flex flex-col gap-3">
                {selectedSession.status === "pending" ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    This play is still processing. No extra action should be needed.
                  </div>
                ) : null}

                {selectedSession.status === "settled" ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    Reward processing is automatic. Use the fallback action below only if it stays stuck.
                  </div>
                ) : null}

                {(selectedSession.status === "settled" || selectedSession.status === "claimed") &&
                (selectedSession.rewardClass === "rare" || selectedSession.rewardClass === "legendary") ? (
                  <Button
                    title="Burn voucher"
                    variant="outline"
                    className="h-12 rounded-2xl border-slate-300"
                    disabled={!!actionLoading}
                    onClick={() => onAction(selectedSession.sessionId, "burn")}
                  >
                    {actionLoading === `burn-${selectedSession.sessionId.toString()}`
                      ? "Burning…"
                      : "Use Miles/USDT instead"}
                  </Button>
                ) : null}

                {selectedSession.status === "settled" ? (
                  <Button
                    title="Retry backend resolution"
                    variant="outline"
                    className="h-12 rounded-2xl border-slate-300"
                    disabled={!!actionLoading}
                    onClick={() => onAction(selectedSession.sessionId, "claim")}
                  >
                    {actionLoading === `claim-${selectedSession.sessionId.toString()}`
                      ? "Retrying…"
                      : "Retry auto-resolve"}
                  </Button>
                ) : null}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
