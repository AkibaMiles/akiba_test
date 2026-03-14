import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import {
  ORDER_REWARD_MAX_ATTEMPTS,
  processOrderMilesReward,
  type RewardStatus,
} from "@/lib/orderMilesReward";

const PROCESS_LIMIT = 25;

type RewardQueueRow = {
  id: string;
  user_address: string;
  miles_reward_status: RewardStatus | null;
  miles_reward_attempts: number | null;
};

function isAuthorized(req: Request) {
  const secret = process.env.ORDER_REWARDS_PROCESS_SECRET;
  if (!secret) return true;
  return req.headers.get("x-order-rewards-secret") === secret;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: orders, error } = await supabase
    .from("voucher_orders")
    .select("id, user_address, miles_reward_status, miles_reward_attempts")
    .in("miles_reward_status", ["pending", "failed"])
    .lt("miles_reward_attempts", ORDER_REWARD_MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(PROCESS_LIMIT);

  if (error) {
    console.error("[POST /api/Spend/orders/rewards/process] query failed:", error);
    return NextResponse.json({ error: "Failed to load reward queue" }, { status: 500 });
  }

  const rows = (orders ?? []) as RewardQueueRow[];
  const results = [];

  for (const order of rows) {
    const result = await processOrderMilesReward(order);
    results.push({
      order_id: order.id,
      ok: result.ok,
      status: result.status,
      tx_hash: result.txHash ?? null,
      error: result.error ?? null,
    });
  }

  return NextResponse.json({
    processed: results.length,
    results,
  });
}
