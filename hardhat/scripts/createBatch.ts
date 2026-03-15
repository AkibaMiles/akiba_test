/**
 * createBatch.ts — Generate a provably fair batch and post it to MerkleBatchRng.
 *
 * Flow:
 *   1. Generate N outcomes that EXACTLY match the configured prize distribution
 *   2. Fisher-Yates shuffle with a cryptographically random seed
 *   3. Build a Merkle tree (OZ standard — double-hashed leaves)
 *   4. Post the root + inventory to MerkleBatchRng.openBatch()
 *   5. Save the full tree + seed to a local JSON file (used by the backend keeper
 *      to produce per-session Merkle proofs)
 *
 * After the batch is exhausted, publish the JSON file so players can verify
 * every outcome was predetermined and the shuffle was fair.
 *
 * Usage:
 *   BATCH_RNG=<MerkleBatchRng address> npx hardhat run scripts/createBatch.ts --network celo
 *
 * Optional env vars:
 *   BATCH_SIZE        — number of plays (default: 1000)
 *   BATCH_ID          — explicit batch ID (default: timestamp)
 *   BATCH_OUTPUT_DIR  — where to write the proof file (default: ./batches/)
 *
 * Tier 0 default distribution per 1000 plays:
 *   Lose:      600   (60.0%)
 *   Common:    320   (32.0%)
 *   Rare:       60   ( 6.0%)
 *   Epic:       18   ( 1.8%)
 *   Legendary:   2   ( 0.2%)
 */

import { ethers } from "hardhat";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

const bigintReplacer = (_k: string, v: unknown) =>
  typeof v === "bigint" ? v.toString() : v;

// ── Reward class constants (must match AkibaClawGame enum) ──────────────────
const RC_LOSE      = 1;
const RC_COMMON    = 2;
const RC_RARE      = 3;
const RC_EPIC      = 4;
const RC_LEGENDARY = 5;

// ── Default distribution per 1000 plays ─────────────────────────────────────
const DISTRIBUTION: Record<number, number> = {
  [RC_LOSE]:      600,
  [RC_COMMON]:    320,
  [RC_RARE]:       60,
  [RC_EPIC]:       18,
  [RC_LEGENDARY]:   2,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build the outcomes array with exact distribution, then shuffle it. */
function buildShuffledOutcomes(batchSize: number, seed: Buffer): number[] {
  // Scale distribution proportionally to batchSize
  const scale = batchSize / 1000;
  const counts: Record<number, number> = {};
  let assigned = 0;
  for (const [rc, count] of Object.entries(DISTRIBUTION)) {
    counts[Number(rc)] = Math.round(count * scale);
    assigned += counts[Number(rc)];
  }
  // Handle rounding — assign remainder to Lose
  counts[RC_LOSE] += batchSize - assigned;

  // Fill array
  const outcomes: number[] = [];
  for (const [rc, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) outcomes.push(Number(rc));
  }

  // Fisher-Yates shuffle deterministically from seed
  // We use the seed to generate a sequence of random bytes
  let seedBuf = seed;
  for (let i = outcomes.length - 1; i > 0; i--) {
    // Generate a fresh hash from current seed + index
    seedBuf = crypto.createHash("sha256").update(Buffer.concat([seedBuf, Buffer.from(i.toString())])).digest();
    const j = seedBuf.readUInt32BE(0) % (i + 1);
    [outcomes[i], outcomes[j]] = [outcomes[j], outcomes[i]];
  }

  return outcomes;
}

/** Build a StandardMerkleTree from (batchId, playIndex, rewardClass) triples. */
function buildMerkleTree(batchId: bigint, outcomes: number[]) {
  const values: [bigint, bigint, bigint][] = outcomes.map((rc, idx) => [
    batchId,
    BigInt(idx),
    BigInt(rc),
  ]);

  // OZ StandardMerkleTree uses keccak256(abi.encode(...)) leaves with double-hashing
  return StandardMerkleTree.of(values, ["uint256", "uint256", "uint8"]);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const [deployer] = await ethers.getSigners();

  const batchRngAddr = process.env.BATCH_RNG ?? "";
  if (!batchRngAddr) throw new Error("Set BATCH_RNG in env");

  const batchSize  = Number(process.env.BATCH_SIZE ?? "1000");
  const batchId    = BigInt(process.env.BATCH_ID   ?? Math.floor(Date.now() / 1000).toString());
  const outputDir  = process.env.BATCH_OUTPUT_DIR   ?? "./batches";

  console.log("\n═══════════════════════════════════════════════");
  console.log("  MerkleBatchRng — Create Batch");
  console.log("═══════════════════════════════════════════════");
  console.log(`  BatchRng:    ${batchRngAddr}`);
  console.log(`  Batch ID:    ${batchId}`);
  console.log(`  Batch size:  ${batchSize}`);
  console.log("");

  // ── 1. Generate secret seed ────────────────────────────────────────────────
  const seed = crypto.randomBytes(32);
  console.log(`  Seed (keep secret until batch is done): 0x${seed.toString("hex")}`);
  console.log("");

  // ── 2. Build shuffled outcomes ─────────────────────────────────────────────
  console.log("1/4  Generating shuffled outcome sequence…");
  const outcomes = buildShuffledOutcomes(batchSize, seed);

  const inv = {
    lose:      outcomes.filter(r => r === RC_LOSE).length,
    common:    outcomes.filter(r => r === RC_COMMON).length,
    rare:      outcomes.filter(r => r === RC_RARE).length,
    epic:      outcomes.filter(r => r === RC_EPIC).length,
    legendary: outcomes.filter(r => r === RC_LEGENDARY).length,
  };
  console.log(`     Lose: ${inv.lose}  Common: ${inv.common}  Rare: ${inv.rare}  Epic: ${inv.epic}  Legendary: ${inv.legendary}`);

  // ── 3. Build Merkle tree ───────────────────────────────────────────────────
  console.log("2/4  Building Merkle tree…");
  const tree = buildMerkleTree(batchId, outcomes);
  const root = tree.root as `0x${string}`;
  console.log(`     Root: ${root}`);

  // ── 4. Post to chain ───────────────────────────────────────────────────────
  console.log("3/4  Calling openBatch() on MerkleBatchRng…");
  const BatchRng = await ethers.getContractFactory("MerkleBatchRng");
  const batchRng = BatchRng.attach(batchRngAddr).connect(deployer);

  const tx = await (batchRng as any).openBatch(
    batchId,
    root,
    batchSize,
    inv.lose,
    inv.common,
    inv.rare,
    inv.epic,
    inv.legendary,
  );
  await tx.wait(1);
  console.log(`     ✓ Batch ${batchId} opened`);

  // ── 5. Save tree + seed to file ────────────────────────────────────────────
  console.log("4/5  Saving proof data locally…");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const outFile  = path.join(outputDir, `batch_${batchId}.json`);
  const treeJson = tree.dump();

  fs.writeFileSync(outFile, JSON.stringify({
    batchId: batchId.toString(),
    merkleRoot: root,
    batchSize,
    seed: `0x${seed.toString("hex")}`,  // KEEP SECRET until batch ends
    inventory: inv,
    tree: treeJson,
    outcomes,                             // playIndex → rewardClass
  }, bigintReplacer, 2));

  console.log(`     ✓ Saved to ${outFile}`);

  // ── 6. Upload to Supabase (for Vercel API route access) ────────────────────
  const sbUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const sbKey = process.env.SUPABASE_SERVICE_KEY ?? "";
  if (sbUrl && sbKey) {
    console.log("5/5  Uploading to Supabase…");
    const sb = createClient(sbUrl, sbKey);
    const { error: dbErr } = await sb.from("claw_batches").upsert({
      batch_id:    batchId.toString(),
      merkle_root: root,
      batch_size:  batchSize,
      outcomes:    JSON.parse(JSON.stringify(outcomes, bigintReplacer)),
      tree_dump:   JSON.parse(JSON.stringify(treeJson, bigintReplacer)),
      inventory:   inv,
      active:      true,
    }, { onConflict: "batch_id" });
    if (dbErr) console.warn(`     ⚠  Supabase upload failed: ${dbErr.message}`);
    else console.log(`     ✓ Batch ${batchId} stored in Supabase`);
  } else {
    console.log("5/5  Skipping Supabase upload (SUPABASE_URL / SUPABASE_SERVICE_KEY not set)");
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════");
  console.log("  BATCH CREATED ✓");
  console.log("═══════════════════════════════════════════════");
  console.log(`  Batch ID:   ${batchId}`);
  console.log(`  Root:       ${root}`);
  console.log(`  Plays:      ${batchSize}`);
  console.log(`  Prize mix:  ${inv.lose}L ${inv.common}C ${inv.rare}R ${inv.epic}E ${inv.legendary}⭐`);
  console.log("");
  console.log("  ⚠  Keep batch JSON secret until the batch is exhausted.");
  console.log("     Publish it afterward so players can verify fairness.");
  console.log("═══════════════════════════════════════════════\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
