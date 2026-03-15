import clawGameArtifact from "@/contexts/akibaClawGame.json";
import batchRngArtifact from "@/contexts/merkleBatchRng.json";
import { formatUnits } from "viem";

export const CLAW_GAME_ADDRESS = (process.env.NEXT_PUBLIC_CLAW_GAME_ADDRESS ?? "") as `0x${string}` | "";
export const CLAW_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CLAW_CHAIN_ID ?? "42220");
export const CLAW_RPC_URL =
  process.env.NEXT_PUBLIC_CLAW_RPC_URL ?? process.env.NEXT_PUBLIC_CELO_RPC_URL ?? "https://forno.celo.org";
export const CLAW_DEPLOY_BLOCK = BigInt(process.env.NEXT_PUBLIC_CLAW_DEPLOY_BLOCK ?? "0");
export const CLAW_USDT_ADDRESS =
  (process.env.NEXT_PUBLIC_CLAW_USDT_ADDRESS ??
    process.env.NEXT_PUBLIC_USDT_ADDRESS ??
    "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e") as `0x${string}`;
export const BATCH_RNG_ADDRESS =
  (process.env.NEXT_PUBLIC_BATCH_RNG_ADDRESS ?? "") as `0x${string}` | "";

export const clawGameAbi = clawGameArtifact.abi;
export const batchRngAbi = batchRngArtifact;

export type ClawRewardClass =
  | "none"
  | "lose"
  | "common"
  | "rare"
  | "epic"
  | "legendary";

export type ClawSessionStatus =
  | "none"
  | "pending"
  | "settled"
  | "claimed"
  | "burned"
  | "refunded";

export type ClawTierConfig = {
  active: boolean;
  tierId: number;
  payInMiles: boolean;
  playCost: bigint;
  loseWeight: number;
  commonWeight: number;
  rareWeight: number;
  epicWeight: number;
  legendaryWeight: number;
  commonMilesReward: bigint;
  rareBurnMiles: bigint;
  epicUsdtReward: bigint;
  legendaryBurnUsdt: bigint;
  rareVoucherBps: number;
  legendaryVoucherBps: number;
  legendaryVoucherCap: bigint;
  dailyPlayLimit: bigint;
  legendaryCooldown: bigint;
  defaultMerchantId: `0x${string}`;
};

export type BatchInventory = {
  batchId: bigint;
  loses: bigint;
  commons: bigint;
  rares: bigint;
  epics: bigint;
  legendarys: bigint;
  totalRemaining: bigint;
  totalPlays: bigint;
  active: boolean;
};

export type ClawSessionView = {
  sessionId: bigint;
  player: `0x${string}`;
  tierId: number;
  status: ClawSessionStatus;
  createdAt: bigint;
  settledAt: bigint;
  requestBlock: bigint;
  rewardClass: ClawRewardClass;
  rewardAmount: bigint;
  voucherId: bigint;
  canSettle: boolean;
};

export const CLAW_TIERS = [0, 1, 2] as const;

export const CLAW_TIER_STYLES: Record<number, { accent: string; bg: string; border: string; chip: string }> = {
  0: {
    accent: "text-emerald-700",
    bg: "from-emerald-100 via-white to-emerald-50",
    border: "border-emerald-200",
    chip: "bg-emerald-600",
  },
  1: {
    accent: "text-cyan-700",
    bg: "from-cyan-100 via-white to-sky-50",
    border: "border-cyan-200",
    chip: "bg-cyan-600",
  },
  2: {
    accent: "text-amber-700",
    bg: "from-amber-100 via-white to-orange-50",
    border: "border-amber-200",
    chip: "bg-amber-500",
  },
};

export function decodeRewardClass(value: bigint): ClawRewardClass {
  switch (Number(value)) {
    case 1:
      return "lose";
    case 2:
      return "common";
    case 3:
      return "rare";
    case 4:
      return "epic";
    case 5:
      return "legendary";
    default:
      return "none";
  }
}

export function decodeSessionStatus(value: bigint): ClawSessionStatus {
  switch (Number(value)) {
    case 1:
      return "pending";
    case 2:
      return "settled";
    case 3:
      return "claimed";
    case 4:
      return "burned";
    case 5:
      return "refunded";
    default:
      return "none";
  }
}

export function tierName(tierId: number) {
  if (tierId === 0) return "Basic";
  if (tierId === 1) return "Boosted";
  if (tierId === 2) return "Premium";
  return `Tier ${tierId}`;
}

export function rewardLabel(rewardClass: ClawRewardClass) {
  switch (rewardClass) {
    case "lose":
      return "No reward";
    case "common":
      return "AkibaMiles reward";
    case "rare":
      return "20% merchant voucher";
    case "epic":
      return "Direct USDT payout";
    case "legendary":
      return "100% merchant voucher";
    default:
      return "Awaiting outcome";
  }
}

export function clawStatusLabel(status: ClawSessionStatus) {
  switch (status) {
    case "pending":
      return "Revealing prize…";
    case "settled":
      return "Ready to claim";
    case "claimed":
      return "Reward claimed";
    case "burned":
      return "Voucher burned";
    case "refunded":
      return "Refunded";
    default:
      return "Unknown";
  }
}

export function formatClawAmount(value: bigint, decimals: number, suffix: string) {
  return `${Number(formatUnits(value, decimals)).toLocaleString(undefined, {
    maximumFractionDigits: decimals > 6 ? 2 : 4,
  })} ${suffix}`;
}

export function clawOddsLabel(weight: number) {
  return `${(weight / 100).toFixed(weight % 100 === 0 ? 0 : 1)}%`;
}
