/**
 * GET /api/claw/rotate
 *
 * Vercel Cron job (runs every 5 minutes via vercel.json).
 * Checks whether the active MerkleBatchRng batch is exhausted and, if so,
 * auto-generates + opens the next batch, storing it in Supabase.
 *
 * Also handles pending sessions whose outcome hasn't been committed yet
 * (e.g. if a settle call failed) by retrying commitOutcome.
 */

import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";

export const maxDuration = 60; // allow time for Merkle tree gen + on-chain tx
import { celo } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { supabase } from "@/lib/supabaseClient";
import batchRngArtifact from "@/contexts/merkleBatchRng.json";
import clawGameArtifactRaw from "@/contexts/akibaClawGame.json";
import { ensureActiveClawBatch } from "@/lib/clawBatchAdmin";
import type { Abi } from "viem";

const clawGameArtifact = clawGameArtifactRaw.abi as unknown as Abi;

/* ─── Config ──────────────────────────────────────────────────────────────── */

const BATCH_RNG_ADDRESS = (process.env.NEXT_PUBLIC_BATCH_RNG_ADDRESS ?? "") as `0x${string}`;
const CLAW_GAME_ADDRESS = (process.env.NEXT_PUBLIC_CLAW_GAME_ADDRESS  ?? "") as `0x${string}`;
const CELO_RPC_URL      = process.env.CELO_RPC_URL  ?? "https://forno.celo.org";
const RELAYER_PK        = process.env.CELO_RELAYER_PK;

const RC_LOSE = 1, RC_COMMON = 2, RC_RARE = 3, RC_EPIC = 4, RC_LEGENDARY = 5;
const DISTRIBUTION: Record<number, number> = {
  [RC_LOSE]: 600, [RC_COMMON]: 320, [RC_RARE]: 60, [RC_EPIC]: 18, [RC_LEGENDARY]: 2,
};
const RC_NAMES: Record<number, string> = {
  1: "Lose", 2: "Common", 3: "Rare", 4: "Epic", 5: "Legendary",
};
const gameStartedAbi = parseAbi([
  "event GameStarted(uint256 indexed sessionId, address indexed player, uint8 indexed tierId, uint256 playCost, uint256 requestBlock)",
]);

const clawGameMiniAbi = [
  {
    name: "getSession",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "sessionId", type: "uint256" }],
    outputs: [{ name: "", type: "tuple", components: [
      { name: "sessionId",   type: "uint256" },
      { name: "player",      type: "address" },
      { name: "tierId",      type: "uint8"   },
      { name: "status",      type: "uint8"   },
      { name: "createdAt",   type: "uint256" },
      { name: "settledAt",   type: "uint256" },
      { name: "requestBlock",type: "uint256" },
      { name: "rewardClass", type: "uint8"   },
      { name: "rewardAmount",type: "uint256" },
      { name: "voucherId",   type: "uint256" },
    ]}],
  },
  {
    name: "claimReward",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "sessionId", type: "uint256" }],
    outputs: [],
  },
] as const;

/* ─── Route ───────────────────────────────────────────────────────────────── */

export async function GET() {
  const log: string[] = [];
  const info = (msg: string) => { log.push(msg); console.log("[claw/rotate]", msg); };

  try {
    if (!BATCH_RNG_ADDRESS) return NextResponse.json({ error: "BATCH_RNG not configured" }, { status: 500 });

    const pub = createPublicClient({ chain: celo, transport: http(CELO_RPC_URL) });
    const batchState = await ensureActiveClawBatch(info);
    info(`Active batch ready: ${batchState.batchId} active=${batchState.active} opened=${batchState.opened}`);

    // ── 3. Retry any uncommitted pending sessions ─────────────────────────
    if (RELAYER_PK && CLAW_GAME_ADDRESS) {
      const relayerAccount = privateKeyToAccount(`0x${RELAYER_PK}`);
      const relayerWallet  = createWalletClient({ chain: celo, transport: http(CELO_RPC_URL), account: relayerAccount });

      // Look back 200 blocks (~10 min on Celo) for GameStarted events
      const latestBlock = await pub.getBlockNumber();
      const fromBlock   = latestBlock > 200n ? latestBlock - 200n : 0n;

      const logs = await pub.getLogs({
        address: CLAW_GAME_ADDRESS,
        event:   gameStartedAbi[0],
        fromBlock,
        toBlock: "latest",
      });

      let retried = 0;
      for (const log of logs) {
        const sessionId = log.args.sessionId;
        if (!sessionId) continue;

        const sp = await pub.readContract({
          address: BATCH_RNG_ADDRESS,
          abi: batchRngArtifact,
          functionName: "getSessionPlay",
          args: [sessionId],
        }) as { batchId: bigint; playIndex: bigint; committedClass: number };

        if (sp.committedClass !== 0) continue; // already settled
        if (sp.batchId === 0n) continue;       // not a batch-mode session

        // Load batch from Supabase
        const { data } = await supabase
          .from("claw_batches")
          .select("outcomes, tree_dump")
          .eq("batch_id", sp.batchId.toString())
          .single();

        if (!data) { info(`⚠ Batch ${sp.batchId} not in DB — cannot retry session ${sessionId}`); continue; }

        const outcomes: number[] = data.outcomes;
        const playIndex          = Number(sp.playIndex);
        const rewardClass        = outcomes[playIndex];
        const tree               = StandardMerkleTree.load(data.tree_dump);
        const proof              = tree.getProof([sp.batchId, BigInt(playIndex), BigInt(rewardClass)]);

        const hash = await relayerWallet.writeContract({
          address: BATCH_RNG_ADDRESS,
          abi: batchRngArtifact,
          functionName: "commitOutcome",
          args: [sessionId, rewardClass, proof],
          account: relayerAccount,
        });
        await pub.waitForTransactionReceipt({ hash, confirmations: 1 });
        info(`Retried session ${sessionId} → ${RC_NAMES[rewardClass]} tx=${hash}`);

        // Auto-claim after settling
        try {
          const claimHash = await relayerWallet.writeContract({
            address: CLAW_GAME_ADDRESS,
            abi: clawGameArtifact,
            functionName: "claimReward",
            args: [sessionId],
            account: relayerAccount,
          });
          await pub.waitForTransactionReceipt({ hash: claimHash, confirmations: 1 });
          info(`  Claimed session ${sessionId} tx=${claimHash}`);
        } catch (claimErr: any) {
          info(`  ⚠ claimReward failed for ${sessionId}: ${claimErr?.shortMessage ?? claimErr?.message}`);
        }

        retried++;
      }
      if (retried === 0) info("No pending sessions to retry");

      // ── 4. Claim any settled-but-unclaimed sessions from the last 200 blocks ──
      let claimed = 0;
      for (const log of logs) {
        const sessionId = log.args.sessionId;
        if (!sessionId) continue;

        const session = await pub.readContract({
          address: CLAW_GAME_ADDRESS,
          abi: clawGameMiniAbi,
          functionName: "getSession",
          args: [sessionId],
        }) as { status: number };

        if (session.status !== 2) continue; // 2 = Settled

        try {
          const claimHash = await relayerWallet.writeContract({
            address: CLAW_GAME_ADDRESS,
            abi: clawGameArtifact,
            functionName: "claimReward",
            args: [sessionId],
            account: relayerAccount,
          });
          await pub.waitForTransactionReceipt({ hash: claimHash, confirmations: 1 });
          info(`Claimed settled session ${sessionId} tx=${claimHash}`);
          claimed++;
        } catch { /* already claimed or in wrong state */ }
      }
      if (claimed === 0) info("No settled-unclaimed sessions found");
    }

    return NextResponse.json({ ok: true, log });

  } catch (err: any) {
    console.error("[claw/rotate]", err);
    return NextResponse.json({ error: err?.message ?? "Unknown error", log }, { status: 500 });
  }
}
