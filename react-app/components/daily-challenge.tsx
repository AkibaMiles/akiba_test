"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { createClient } from "@supabase/supabase-js";
import { StreakInfoSheet } from "@/components/StreakDetailModal";
import { useWeb3 } from "@/contexts/useWeb3";

import {
  QuestClaimLoadingSheet,
  QuestClaimResultSheet,
} from "@/components/QuestClaimSheet";

import {
  claimBalanceStreak10,
  claimBalanceStreak30,
} from "@/helpers/claimBalanceStreak";
import { claimDailyQuest } from "@/helpers/claimDaily";
import { claimFiveTransfers } from "@/helpers/claimFiveTransfers";
import { claimTwentyTransfers } from "@/helpers/claimTwentyTransfers";
import { claimTenTransfers } from "@/helpers/claimTenTransfers";
import { claimTopupStreak } from "@/helpers/claimWeeklyTopup";

import { Cash, Door, akibaMilesSymbol } from "@/lib/svg";
import streakIcon from "@/public/svg/streak.svg";

/* ─── Supabase ───────────────────────────────────────────── */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    // fallback only to avoid breaking envs; remove asap
    (process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY as string),
);

const TOPUP_STREAK_QUEST_ID = "96009afb-0762-4399-adb3-ced421d73072";
const BALANCE_REFRESH_EVENT = "akiba:miles:refresh";

/* ─── tiny wrappers ───────────────────────────────────────── */

async function claimSevenDayStreak(addr: string) {
  const res = await fetch("/api/quests/seven_day_streak", {
    method: "POST",
    body: JSON.stringify({
      userAddress: addr,
      questId: "6ddc811a-1a4d-4e57-871d-836f07486531",
    }),
  }).then((r) => r.json());
  return res;
}

async function claimSendDollar(addr: string) {
  const res = await fetch("/api/quests/daily_transfer", {
    method: "POST",
    body: JSON.stringify({
      userAddress: addr,
      questId: "383eaa90-75aa-4592-a783-ad9126e8f04d",
    }),
  }).then((r) => r.json());
  return res;
}

async function claimReceiveDollar(addr: string) {
  const res = await fetch("/api/quests/daily_receive", {
    method: "POST",
    body: JSON.stringify({
      userAddress: addr,
      questId: "c6b14ae1-66e9-4777-9c9f-65e57b091b16",
    }),
  }).then((r) => r.json());
  return res;
}

/* ─── quest row type ─────────────────────────────────────── */
type QuestRow = {
  id: string;
  title: string;
  description: string;
  reward_points: number;
  is_active: boolean;
};

/** streaks table row */
type StreakRow = {
  quest_id: string;
  current_streak: number;
};

type QuestHandler = {
  action: (addr: string) => Promise<any>;
  img: any;
};

const ACTION_BY_ID: Record<string, QuestHandler> = {
  /* A. Daily login / check-in */
  "a9c68150-7db8-4555-b87f-5e9117b43a08": { action: claimDailyQuest, img: Door },

  /* B. Daily send ≥ $1 */
  "383eaa90-75aa-4592-a783-ad9126e8f04d": { action: claimSendDollar, img: Cash },

  /* C. Daily receive ≥ $1 */
  "c6b14ae1-66e9-4777-9c9f-65e57b091b16": { action: claimReceiveDollar, img: Cash },

  /* G. Weekly $5 top-up streak */
  "96009afb-0762-4399-adb3-ced421d73072": { action: claimTopupStreak, img: Cash },

  /* H. 7-day daily-quest streak */
  "6ddc811a-1a4d-4e57-871d-836f07486531": { action: claimSevenDayStreak, img: Cash },

  /* I. Wallet balance streak ≥ $10 */
  "feb6e5ef-7d9c-4ca6-a042-e2b692a6b00f": { action: claimBalanceStreak10, img: Cash },

  /* J. Wallet balance streak ≥ $30 */
  "a1ac5914-20d4-4436-bf02-29563938fe9d": { action: claimBalanceStreak30, img: Cash },

  /* D. Send 5 transfers */
  "f6d027d2-bf52-4768-a87f-2be00a5b03a0": { action: claimFiveTransfers, img: Cash },

  /* E. Send 10 transfers */
  "ea001296-2405-451b-a590-941af22a8df1": { action: claimTenTransfers, img: Cash },

  /* F. Send 20 transfers */
  "60320fa4-1681-4795-8818-429f11afe784": { action: claimTwentyTransfers, img: Cash },
};

/**
 * Which quests show the streak flame badge.
 */
const STREAK_QUEST_IDS = new Set<string>([
  "6ddc811a-1a4d-4e57-871d-836f07486531",
  "96009afb-0762-4399-adb3-ced421d73072",
  "feb6e5ef-7d9c-4ca6-a042-e2b692a6b00f",
  "a1ac5914-20d4-4436-bf02-29563938fe9d",
]);

/* Desired visual order */
const ORDERED_IDS = [
  "a9c68150-7db8-4555-b87f-5e9117b43a08",
  "383eaa90-75aa-4592-a783-ad9126e8f04d",
  "c6b14ae1-66e9-4777-9c9f-65e57b091b16",
  "feb6e5ef-7d9c-4ca6-a042-e2b692a6b00f",
  "a1ac5914-20d4-4436-bf02-29563938fe9d",
  "96009afb-0762-4399-adb3-ced421d73072",
  "6ddc811a-1a4d-4e57-871d-836f07486531",
  "f6d027d2-bf52-4768-a87f-2be00a5b03a0",
  "ea001296-2405-451b-a590-941af22a8df1",
  "60320fa4-1681-4795-8818-429f11afe784",
];

function sortByDesiredOrder(rows: QuestRow[]) {
  const pos = new Map(ORDERED_IDS.map((id, i) => [id, i]));
  return [...rows].sort((a, b) => {
    const ai = pos.has(a.id) ? (pos.get(a.id) as number) : Number.POSITIVE_INFINITY;
    const bi = pos.has(b.id) ? (pos.get(b.id) as number) : Number.POSITIVE_INFINITY;
    if (ai !== bi) return ai - bi;
    if (b.reward_points !== a.reward_points) return b.reward_points - a.reward_points;
    return a.title.localeCompare(b.title);
  });
}

export default function DailyChallenges({ showCompleted = false }: { showCompleted?: boolean }) {
  const { address, getUserAddress } = useWeb3();

  const [active, setActive] = useState<QuestRow[]>([]);
  const [completed, setCompleted] = useState<QuestRow[]>([]);
  const [loading, setLoading] = useState(true);

  // streak counts per questId
  const [streakCounts, setStreakCounts] = useState<Record<string, number>>({});

  // streak info sheet
  const [streakInfoOpen, setStreakInfoOpen] = useState(false);

  // loading + result sheets
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimLoadingOpen, setClaimLoadingOpen] = useState(false);

  const [resultOpen, setResultOpen] = useState(false);
  const [resultVariant, setResultVariant] = useState<"success" | "already" | "error">("success");
  const [resultTitle, setResultTitle] = useState("");
  const [resultMessage, setResultMessage] = useState("");

  // for nicer messaging
  const [lastQuestTitle, setLastQuestTitle] = useState<string>("");

  /* wallet */
  useEffect(() => {
    getUserAddress();
  }, [getUserAddress]);

  /* fetch quests + streaks */
  useEffect(() => {
    async function fetchAll() {
      const { data: quests } = await supabase
        .from("quests")
        .select("*")
        .eq("is_active", true);

      if (!quests) {
        setLoading(false);
        return;
      }

      if (!address) {
        setActive(sortByDesiredOrder(quests as QuestRow[]));
        setCompleted([]);
        setLoading(false);
        return;
      }

      const today = new Date().toISOString().slice(0, 10);

      const { data: eng } = await supabase
        .from("daily_engagements")
        .select("quest_id")
        .eq("user_address", address)
        .eq("claimed_at", today);

      const claimed = new Set(eng?.map((e) => e.quest_id));

      const activeQs = (quests as QuestRow[]).filter((q) => !claimed.has(q.id));
      const completedQs = (quests as QuestRow[]).filter((q) => claimed.has(q.id));

      setActive(sortByDesiredOrder(activeQs));
      setCompleted(sortByDesiredOrder(completedQs));

      // streaks table stores user_address in LOWERCASE
      const userLc = address.toLowerCase();

      try {
        const { data: streakRows, error: streakErr } = await supabase
          .from("streaks")
          .select("quest_id, current_streak")
          .eq("user_address", userLc);

        if (streakErr) {
          console.error("[daily-challenge] streaks fetch error:", streakErr);
        } else if (streakRows) {
          const map: Record<string, number> = {};
          (streakRows as StreakRow[]).forEach((row) => {
            if (STREAK_QUEST_IDS.has(row.quest_id)) map[row.quest_id] = row.current_streak;
          });
          setStreakCounts(map);
        }
      } catch (err) {
        console.error("[daily-challenge] streaks fetch threw:", err);
      }

      setLoading(false);
    }

    void fetchAll();
  }, [address]);

  const quests = showCompleted ? completed : active;

  async function runQuest(q: QuestRow) {
    if (showCompleted) return;
    if (!address) return;
    if (claimBusy) return;

    const map = ACTION_BY_ID[q.id];
    if (!map) return;

    setClaimBusy(true);
    setLastQuestTitle(q.title);

    // open loading sheet immediately
    setClaimLoadingOpen(true);

    try {
      const res: any = await map.action(address);

      if (res?.success) {
        setActive((cur) => sortByDesiredOrder(cur.filter((x) => x.id !== q.id)));
        setCompleted((cur) => sortByDesiredOrder([...cur, q]));

         // ✅ Refresh miles balance on homepage
  window.dispatchEvent(new Event(BALANCE_REFRESH_EVENT));
        // update streak UI if needed
        if (STREAK_QUEST_IDS.has(q.id)) {
          setStreakCounts((prev) => {
            const current = prev[q.id] ?? 0;
            let serverCount: number | undefined;
            if (typeof res.currentStreak === "number") serverCount = res.currentStreak;
            if (typeof res.streak === "number") serverCount = res.streak;
            return { ...prev, [q.id]: serverCount ?? current + 1 };
          });
        }

        setResultVariant("success");
        setResultTitle("Claim Successful!");
        setResultMessage(`You claimed ${q.reward_points} AkibaMiles.`);
      } else if (res?.code === "already") {
        setResultVariant("already");
        setResultTitle("Already claimed");

        if (q.id === TOPUP_STREAK_QUEST_ID && res.nextClaimDate) {
          setResultMessage(
            `You’ve already claimed your top-up streak for this week.\n\nNext claim date: ${res.nextClaimDate}`,
          );
        } else {
          setResultMessage(res.message || "You’ve already claimed this reward.");
        }
      } else if (res?.code === "condition-failed" && typeof res.missingUsd === "number") {
        const current =
          typeof res.currentUsd === "number"
            ? res.currentUsd.toFixed(2)
            : typeof res.totalUsd === "number"
            ? res.totalUsd.toFixed(2)
            : undefined;

        const missing = res.missingUsd.toFixed(2);

        setResultVariant("error");
        setResultTitle("Not eligible yet");

        if (q.id === TOPUP_STREAK_QUEST_ID) {
          setResultMessage(
            `You need $${missing} more in MiniPay top-ups this week to complete this streak.` +
              (current ? `\n\nCurrent top-ups this week: $${current}.` : ""),
          );
        } else {
          setResultMessage(
            res.message ||
              (current
                ? `You currently have $${current}. Top up $${missing} more to qualify.`
                : `Top up $${missing} more to qualify.`),
          );
        }
      } else {
        setResultVariant("error");
        setResultTitle("Claim failed");
        setResultMessage(res?.message || "Network or contract error");
      }
    } catch (e) {
      console.error(e);
      setResultVariant("error");
      setResultTitle("Claim failed");
      setResultMessage("Network or contract error");
    } finally {
      setClaimLoadingOpen(false);
      setResultOpen(true);
      setClaimBusy(false);
    }
  }

  if (loading) return null;

  return (
    <>
      {quests.length === 0 && (
        <p className="my-4 text-sm text-gray-500">
          {showCompleted
            ? "You haven’t completed any challenges today."
            : "No more challenges today — come back tomorrow!"}
        </p>
      )}

      {quests.length > 0 && (
        <div className="mt-4 flex space-x-3 overflow-x-auto">
          {quests.map((q) => {
            const map = ACTION_BY_ID[q.id];
            if (!map) return null;

            const isStreak = STREAK_QUEST_IDS.has(q.id);
            const streakCount = streakCounts[q.id] ?? 0;
            const showNumber = streakCount > 0;

            return (
              <button
                key={q.id}
                disabled={showCompleted || claimBusy}
                onClick={() => runQuest(q)}
                className={`relative flex-none h-60 w-44 rounded-xl p-4 shadow-xl
                  ${
                    showCompleted
                      ? "bg-blue-50 opacity-70 cursor-default"
                      : claimBusy
                      ? "bg-white border border-[#238D9D4D] opacity-70 cursor-not-allowed"
                      : "bg-white border border-[#238D9D4D]"
                  }`}
              >
                {isStreak && (
                  <div
                    className="
                      absolute right-2 top-2
                      flex h-7 items-center
                      rounded-full bg-[#238D9D]
                      px-2
                      cursor-pointer
                    "
                    onClick={(e) => {
                      e.stopPropagation(); // don’t trigger runQuest
                      setStreakInfoOpen(true);
                    }}
                  >
                    {showNumber && (
                      <span className="mr-1 text-[11px] font-semibold leading-none text-white">
                        {streakCount}
                      </span>
                    )}
                    <Image src={streakIcon} alt="Streak" className="h-5 w-5" />
                  </div>
                )}

                <div className="flex h-full flex-col items-center justify-between text-center">
                  <Image src={map.img} alt="" className="mx-auto" />
                  <p className="mt-2 text-sm font-medium">{q.title}</p>
                  <p className="mt-1 px-1 text-xs leading-4 font-poppins text-gray-600 break-words">
                    {q.description}
                  </p>
                  <p className="mt-2 flex items-center text-xs">
                    <Image src={akibaMilesSymbol} alt="" className="mr-1" />
                    {q.reward_points} AkibaMiles
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <StreakInfoSheet open={streakInfoOpen} onOpenChange={setStreakInfoOpen} />

      {/* Bottom loading sheet */}
      <QuestClaimLoadingSheet
        open={claimLoadingOpen}
        onOpenChange={setClaimLoadingOpen}
        title="Claiming reward"
        message={
          lastQuestTitle
            ? `Claiming “${lastQuestTitle}”… This usually takes a few seconds.`
            : "Processing your claim… This usually takes a few seconds."
        }
      />

      {/* Bottom result sheet */}
      <QuestClaimResultSheet
        open={resultOpen}
        onOpenChange={setResultOpen}
        variant={resultVariant}
        title={resultTitle}
        message={resultMessage}
      />
    </>
  );
}
