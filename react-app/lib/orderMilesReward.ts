import { supabase } from "@/lib/supabaseClient";
import { safeMintMiniPoints } from "@/lib/minipoints";

export const ORDER_MILES_REWARD = 200;
export const ORDER_REWARD_MAX_ATTEMPTS = 5;

export type RewardStatus = "pending" | "processing" | "completed" | "failed";

type RewardOrderRow = {
  id: string;
  user_address: string;
  miles_reward_status: RewardStatus | null;
  miles_reward_attempts: number | null;
};

export async function processOrderMilesReward(
  order: RewardOrderRow,
): Promise<{ ok: boolean; status: RewardStatus; txHash?: string; error?: string }> {
  const attempts = order.miles_reward_attempts ?? 0;

  if (order.miles_reward_status === "completed") {
    return { ok: true, status: "completed" };
  }

  if (attempts >= ORDER_REWARD_MAX_ATTEMPTS) {
    return { ok: false, status: "failed", error: "Max reward attempts reached" };
  }

  const nextAttempts = attempts + 1;

  const { error: lockErr } = await supabase
    .from("voucher_orders")
    .update({
      miles_reward_status: "processing",
      miles_reward_attempts: nextAttempts,
      miles_reward_error: null,
    })
    .eq("id", order.id)
    .neq("miles_reward_status", "completed");

  if (lockErr) {
    throw new Error("Failed to mark reward as processing");
  }

  try {
    const txHash = await safeMintMiniPoints({
      to: order.user_address as `0x${string}`,
      points: ORDER_MILES_REWARD,
      reason: `order_reward:${order.id}`,
    });

    const { error: completeErr } = await supabase
      .from("voucher_orders")
      .update({
        miles_rewarded: true,
        miles_reward_status: "completed",
        miles_reward_tx_hash: txHash,
        miles_reward_error: null,
      })
      .eq("id", order.id);

    if (completeErr) {
      throw new Error("Reward minted but failed to persist completion state");
    }

    return { ok: true, status: "completed", txHash };
  } catch (error: any) {
    const finalStatus: RewardStatus =
      nextAttempts >= ORDER_REWARD_MAX_ATTEMPTS ? "failed" : "pending";
    const message = String(error?.message ?? "Reward mint failed");

    await supabase
      .from("voucher_orders")
      .update({
        miles_rewarded: false,
        miles_reward_status: finalStatus,
        miles_reward_error: message,
      })
      .eq("id", order.id);

    return { ok: false, status: finalStatus, error: message };
  }
}

export async function processOrderMilesRewardById(orderId: string) {
  const { data: order, error } = await supabase
    .from("voucher_orders")
    .select("id, user_address, miles_reward_status, miles_reward_attempts")
    .eq("id", orderId)
    .maybeSingle();

  if (error || !order) {
    throw new Error("Order reward record not found");
  }

  return processOrderMilesReward(order as RewardOrderRow);
}
