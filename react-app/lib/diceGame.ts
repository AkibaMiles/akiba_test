// lib/diceGame.ts

export const TIERS = [10, 20, 30] as const;
export type Tier = (typeof TIERS)[number];

export type SlotState = {
  number: number;
  takenBy?: string; // address/username later
};

export type PotState = {
  tier: Tier;
  slots: SlotState[];
  filledCount: number;
};

export function shortAddr(i: number) {
  return `0x${(1000 + i).toString(16)}…${(9000 + i).toString(16)}`;
}

/**
 * Demo pot: 5 filled, 1 free so you can simulate the last slot & modal.
 */
// lib/diceGame.ts

// lib/diceGame.ts

export function createDemoPot(tier: Tier): PotState {
    const slots: SlotState[] = Array.from({ length: 6 }, (_, idx) => ({
      number: idx + 1,
      // no takenBy → all are free
    }));
  
    return {
      tier,
      slots,
      filledCount: 0, // nobody has joined yet
    };
  }
  
  
