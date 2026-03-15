/**
 * batchKeeper.ts — Self-managing operator service.
 *
 * • Watches for GameStarted events and immediately commits pre-determined
 *   outcomes via Merkle proof (instant settlement, same/next block).
 * • Watches for BatchClosed events and automatically generates + opens the
 *   next batch — no manual intervention needed.
 *
 * Usage:
 *   BATCH_RNG=<addr> CLAW_GAME=<addr> \
 *     npx hardhat run scripts/batchKeeper.ts --network celo
 *
 * Optional:
 *   BATCH_FILE=./batches/batch_<id>.json   — resume an existing active batch
 *                                            instead of creating one on startup
 *   BATCH_SIZE=1000                        — plays per new batch (default 1000)
 *   BATCH_OUTPUT_DIR=./batches             — where to write proof files
 *
 * Run as a persistent process (pm2, systemd, etc.).
 */

import { ethers } from "hardhat";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import * as fs   from "fs";
import * as path from "path";
import * as crypto from "crypto";

/* ─────────────────────────── Constants ─────────────────────────────────── */

const RC_LOSE = 1, RC_COMMON = 2, RC_RARE = 3, RC_EPIC = 4, RC_LEGENDARY = 5;

const RC_NAMES: Record<number, string> = {
  [RC_LOSE]: "Lose", [RC_COMMON]: "Common", [RC_RARE]: "Rare",
  [RC_EPIC]: "Epic", [RC_LEGENDARY]: "Legendary",
};

const DISTRIBUTION: Record<number, number> = {
  [RC_LOSE]: 600, [RC_COMMON]: 320, [RC_RARE]: 60, [RC_EPIC]: 18, [RC_LEGENDARY]: 2,
};

const bigintReplacer = (_k: string, v: unknown) =>
  typeof v === "bigint" ? v.toString() : v;

/* ─────────────────────────── Batch generation ──────────────────────────── */

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

interface BatchState {
  batchId:  bigint;
  outcomes: number[];
  tree:     StandardMerkleTree<[bigint, bigint, bigint]>;
}

/* ─────────────────────────── Main ──────────────────────────────────────── */

async function main() {
  const [operator] = await ethers.getSigners();
  const operatorAddr = await operator.getAddress();

  const batchRngAddr = process.env.BATCH_RNG ?? "";
  const clawGameAddr = process.env.CLAW_GAME ?? "";
  if (!batchRngAddr) throw new Error("Set BATCH_RNG");
  if (!clawGameAddr) throw new Error("Set CLAW_GAME");

  const batchSize  = Number(process.env.BATCH_SIZE       ?? "1000");
  const outputDir  = process.env.BATCH_OUTPUT_DIR        ?? "./batches";
  const resumeFile = process.env.BATCH_FILE              ?? "";

  const BatchRng = await ethers.getContractFactory("MerkleBatchRng");
  const batchRng = BatchRng.attach(batchRngAddr).connect(operator) as any;

  const Game = await ethers.getContractFactory("AkibaClawGame");
  const game = Game.attach(clawGameAddr) as any;

  console.log(`\n  ╔══════════════════════════════════════════╗`);
  console.log(`  ║       Akiba Batch Keeper — started       ║`);
  console.log(`  ╚══════════════════════════════════════════╝`);
  console.log(`  BatchRng:  ${batchRngAddr}`);
  console.log(`  ClawGame:  ${clawGameAddr}`);
  console.log(`  Operator:  ${operatorAddr}`);
  console.log(``);

  // ── Mutable batch state (swapped on rotation) ─────────────────────────────
  let current: BatchState | null = null;

  // ── createAndOpenBatch ────────────────────────────────────────────────────
  async function createAndOpenBatch(): Promise<BatchState> {
    const batchId = BigInt(Math.floor(Date.now() / 1000));
    const seed    = crypto.randomBytes(32);

    console.log(`  [AUTO] Generating new batch ${batchId} (${batchSize} plays)…`);

    const outcomes = buildShuffledOutcomes(batchSize, seed);
    const inv = {
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

    console.log(`  [AUTO] Root: ${root}`);
    console.log(`  [AUTO] Mix: ${inv.lose}L ${inv.common}C ${inv.rare}R ${inv.epic}E ${inv.legendary}⭐`);

    const tx = await batchRng.openBatch(
      batchId, root, batchSize,
      inv.lose, inv.common, inv.rare, inv.epic, inv.legendary,
    );
    await tx.wait(1);
    console.log(`  [AUTO] ✓ Batch ${batchId} opened on-chain`);

    // Save proof file (keep secret until batch ends, then publish for verification)
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const outFile = path.join(outputDir, `batch_${batchId}.json`);
    fs.writeFileSync(outFile, JSON.stringify({
      batchId: batchId.toString(), merkleRoot: root, batchSize,
      seed: `0x${seed.toString("hex")}`,
      inventory: inv, tree: tree.dump(), outcomes,
    }, bigintReplacer, 2));
    console.log(`  [AUTO] ✓ Proof saved to ${outFile}\n`);

    return { batchId, outcomes, tree };
  }

  // ── loadBatchFile ─────────────────────────────────────────────────────────
  function loadBatchFile(file: string): BatchState {
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    return {
      batchId:  BigInt(data.batchId),
      outcomes: data.outcomes,
      tree:     StandardMerkleTree.load(data.tree),
    };
  }

  // ── Startup: resume or create ─────────────────────────────────────────────
  if (resumeFile) {
    console.log(`  Resuming batch from ${resumeFile}`);
    current = loadBatchFile(resumeFile);
    console.log(`  Batch ID: ${current.batchId}  (${current.outcomes.length} plays)\n`);
  } else {
    // Check if a batch is already active on-chain (e.g. after a restart)
    const inv = await batchRng.getActiveBatchInventory();
    if (inv.active) {
      // Look for an existing proof file
      const existingFile = path.join(outputDir, `batch_${inv.batchId}.json`);
      if (fs.existsSync(existingFile)) {
        console.log(`  Found existing active batch ${inv.batchId} — resuming from ${existingFile}\n`);
        current = loadBatchFile(existingFile);
      } else {
        // Batch is open but proof file is missing — we cannot commit proofs without it.
        // Close the orphan batch and open a fresh one.
        console.warn(`  ⚠  Active batch ${inv.batchId} has no local proof file — closing and creating new batch`);
        const closeTx = await batchRng.closeBatch(inv.batchId);
        await closeTx.wait(1);
        current = await createAndOpenBatch();
      }
    } else {
      current = await createAndOpenBatch();
    }
  }

  console.log(`  Watching for GameStarted events…\n`);

  // ── GameStarted handler ───────────────────────────────────────────────────
  game.on("GameStarted", async (sessionId: bigint, player: string) => {
    if (!current) return;
    try {
      console.log(`  [${ts()}] GameStarted  session=${sessionId}  player=${player}`);

      const sp = await batchRng.getSessionPlay(sessionId);
      if (sp.batchId === 0n) {
        console.warn(`  ⚠  Session ${sessionId}: no batch slot (wrong RNG adapter?)`);
        return;
      }

      // Look up outcome in whichever batch owns this session
      let state = current;
      if (sp.batchId !== current.batchId) {
        // Session belongs to a previous batch (edge case: keeper restarted mid-batch)
        const oldFile = path.join(outputDir, `batch_${sp.batchId}.json`);
        if (!fs.existsSync(oldFile)) {
          console.error(`  ✗  No proof file for batch ${sp.batchId} — cannot settle session ${sessionId}`);
          return;
        }
        state = loadBatchFile(oldFile);
      }

      const playIndex   = Number(sp.playIndex);
      const rewardClass = state.outcomes[playIndex];
      const proof       = state.tree.getProof([sp.batchId, BigInt(playIndex), BigInt(rewardClass)]);

      console.log(`     playIndex=${playIndex}  outcome=${RC_NAMES[rewardClass]}  proofLen=${proof.length}`);

      const tx = await batchRng.commitOutcome(sessionId, rewardClass, proof);
      await tx.wait(1);
      console.log(`  ✓  Session ${sessionId} settled as ${RC_NAMES[rewardClass]}  tx=${tx.hash}`);
    } catch (err: any) {
      console.error(`  ✗  Session ${sessionId} failed:`, err.shortMessage ?? err.message ?? err);
    }
  });

  // ── BatchClosed handler — auto-rotate ────────────────────────────────────
  batchRng.on("BatchClosed", async (batchId: bigint) => {
    console.log(`\n  [${ts()}] BatchClosed  batchId=${batchId}`);
    try {
      current = await createAndOpenBatch();
    } catch (err: any) {
      console.error(`  ✗  Auto-rotate failed:`, err.shortMessage ?? err.message ?? err);
      console.error(`     Fix the issue and restart the keeper to open a new batch.`);
    }
  });

  // Keep process alive
  await new Promise(() => {});
}

function ts() { return new Date().toISOString(); }

main().catch((e) => { console.error(e); process.exit(1); });
