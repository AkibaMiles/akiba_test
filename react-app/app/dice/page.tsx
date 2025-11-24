// app/dice/page.tsx
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";

import { useWeb3 } from "@/contexts/useWeb3";
import { ResultModal } from "@/components/dice/ResultModal";
import { DiceStatsSheet } from "@/components/dice/DiceStats";
import { DiceHeader } from "@/components/dice/DiceHeader";
import { DicePotCard } from "@/components/dice/DicePotCard";

import {
  type DiceTier,
  type DiceRoundView,
  type DiceRoundStateName,
  type TierStats,
  type PlayerStats,
} from "@/lib/diceTypes";

/* ────────────────────────────────────────────────────────────── */
/* Page                                                          */
/* ────────────────────────────────────────────────────────────── */

export default function DicePage() {
  const router = useRouter();
  const {
    address,
    fetchDiceRound,
    joinDice,
    getDiceTierStats,
    getDicePlayerStats,
    getLastResolvedRoundForPlayer,
  } = useWeb3();

  const [selectedTier, setSelectedTier] = useState<DiceTier>(10);

  const [round, setRound] = useState<DiceRoundView | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);

  // Last resolved round YOU participated in
  const [lastRound, setLastRound] = useState<DiceRoundView | null>(null);
  const [shownResultRoundId, setShownResultRoundId] =
    useState<bigint | null>(null);

  // modal / animation
  const [isRolling, setIsRolling] = useState(false);
  const [diceResult, setDiceResult] = useState<number | null>(null);
  const [lastResultMessage, setLastResultMessage] = useState<string | null>(
    null
  );
  const [showResultModal, setShowResultModal] = useState(false);

  // stats sheet
  const [tierStats, setTierStats] = useState<TierStats>(null);
  const [playerStats, setPlayerStats] = useState<PlayerStats>(null);
  const [statsOpen, setStatsOpen] = useState(false);

  /* ────────────────────────────────────────────────────────────── */
  /* Derived state                                                 */
  /* ────────────────────────────────────────────────────────────── */

  const potSize = useMemo(() => {
    const tier = round?.tier ?? selectedTier;
    return tier * 6;
  }, [round, selectedTier]);

  // "My number" in the *current* active round
  const myNumber: number | null = useMemo(() => {
    if (!round || !address) return null;
    const slot = round.slots.find(
      (s) =>
        s.player &&
        s.player.toLowerCase() ===
          (address as `0x${string}`).toLowerCase()
    );
    return slot ? slot.number : null;
  }, [round, address]);

  const hasWinner = !!round?.winner && !!round?.winningNumber;
  const logicalState: DiceRoundStateName = round?.state ?? "none";
  const isFinished = hasWinner;

  const hasJoinedInCurrent = myNumber != null;
  const hasJoinedActive = hasJoinedInCurrent && !isFinished;
  const hasJoinedLastResolved =
    !!lastRound && lastRound.myNumber != null;

  const displayState: DiceRoundStateName = isFinished
    ? "resolved"
    : logicalState;

  const canJoin =
    !!address &&
    !!selectedNumber &&
    !isJoining &&
    (!round || isFinished || round.filledSlots < 6);

  const modalSelectedNumber =
    lastRound?.myNumber ?? myNumber ?? null;

  /* ────────────────────────────────────────────────────────────── */
  /* Load active round + stats                                     */
  /* ────────────────────────────────────────────────────────────── */

  const loadRound = useCallback(
    async (tier: DiceTier) => {
      setIsLoading(true);
      try {
        const view = (await fetchDiceRound(tier)) as DiceRoundView;
        setRound(view);

        // If I'm in this round and it’s not resolved, keep my number selected
        if (address) {
          const mySlot = view.slots.find(
            (s) =>
              s.player &&
              s.player.toLowerCase() ===
                (address as `0x${string}`).toLowerCase()
          );
          if (mySlot && !view.winner) {
            setSelectedNumber(mySlot.number);
          } else {
            setSelectedNumber(null);
          }
        } else {
          setSelectedNumber(null);
        }

        getDiceTierStats(tier)
          .then(setTierStats)
          .catch((e) => console.warn("getDiceTierStats error", e));

        if (address) {
          getDicePlayerStats(address)
            .then(setPlayerStats)
            .catch((e) => console.warn("getDicePlayerStats error", e));
        }

        return view;
      } catch (e) {
        console.error("Failed to load dice round:", e);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [fetchDiceRound, getDiceTierStats, getDicePlayerStats, address]
  );

  useEffect(() => {
    loadRound(selectedTier);
  }, [selectedTier, loadRound]);

  // Poll active round every 15s
  useEffect(() => {
    const id = setInterval(() => {
      loadRound(selectedTier);
    }, 15000);
    return () => clearInterval(id);
  }, [selectedTier, loadRound]);

  /* ────────────────────────────────────────────────────────────── */
  /* Load last resolved round YOU joined                           */
  /* ────────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!address) {
      setLastRound(null);
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        const view = await getLastResolvedRoundForPlayer(selectedTier);
        if (!cancelled) {
          setLastRound(view);
        }
      } catch (e) {
        console.warn("getLastResolvedRoundForPlayer error", e);
      }
    };

    run();
    const id = setInterval(run, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [address, selectedTier, getLastResolvedRoundForPlayer]);

  /* ────────────────────────────────────────────────────────────── */
  /* Show result modal for last resolved round you joined          */
  /* ────────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!lastRound || !address) return;

    const { winner, winningNumber, myNumber: myNum, roundId } =
      lastRound;

    if (!winner || !winningNumber || !myNum) return;

    // Don’t re-show same round
    if (shownResultRoundId === roundId) return;

    setShownResultRoundId(roundId);
    setShowResultModal(true);
    setIsRolling(false);
    setDiceResult(winningNumber);
    setLastResultMessage(null);

    const iWon =
      winner.toLowerCase() ===
      (address as `0x${string}`).toLowerCase();

    if (!iWon) {
      setLastResultMessage(
        `Winning number was ${winningNumber}. Better luck next time.`
      );
    } else {
      setLastResultMessage(null); // winner copy handled in modal
    }
  }, [lastRound, address, shownResultRoundId]);

  /* ────────────────────────────────────────────────────────────── */
  /* Handlers                                                      */
  /* ────────────────────────────────────────────────────────────── */

  function handleSelectNumber(n: number) {
    if (isJoining) return;
    if (hasJoinedActive) return;

    // Don’t allow clicking a slot already owned by someone else
    if (round) {
      const slot = round.slots.find((s) => s.number === n);
      if (
        slot?.player &&
        (!address ||
          slot.player.toLowerCase() !== address.toLowerCase())
      ) {
        return;
      }
    }

    setSelectedNumber(n);
  }

  async function handleJoin() {
    if (!selectedNumber || !canJoin) return;
    if (!address) return;

    try {
      setIsJoining(true);

      // 1) Join on-chain
      await joinDice(selectedTier, selectedNumber);

      // 2) Refresh round + stats
      await loadRound(selectedTier);

      // 3) Randomness request is handled via backend / relayer
      //    (we already have requestRoundRandomness in the contract)
      //    so FE doesn't need to orchestrate anything here.
    } catch (e) {
      console.error(e);
    } finally {
      setIsJoining(false);
    }
  }

  /* ────────────────────────────────────────────────────────────── */
  /* Render                                                        */
  /* ────────────────────────────────────────────────────────────── */

  return (
    <main className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white text-slate-900">
      <div className="max-w-md mx-auto px-4 pb-24 pt-6 space-y-6 relative">
        <div className="pointer-events-none absolute -top-10 right-0 opacity-60 blur-sm">
          <div className="h-24 w-24 rounded-full bg-emerald-200/40" />
        </div>

        <DiceHeader
          onBack={() => router.back()}
          selectedTier={selectedTier}
          onTierChange={(tier) => {
            setSelectedTier(tier);
            setShownResultRoundId(null);
          }}
          tierStats={tierStats}
          playerStats={playerStats}
          onOpenStats={() => setStatsOpen(true)}
        />

        <DicePotCard
          round={round}
          selectedTier={selectedTier}
          potSize={potSize}
          selectedNumber={selectedNumber}
          myNumber={myNumber}
          isFinished={isFinished}
          hasJoinedActive={hasJoinedActive}
          hasJoinedLastResolved={hasJoinedLastResolved}
          displayState={displayState}
          onSelectNumber={handleSelectNumber}
          onJoin={handleJoin}
          canJoin={canJoin}
          isJoining={isJoining}
          isLoading={isLoading}
        />
      </div>

      {/* Result modal – for the last round YOU joined (winner + losers) */}
      <ResultModal
        open={showResultModal}
        onClose={() => setShowResultModal(false)}
        diceResult={diceResult}
        isRolling={isRolling}
        lastResultMessage={lastResultMessage}
        selectedNumber={modalSelectedNumber}
        potSize={potSize}
      />

      <DiceStatsSheet
        open={statsOpen}
        onClose={() => setStatsOpen(false)}
        selectedTier={selectedTier}
        tierStats={tierStats}
        playerStats={playerStats}
      />
    </main>
  );
}
