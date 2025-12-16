// src/components/BadgesSection.tsx
"use client";

import { useRouter } from "next/navigation";
import { BadgeCard } from "@/components/badge-card";
import {
  BADGES,
  type BadgeProgress,
  EMPTY_BADGE_PROGRESS,
  tiersCompletedFromValue,
} from "@/lib/prosperityBadges";

type Props = {
  /** Map badge.key -> RAW metric (tx count / AkibaMiles), not steps */
  progress?: BadgeProgress;
};

export function BadgesSection({ progress }: Props) {
  const router = useRouter();
  const safeProgress = progress ?? EMPTY_BADGE_PROGRESS;

  return (
    <div className="mt-6">
      <div className="flex gap-3 overflow-x-auto px-4 pb-2">
        {BADGES.map((b) => {
          // RAW metric value for this badge (e.g. 73 tx, 2400 Miles, etc.)
          const value = safeProgress[b.key] ?? 0;

          // Completed tiers based on thresholds
          const completedSteps = tiersCompletedFromValue(value, b);

          return (
            <BadgeCard
              key={b.key}
              title={b.title}
              description={b.shortDescription}
              activeIcon={b.activeIcon}
              inactiveIcon={b.inactiveIcon}
              totalSteps={b.tiers.length}
              completedSteps={completedSteps}
              onClick={() => {
                // Pass the RAW metric to the detail page
                router.push(
                  `/badges/${b.key}?value=${encodeURIComponent(String(value))}`
                );
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
