"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
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
  BATCH_RNG_ADDRESS,
  batchRngAbi,
  CLAW_CHAIN_ID,
  CLAW_DEPLOY_BLOCK,
  CLAW_GAME_ADDRESS,
  CLAW_TIERS,
  CLAW_USDT_ADDRESS,
  clawGameAbi,
  decodeRewardClass,
  decodeSessionStatus,
  type BatchInventory,
  type ClawSessionView,
  type ClawTierConfig,
} from "@/lib/clawGame";
import { ClawHero } from "@/components/claw/ClawHero";
import { ClawInfoSheet } from "@/components/claw/ClawInfoSheet";
import { ClawSessionsList } from "@/components/claw/ClawSessionsList";
import { ClawTierSelector } from "@/components/claw/ClawTierSelector";
import { ClawMachineDisplay, type ClawGameState } from "@/components/claw/ClawMachineDisplay";
import { ClawActionBanner } from "@/components/claw/ClawActionBanner";
import { BatchInventoryBar } from "@/components/claw/BatchInventoryBar";

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
  const [batchInventory, setBatchInventory] = useState<BatchInventory | null>(null);
  const [loading, setLoading]             = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [refreshing, setRefreshing]       = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [infoOpen, setInfoOpen]           = useState(false);
  const [sessionsOpen, setSessionsOpen]   = useState(false);
  const settleRequestsRef = useRef<Map<string, number>>(new Map());
  const batchEnsureRef = useRef<number>(0);

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
  const latestUnresolvedSession = useMemo<ClawSessionView | null>(
    () => sessions.find((s) => s.status === "pending" || s.status === "settled") ?? null,
    [sessions],
  );

  const activeSession = useMemo<ClawSessionView | null>(() => {
    if (latestUnresolvedSession) return latestUnresolvedSession;
    return (
      sessions.find(
        (s) => s.status === "claimed" && (s.rewardClass === "rare" || s.rewardClass === "legendary"),
      ) ?? null
    );
  }, [latestUnresolvedSession, sessions]);

  // ── Derived: visual game state ─────────────────────────────────────────────
  const gameState = useMemo<ClawGameState>(() => {
    if (actionLoading === "start")                    return "starting";
    if (actionLoading?.startsWith("settle-"))         return "settling";
    if (!activeSession)                               return "idle";
    if (activeSession.status === "claimed")           return "settled";
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

  // ── Session badge count — sessions needing attention ─────────────────────
  const urgentCount = useMemo(
    () => sessions.filter((s) =>
      s.status === "pending" ||
      s.status === "settled" ||
      (s.status === "claimed" && (s.rewardClass === "rare" || s.rewardClass === "legendary")),
    ).length,
    [sessions],
  );

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => { void getUserAddress(); }, [getUserAddress]);

  // ── Load game data ─────────────────────────────────────────────────────────
  async function requestAutoSettle(sessionId: bigint, options?: { force?: boolean }) {
    const key = sessionId.toString();
    const now = Date.now();
    const nextAllowedAt = settleRequestsRef.current.get(key) ?? 0;
    if (!options?.force && now < nextAllowedAt) return null;

    settleRequestsRef.current.set(key, now + 8000);
    try {
      const res = await fetch("/api/claw/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: key }),
      });
      const payload = await res.json().catch(() => null);
      if (res.status === 200) {
        settleRequestsRef.current.delete(key);
      } else if (res.status === 202) {
        settleRequestsRef.current.set(key, Date.now() + 5000);
      } else {
        settleRequestsRef.current.set(key, Date.now() + 8000);
      }
      return payload;
    } catch (err) {
      console.error("[ClawPage] auto-settle failed", err);
      settleRequestsRef.current.set(key, Date.now() + 8000);
      return null;
    }
  }

  async function ensureActiveBatch(options?: { force?: boolean; silent?: boolean }) {
    if (!BATCH_RNG_ADDRESS) return true;

    const now = Date.now();
    if (!options?.force && now < batchEnsureRef.current) return true;

    batchEnsureRef.current = now + 15000;
    try {
      const res = await fetch("/api/claw/rotate/ensure", { method: "POST" });
      const payload = await res.json().catch(() => null);
      if (!res.ok || payload?.ok === false) {
        if (!options?.silent) {
          toast.error(payload?.error ?? "Failed to prepare the next claw batch.");
        }
        return false;
      }

      if (payload?.opened) {
        setBatchInventory((current) => ({
          batchId: BigInt(payload.batchId),
          loses: current?.loses ?? 0n,
          commons: current?.commons ?? 0n,
          rares: current?.rares ?? 0n,
          epics: current?.epics ?? 0n,
          legendarys: current?.legendarys ?? 0n,
          totalRemaining: BigInt(payload.totalRemaining),
          totalPlays: BigInt(payload.totalPlays),
          active: true,
        }));
        if (!options?.silent) {
          toast.success("Fresh claw batch loaded.");
        }
      }

      batchEnsureRef.current = payload?.opened ? 0 : Date.now() + 15000;
      return true;
    } catch (err) {
      console.error("[ClawPage] ensure batch failed", err);
      if (!options?.silent) {
        toast.error("Failed to prepare the next claw batch.");
      }
      batchEnsureRef.current = Date.now() + 15000;
      return false;
    }
  }

  async function loadGame() {
    if (!CLAW_GAME_ADDRESS) {
      toast.error("NEXT_PUBLIC_CLAW_GAME_ADDRESS is not configured.");
      setLoading(false);
      return;
    }

    if (!hasLoadedOnce) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

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

      // Load batch inventory if MerkleBatchRng is configured
      if (BATCH_RNG_ADDRESS) {
        try {
          const inv = await publicClient.readContract({
            address: BATCH_RNG_ADDRESS,
            abi: batchRngAbi,
            functionName: "getActiveBatchInventory",
          }) as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean];
          setBatchInventory({
            batchId:        inv[0],
            loses:          inv[1],
            commons:        inv[2],
            rares:          inv[3],
            epics:          inv[4],
            legendarys:     inv[5],
            totalRemaining: inv[6],
            totalPlays:     inv[7],
            active:         inv[8],
          });
          if (!inv[8]) {
            void ensureActiveBatch({ silent: true });
          }
        } catch {
          // Batch RNG not deployed yet — silently skip
        }
      }

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

      // Auto-drive only the newest unresolved session through the relayer.
      // Older resolved sessions should not keep the page looking active.
      const newestUnresolved =
        hydrated.find((s) => s.status === "pending" || s.status === "settled") ?? null;
      if (newestUnresolved) {
        void requestAutoSettle(newestUnresolved.sessionId);
      }
    } catch (err: any) {
      console.error("[ClawPage] load failed", err);
      // silent – don't spam toasts on background polling errors
    } finally {
      setLoading(false);
      setRefreshing(false);
      setHasLoadedOnce(true);
    }
  }

  useEffect(() => {
    void loadGame();
    const id = setInterval(() => { void loadGame(); }, 3000);
    return () => clearInterval(id);
  }, [address]); // eslint-disable-line react-hooks/exhaustive-deps

  const sessionsSheetLoading = !hasLoadedOnce && loading;

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
      if (BATCH_RNG_ADDRESS && batchInventory?.active === false) {
        setActionLoading("start");
        const ready = await ensureActiveBatch({ force: true });
        if (!ready) return;
        await loadGame();
      }
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
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
      toast.success("🎰 Claw in motion — revealing prize…");

      // Parse GameStarted log from the receipt and fire the settle API
      try {
        const { parseEventLogs } = await import("viem");
        const [startedEvent] = parseEventLogs({ abi: gameStartedAbi, logs: receipt.logs });
        if (startedEvent?.args?.sessionId != null) {
          setActionLoading("resolve");
          await requestAutoSettle(startedEvent.args.sessionId, { force: true });
        }
      } catch { /* parsing failed — cron will retry */ }

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

      if (action === "settle" || action === "claim") {
        await requestAutoSettle(sessionId, { force: true });
        await loadGame();
        toast.success("Refreshing reward status…");
        return;
      }

      const wc = await getWalletClient();
      const hash = await wc.writeContract({
        chain: clawChain,
        address: CLAW_GAME_ADDRESS,
        abi: clawGameAbi,
        functionName:
          "burnVoucherReward",
        account: address as `0x${string}`,
        args: [sessionId],
      });
      await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
      toast.success(
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
  const batchReady = !BATCH_RNG_ADDRESS || batchInventory?.active !== false;
  const canPlay = !!address && !!selectedConfig && !isAnyLoading && hasSufficientBalance && batchReady;

  const playLabel = (() => {
    if (actionLoading === "start") return "Starting…";
    if (!hasLoadedOnce && loading && !sessions.length) return "Loading…";
    if (!address) return "Connect wallet to play";
    if (!batchReady) return "Preparing next batch…";
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

        {/* ── Batch inventory ── */}
        {(BATCH_RNG_ADDRESS || batchInventory) && (
          <div className="mt-2">
            <BatchInventoryBar inventory={batchInventory} loading={loading && !batchInventory} />
          </div>
        )}

        {/* ── Machine (fills remaining space) ── */}
        <div className="mt-2 flex flex-1 min-h-0 items-center justify-center">
          <ClawMachineDisplay
            gameState={gameState}
            rewardClass={activeSession?.rewardClass ?? "none"}
          />
        </div>

        {/* ── Active session banner ── */}
        {activeSession && (activeSession.status === "pending" || activeSession.status === "settled" || activeSession.status === "claimed") && (
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
        loading={sessionsSheetLoading}
        refreshing={refreshing}
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
