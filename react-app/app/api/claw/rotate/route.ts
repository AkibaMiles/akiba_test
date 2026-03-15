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
import { celo } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import * as crypto from "crypto";
import { supabase } from "@/lib/supabaseClient";
import batchRngArtifact from "@/contexts/merkleBatchRng.json";
import clawGameArtifactRaw from "@/contexts/akibaClawGame.json";
import type { Abi } from "viem";

const clawGameArtifact = clawGameArtifactRaw.abi as unknown as Abi;

/* ─── Config ──────────────────────────────────────────────────────────────── */

const BATCH_RNG_ADDRESS = (process.env.NEXT_PUBLIC_BATCH_RNG_ADDRESS ?? "") as `0x${string}`;
const CLAW_GAME_ADDRESS = (process.env.NEXT_PUBLIC_CLAW_GAME_ADDRESS  ?? "") as `0x${string}`;
const CELO_RPC_URL      = process.env.CELO_RPC_URL  ?? "https://forno.celo.org";
const ADMIN_PK          = process.env.PRIVATE_KEY;    // owner of MerkleBatchRng (openBatch)
const RELAYER_PK        = process.env.CELO_RELAYER_PK;

const BATCH_SIZE = 1000;

const RC_LOSE = 1, RC_COMMON = 2, RC_RARE = 3, RC_EPIC = 4, RC_LEGENDARY = 5;
const DISTRIBUTION: Record<number, number> = {
  [RC_LOSE]: 600, [RC_COMMON]: 320, [RC_RARE]: 60, [RC_EPIC]: 18, [RC_LEGENDARY]: 2,
};
const RC_NAMES: Record<number, string> = {
  1: "Lose", 2: "Common", 3: "Rare", 4: "Epic", 5: "Legendary",
};
const bigintReplacer = (_k: string, v: unknown) => typeof v === "bigint" ? v.toString() : v;

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

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

function buildShuffledOutcomes(batchSize: number, seed: Buffer): number[] {
  const scale = batchSize / 1000;
  const counts: Record<number, number> = {};
  let assigned = 0;
  for (const [rc, count] of Object.entries(DISTRIBUTION)) {
    counts[Number(rc)] = Math.round(count * scale);
    assigned += counts[Number(rc)];
  }
  counts[RC_LOSE] += batchSize - assigned;
  const outcomes: number[] = [];
  for (const [rc, count] of Object.entries(counts))
    for (let i = 0; i < count; i++) outcomes.push(Number(rc));
  let seedBuf = seed;
  for (let i = outcomes.length - 1; i > 0; i--) {
    seedBuf = crypto.createHash("sha256")
      .update(Buffer.concat([seedBuf, Buffer.from(i.toString())]))
      .digest();
    const j = seedBuf.readUInt32BE(0) % (i + 1);
    [outcomes[i], outcomes[j]] = [outcomes[j], outcomes[i]];
  }
  return outcomes;
}

/* ─── Route ───────────────────────────────────────────────────────────────── */

export async function GET() {
  const log: string[] = [];
  const info = (msg: string) => { log.push(msg); console.log("[claw/rotate]", msg); };

  try {
    if (!BATCH_RNG_ADDRESS) return NextResponse.json({ error: "BATCH_RNG not configured" }, { status: 500 });

    const pub = createPublicClient({ chain: celo, transport: http(CELO_RPC_URL) });

    // ── 1. Check active batch ──────────────────────────────────────────────
    const inv = await pub.readContract({
      address: BATCH_RNG_ADDRESS,
      abi: batchRngArtifact,
      functionName: "getActiveBatchInventory",
    }) as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean];

    const [onChainBatchId, , , , , , , , batchActive] = inv;
    info(`Active batch: ${onChainBatchId}  active=${batchActive}`);

    // ── 2. Open new batch if exhausted ────────────────────────────────────
    if (!batchActive) {
      if (!ADMIN_PK) { info("PRIVATE_KEY not set — cannot open batch"); }
      else {
        info("Batch exhausted — generating new batch…");
        const adminAccount = privateKeyToAccount(`0x${ADMIN_PK}`);
        const adminWallet  = createWalletClient({ chain: celo, transport: http(CELO_RPC_URL), account: adminAccount });

        const batchId  = BigInt(Math.floor(Date.now() / 1000));
        const seed     = crypto.randomBytes(32);
        const outcomes = buildShuffledOutcomes(BATCH_SIZE, seed);
        const inventory = {
          lose:      outcomes.filter(r => r === RC_LOSE).length,
          common:    outcomes.filter(r => r === RC_COMMON).length,
          rare:      outcomes.filter(r => r === RC_RARE).length,
          epic:      outcomes.filter(r => r === RC_EPIC).length,
          legendary: outcomes.filter(r => r === RC_LEGENDARY).length,
        };

        const values: [bigint, bigint, bigint][] = outcomes.map((rc, idx) =>
          [batchId, BigInt(idx), BigInt(rc)]
        );
        const tree = StandardMerkleTree.of(values, ["uint256", "uint256", "uint8"]);
        const root = tree.root as `0x${string}`;

        const hash = await adminWallet.writeContract({
          address: BATCH_RNG_ADDRESS,
          abi: batchRngArtifact,
          functionName: "openBatch",
          args: [batchId, root, BigInt(BATCH_SIZE),
            BigInt(inventory.lose), BigInt(inventory.common), BigInt(inventory.rare),
            BigInt(inventory.epic), BigInt(inventory.legendary)],
          account: adminAccount,
        });
        await pub.waitForTransactionReceipt({ hash, confirmations: 1 });
        info(`Opened batch ${batchId} (${root}) tx=${hash}`);

        // Store in Supabase
        const { error: dbErr } = await supabase.from("claw_batches").insert({
          batch_id:   batchId.toString(),
          merkle_root: root,
          batch_size:  BATCH_SIZE,
          outcomes:    JSON.parse(JSON.stringify(outcomes, bigintReplacer)),
          tree_dump:   JSON.parse(JSON.stringify(tree.dump(), bigintReplacer)),
          inventory,
          active:      true,
        });
        if (dbErr) info(`⚠ Supabase insert failed: ${dbErr.message}`);
        else info(`Batch ${batchId} stored in Supabase`);
      }
    }

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
