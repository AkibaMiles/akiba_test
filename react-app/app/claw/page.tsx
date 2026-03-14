"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  erc20Abi,
  formatUnits,
  getContract,
  http,
  parseAbi,
} from "viem";
import { useWeb3 } from "@/contexts/useWeb3";
import {
  CLAW_CHAIN_ID,
  CLAW_DEPLOY_BLOCK,
  CLAW_GAME_ADDRESS,
  CLAW_TIERS,
  CLAW_USDT_ADDRESS,
  clawGameAbi,
  decodeRewardClass,
  decodeSessionStatus,
  type ClawSessionView,
  type ClawTierConfig,
} from "@/lib/clawGame";
import { ClawHero } from "@/components/claw/ClawHero";
import { ClawInfoSheet } from "@/components/claw/ClawInfoSheet";
import { ClawSessionsList } from "@/components/claw/ClawSessionsList";
import { ClawTierSelector } from "@/components/claw/ClawTierSelector";
import { ClawMachineDisplay, type ClawGameState } from "@/components/claw/ClawMachineDisplay";
import { ClawActionBanner } from "@/components/claw/ClawActionBanner";

const clawChain = defineChain({
  id: CLAW_CHAIN_ID,
  name: CLAW_CHAIN_ID === 31337 ? "Hardhat Fork" : "Celo",
  nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_CLAW_RPC_URL ?? "https://forno.celo.org"] },
    public:  { http: [process.env.NEXT_PUBLIC_CLAW_RPC_URL ?? "https://forno.celo.org"] },
  },
});

const gameStartedAbi = parseAbi([
  "event GameStarted(uint256 indexed sessionId, address indexed player, uint8 indexed tierId, uint256 playCost, uint256 requestBlock)",
]);

export default function ClawPage() {
  const router = useRouter();
  const { address, getUserAddress, getakibaMilesBalance, getStableBalances } = useWeb3();

  const [tierConfigs, setTierConfigs]     = useState<Record<number, ClawTierConfig | null>>({});
  const [selectedTier, setSelectedTier]   = useState<(typeof CLAW_TIERS)[number]>(0);
  const [usdtAllowance, setUsdtAllowance] = useState<bigint>(0n);
  const [milesBalance, setMilesBalance]   = useState("0");
  const [usdtBalance, setUsdtBalance]     = useState(0);
  const [sessions, setSessions]           = useState<ClawSessionView[]>([]);
  const [loading, setLoading]             = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [infoOpen, setInfoOpen]           = useState(false);
  const [sessionsOpen, setSessionsOpen]   = useState(false);

  const publicClient = useMemo(
    () =>
      createPublicClient({
        chain: clawChain,
        transport:
          typeof window !== "undefined" && (window as any).ethereum
            ? custom((window as any).ethereum)
            : http(clawChain.rpcUrls.default.http[0]),
      }),
    [],
  );

  const selectedConfig = tierConfigs[selectedTier] ?? null;

  // ── Derived: most-actionable session ──────────────────────────────────────
  const activeSession = useMemo<ClawSessionView | null>(() => {
    const settled = sessions.find((s) => s.status === "settled");
    if (settled) return settled;
    const ready   = sessions.find((s) => s.status === "pending" && s.canSettle);
    if (ready)   return ready;
    return sessions.find((s) => s.status === "pending") ?? null;
  }, [sessions]);

  // ── Derived: visual game state ─────────────────────────────────────────────
  const gameState = useMemo<ClawGameState>(() => {
    if (actionLoading === "start")                    return "starting";
    if (actionLoading?.startsWith("settle-"))         return "settling";
    if (!activeSession)                               return "idle";
    if (activeSession.status === "settled")           return "settled";
    if (activeSession.canSettle)                      return "ready";
    return "pending";
  }, [actionLoading, activeSession]);

  // ── Cost / approve / balance labels ───────────────────────────────────────
  const costLabel = selectedConfig
    ? selectedConfig.payInMiles
      ? `${Number(formatUnits(selectedConfig.playCost, 18)).toFixed(0)} Mi`
      : `${Number(formatUnits(selectedConfig.playCost, 6)).toFixed(2)} USDT`
    : "…";

  const needsApprove =
    !!selectedConfig &&
    !selectedConfig.payInMiles &&
    usdtAllowance < selectedConfig.playCost;

  const hasSufficientBalance = useMemo(() => {
    if (!selectedConfig) return false;
    if (selectedConfig.payInMiles) {
      const cost = Number(formatUnits(selectedConfig.playCost, 18));
      return Number(milesBalance) >= cost;
    }
    const cost = Number(formatUnits(selectedConfig.playCost, 6));
    return usdtBalance >= cost;
  }, [selectedConfig, milesBalance, usdtBalance]);

  // ── Session badge count — all unresolved sessions ────────────────────────
  const urgentCount = useMemo(
    () => sessions.filter((s) => s.status === "settled" || s.status === "pending").length,
    [sessions],
  );

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => { void getUserAddress(); }, [getUserAddress]);

  // ── Load game data ─────────────────────────────────────────────────────────
  async function loadGame() {
    if (!CLAW_GAME_ADDRESS) {
      toast.error("NEXT_PUBLIC_CLAW_GAME_ADDRESS is not configured.");
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const contract = getContract({
        address: CLAW_GAME_ADDRESS,
        abi: clawGameAbi,
        client: publicClient,
      });

      const configs = await Promise.all(
        CLAW_TIERS.map(async (tierId) => {
          const cfg = (await contract.read.getTierConfig([tierId])) as any;
          return [
            tierId,
            {
              active: cfg.active,
              tierId: Number(cfg.tierId),
              payInMiles: cfg.payInMiles,
              playCost: cfg.playCost,
              loseWeight: Number(cfg.loseWeight),
              commonWeight: Number(cfg.commonWeight),
              rareWeight: Number(cfg.rareWeight),
              epicWeight: Number(cfg.epicWeight),
              legendaryWeight: Number(cfg.legendaryWeight),
              commonMilesReward: cfg.commonMilesReward,
              rareBurnMiles: cfg.rareBurnMiles,
              epicUsdtReward: cfg.epicUsdtReward,
              legendaryBurnUsdt: cfg.legendaryBurnUsdt,
              rareVoucherBps: Number(cfg.rareVoucherBps),
              legendaryVoucherBps: Number(cfg.legendaryVoucherBps),
              legendaryVoucherCap: cfg.legendaryVoucherCap,
              dailyPlayLimit: cfg.dailyPlayLimit,
              legendaryCooldown: cfg.legendaryCooldown,
              defaultMerchantId: cfg.defaultMerchantId,
            } satisfies ClawTierConfig,
          ] as const;
        }),
      );
      setTierConfigs(Object.fromEntries(configs));

      if (!address) { setSessions([]); return; }

      const latestBlock = await publicClient.getBlockNumber();
      const [miles, stables, logs, allowance] = await Promise.all([
        getakibaMilesBalance(),
        getStableBalances(),
        publicClient.getLogs({
          address: CLAW_GAME_ADDRESS,
          event: gameStartedAbi[0],
          args: { player: address as `0x${string}` },
          fromBlock:
            CLAW_DEPLOY_BLOCK > 0n
              ? CLAW_DEPLOY_BLOCK
              : latestBlock - 50_000n > 0n
              ? latestBlock - 50_000n
              : 0n,
          toBlock: "latest",
        }),
        publicClient.readContract({
          address: CLAW_USDT_ADDRESS,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address as `0x${string}`, CLAW_GAME_ADDRESS],
        }) as Promise<bigint>,
      ]);

      setMilesBalance(miles);
      setUsdtBalance(stables.usdt);
      setUsdtAllowance(allowance);

      const sessionIds = logs
        .map((log: any) => log.args?.sessionId as bigint | undefined)
        .filter(Boolean)
        .sort((a, b) => Number(b! - a!))
        .slice(0, 12) as bigint[];

      const hydrated = await Promise.all(
        sessionIds.map(async (sessionId) => {
          const [session, canSettle] = await Promise.all([
            contract.read.getSession([sessionId]),
            contract.read.canSettle([sessionId]),
          ]);
          const s = session as any;
          return {
            sessionId:    s.sessionId,
            player:       s.player,
            tierId:       Number(s.tierId),
            status:       decodeSessionStatus(s.status),
            createdAt:    s.createdAt,
            settledAt:    s.settledAt,
            requestBlock: s.requestBlock,
            rewardClass:  decodeRewardClass(s.rewardClass),
            rewardAmount: s.rewardAmount,
            voucherId:    s.voucherId,
            canSettle:    Boolean(canSettle),
          } satisfies ClawSessionView;
        }),
      );

      setSessions(hydrated);
    } catch (err: any) {
      console.error("[ClawPage] load failed", err);
      // silent – don't spam toasts on background polling errors
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadGame();
    const id = setInterval(() => { void loadGame(); }, 15000);
    return () => clearInterval(id);
  }, [address]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ────────────────────────────────────────────────────────────────
  async function getWalletClient() {
    if (typeof window === "undefined" || !(window as any).ethereum)
      throw new Error("Wallet not available");
    const wc = createWalletClient({ chain: clawChain, transport: custom((window as any).ethereum) });
    const chainId = await wc.getChainId();
    if (chainId !== CLAW_CHAIN_ID)
      throw new Error(`Wrong network. Switch to chain ${CLAW_CHAIN_ID}${CLAW_CHAIN_ID === 31337 ? " (Hardhat fork)" : ""}.`);
    return wc;
  }

  async function ensureUsdtAllowance() {
    if (!address || !selectedConfig || selectedConfig.payInMiles || usdtAllowance >= selectedConfig.playCost) return;
    const wc = await getWalletClient();
    setActionLoading("approve");
    try {
      const hash = await wc.writeContract({
        chain: clawChain,
        address: CLAW_USDT_ADDRESS,
        abi: erc20Abi,
        functionName: "approve",
        account: address as `0x${string}`,
        args: [CLAW_GAME_ADDRESS, selectedConfig.playCost],
      });
      await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
      toast.success("USDT approved — ready to play!");
      await loadGame();
    } finally {
      setActionLoading(null);
    }
  }

  async function handleStartGame() {
    if (!address || !selectedConfig) { toast.error("Connect your wallet first."); return; }
    try {
      if (!selectedConfig.payInMiles) await ensureUsdtAllowance();
      const wc = await getWalletClient();
      setActionLoading("start");
      const hash = await wc.writeContract({
        chain: clawChain,
        address: CLAW_GAME_ADDRESS,
        abi: clawGameAbi,
        functionName: "startGame",
        account: address as `0x${string}`,
        args: [selectedTier],
      });
      await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
      toast.success("🎰 Claw session started — oracle resolving…");
      await loadGame();
    } catch (err: any) {
      toast.error(err?.shortMessage ?? err?.message ?? "Failed to start claw game.");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleSessionAction(sessionId: bigint, action: "settle" | "claim" | "burn") {
    if (!address) { toast.error("Connect your wallet first."); return; }
    try {
      setActionLoading(`${action}-${sessionId.toString()}`);
      const wc = await getWalletClient();
      const hash = await wc.writeContract({
        chain: clawChain,
        address: CLAW_GAME_ADDRESS,
        abi: clawGameAbi,
        functionName:
          action === "settle" ? "settleGame" :
          action === "claim"  ? "claimReward" :
                                "burnVoucherReward",
        account: address as `0x${string}`,
        args: [sessionId],
      });
      await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
      toast.success(
        action === "settle" ? "✨ Outcome revealed!" :
        action === "claim"  ? "🎉 Reward claimed!"   :
                              "Voucher redeemed for fallback reward.",
      );
      await loadGame();
    } catch (err: any) {
      toast.error(err?.shortMessage ?? err?.message ?? `Failed to ${action} session.`);
    } finally {
      setActionLoading(null);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const isAnyLoading = !!actionLoading;
  const canPlay = !!address && !!selectedConfig && !isAnyLoading && !loading && hasSufficientBalance;

  const playLabel = (() => {
    if (actionLoading === "start") return "Starting…";
    if (loading && !sessions.length) return "Loading…";
    if (!address) return "Connect wallet to play";
    if (!hasSufficientBalance) {
      return selectedConfig?.payInMiles ? "Not enough Miles" : "Not enough USDT";
    }
    return `Pull the claw · ${costLabel}`;
  })();

  return (
    <main className="h-dvh overflow-hidden bg-[radial-gradient(circle_at_top,_#cffafe_0%,_#f8fafc_40%,_#ffffff_100%)] text-slate-900">
      <div className="mx-auto flex h-full max-w-md flex-col px-4 pt-4 pb-20">

        {/* ── Header ── */}
        <ClawHero
          onBack={() => router.back()}
          onOpenSessions={() => setSessionsOpen(true)}
          onOpenInfo={() => setInfoOpen(true)}
          urgentCount={urgentCount}
        />

        {/* ── Balance chips ── */}
        <div className="mt-2.5 flex gap-2">
          <div className={`flex flex-1 items-center gap-1.5 rounded-2xl border px-3 py-1.5 shadow-sm transition ${
            selectedConfig?.payInMiles && !hasSufficientBalance
              ? "border-red-200 bg-red-50"
              : "border-slate-100 bg-white"
          }`}>
            <Image src="/svg/minimiles-symbol.svg" alt="Miles" width={14} height={14} className="shrink-0" />
            <span className="text-[10px] font-medium text-slate-400">Mi</span>
            <span className={`ml-auto text-[12px] font-semibold ${
              selectedConfig?.payInMiles && !hasSufficientBalance ? "text-red-500" : "text-slate-800"
            }`}>
              {Number(milesBalance).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
          </div>
          <div className={`flex flex-1 items-center gap-1.5 rounded-2xl border px-3 py-1.5 shadow-sm transition ${
            selectedConfig && !selectedConfig.payInMiles && !hasSufficientBalance
              ? "border-red-200 bg-red-50"
              : "border-slate-100 bg-white"
          }`}>
            <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[8px] font-black text-white leading-none">T</span>
            <span className="text-[10px] font-medium text-slate-400">USDT</span>
            <span className={`ml-auto text-[12px] font-semibold ${
              selectedConfig && !selectedConfig.payInMiles && !hasSufficientBalance ? "text-red-500" : "text-slate-800"
            }`}>
              {usdtBalance.toFixed(2)}
            </span>
          </div>
        </div>

        {/* ── Machine (fills remaining space) ── */}
        <div className="mt-2 flex flex-1 min-h-0 items-center justify-center">
          <ClawMachineDisplay
            gameState={gameState}
            rewardClass={activeSession?.rewardClass ?? "none"}
          />
        </div>

        {/* ── Active session banner (only when action is available) ── */}
        {activeSession && (gameState === "ready" || gameState === "settled" || gameState === "settling") && (
          <div className="mt-2">
            <ClawActionBanner
              session={activeSession}
              actionLoading={actionLoading}
              onSettle={() => handleSessionAction(activeSession.sessionId, "settle")}
              onClaim={() => handleSessionAction(activeSession.sessionId, "claim")}
              onBurn={() => handleSessionAction(activeSession.sessionId, "burn")}
            />
          </div>
        )}

        {/* ── Tier selector ── */}
        <div className="mt-2">
          <ClawTierSelector
            selectedTier={selectedTier}
            tierConfigs={tierConfigs}
            onTierChange={setSelectedTier}
          />
        </div>

        {/* ── Play / Approve button ── */}
        <div className="mt-2">
          {needsApprove ? (
            <button
              onClick={ensureUsdtAllowance}
              disabled={isAnyLoading}
              className="w-full rounded-2xl bg-amber-500 py-3 text-sm font-semibold text-white shadow-md shadow-amber-200 transition active:scale-[0.98] disabled:opacity-50"
            >
              {actionLoading === "approve" ? "Approving…" : "Approve USDT to play"}
            </button>
          ) : (
            <button
              onClick={handleStartGame}
              disabled={!canPlay}
              className={`w-full rounded-2xl py-3 text-sm font-semibold text-white shadow-md transition active:scale-[0.98] disabled:opacity-50 ${
                !hasSufficientBalance && !!selectedConfig
                  ? "bg-slate-400 shadow-slate-200 cursor-not-allowed"
                  : "bg-gradient-to-r from-cyan-500 to-cyan-600 shadow-cyan-200"
              }`}
            >
              {playLabel}
            </button>
          )}
        </div>
      </div>

      {/* ── Bottom sheets ── */}
      <ClawSessionsList
        open={sessionsOpen}
        onOpenChange={setSessionsOpen}
        sessions={sessions}
        tierConfigs={tierConfigs}
        loading={loading}
        actionLoading={actionLoading}
        onAction={handleSessionAction}
      />

      <ClawInfoSheet
        open={infoOpen}
        onOpenChange={setInfoOpen}
        selectedConfig={selectedConfig}
        tierConfigs={tierConfigs}
      />
    </main>
  );
}
