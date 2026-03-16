import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import * as crypto from "crypto";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import batchRngArtifact from "@/contexts/merkleBatchRng.json";
import { supabase } from "@/lib/supabaseClient";

const BATCH_RNG_ADDRESS = (process.env.NEXT_PUBLIC_BATCH_RNG_ADDRESS ?? "") as `0x${string}`;
const CELO_RPC_URL = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const ADMIN_PK = process.env.PRIVATE_KEY;

const BATCH_SIZE = 1000;

const RC_LOSE = 1;
const RC_COMMON = 2;
const RC_RARE = 3;
const RC_EPIC = 4;
const RC_LEGENDARY = 5;

const DISTRIBUTION: Record<number, number> = {
  [RC_LOSE]: 600,
  [RC_COMMON]: 320,
  [RC_RARE]: 60,
  [RC_EPIC]: 18,
  [RC_LEGENDARY]: 2,
};

const bigintReplacer = (_key: string, value: unknown) =>
  typeof value === "bigint" ? value.toString() : value;

export type ClawBatchEnsureResult = {
  active: boolean;
  opened: boolean;
  batchId: bigint;
  totalRemaining: bigint;
  totalPlays: bigint;
};

function buildShuffledOutcomes(batchSize: number, seed: Buffer): number[] {
  const scale = batchSize / 1000;
  const counts: Record<number, number> = {};
  let assigned = 0;

  for (const [rewardClass, count] of Object.entries(DISTRIBUTION)) {
    counts[Number(rewardClass)] = Math.round(count * scale);
    assigned += counts[Number(rewardClass)];
  }

  counts[RC_LOSE] += batchSize - assigned;

  const outcomes: number[] = [];
  for (const [rewardClass, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i += 1) outcomes.push(Number(rewardClass));
  }

  let seedBuf = seed;
  for (let i = outcomes.length - 1; i > 0; i -= 1) {
    seedBuf = crypto
      .createHash("sha256")
      .update(Buffer.concat([seedBuf, Buffer.from(i.toString())]))
      .digest();
    const j = seedBuf.readUInt32BE(0) % (i + 1);
    [outcomes[i], outcomes[j]] = [outcomes[j], outcomes[i]];
  }

  return outcomes;
}

async function markDbActiveBatch(batchId: string) {
  const { error: deactivateErr } = await supabase
    .from("claw_batches")
    .update({ active: false })
    .neq("batch_id", batchId)
    .eq("active", true);

  if (deactivateErr) {
    throw new Error(`Failed to deactivate older claw batches: ${deactivateErr.message}`);
  }

  const { error: activateErr } = await supabase
    .from("claw_batches")
    .update({ active: true })
    .eq("batch_id", batchId);

  if (activateErr) {
    throw new Error(`Failed to activate claw batch ${batchId}: ${activateErr.message}`);
  }
}

export async function ensureActiveClawBatch(
  logger?: (message: string) => void,
): Promise<ClawBatchEnsureResult> {
  if (!BATCH_RNG_ADDRESS) throw new Error("BATCH_RNG not configured");

  const publicClient = createPublicClient({ chain: celo, transport: http(CELO_RPC_URL) });
  const inventory = (await publicClient.readContract({
    address: BATCH_RNG_ADDRESS,
    abi: batchRngArtifact,
    functionName: "getActiveBatchInventory",
  })) as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean];

  const [activeBatchId, , , , , , totalRemaining, totalPlays, active] = inventory;

  if (active) {
    await markDbActiveBatch(activeBatchId.toString()).catch((err) => {
      logger?.(`⚠ Failed to reconcile claw batch activity in DB: ${err.message}`);
    });

    return {
      active: true,
      opened: false,
      batchId: activeBatchId,
      totalRemaining,
      totalPlays,
    };
  }

  if (!ADMIN_PK) throw new Error("PRIVATE_KEY not set — cannot open batch");

  logger?.("Batch exhausted — generating new batch…");

  const adminAccount = privateKeyToAccount(`0x${ADMIN_PK}`);
  const adminWallet = createWalletClient({
    chain: celo,
    transport: http(CELO_RPC_URL),
    account: adminAccount,
  });

  const batchId = BigInt(Date.now());
  const seed = crypto.randomBytes(32);
  const outcomes = buildShuffledOutcomes(BATCH_SIZE, seed);
  const inventoryByClass = {
    lose: outcomes.filter((reward) => reward === RC_LOSE).length,
    common: outcomes.filter((reward) => reward === RC_COMMON).length,
    rare: outcomes.filter((reward) => reward === RC_RARE).length,
    epic: outcomes.filter((reward) => reward === RC_EPIC).length,
    legendary: outcomes.filter((reward) => reward === RC_LEGENDARY).length,
  };

  const values: [bigint, bigint, bigint][] = outcomes.map((rewardClass, idx) => [
    batchId,
    BigInt(idx),
    BigInt(rewardClass),
  ]);
  const tree = StandardMerkleTree.of(values, ["uint256", "uint256", "uint8"]);
  const root = tree.root as `0x${string}`;

  const txHash = await adminWallet.writeContract({
    address: BATCH_RNG_ADDRESS,
    abi: batchRngArtifact,
    functionName: "openBatch",
    args: [
      batchId,
      root,
      BigInt(BATCH_SIZE),
      BigInt(inventoryByClass.lose),
      BigInt(inventoryByClass.common),
      BigInt(inventoryByClass.rare),
      BigInt(inventoryByClass.epic),
      BigInt(inventoryByClass.legendary),
    ],
    account: adminAccount,
  });

  await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });
  logger?.(`Opened batch ${batchId} (${root}) tx=${txHash}`);

  const { error: deactivateErr } = await supabase
    .from("claw_batches")
    .update({ active: false })
    .eq("active", true);

  if (deactivateErr) {
    throw new Error(`Failed to deactivate older claw batches: ${deactivateErr.message}`);
  }

  const { error: upsertErr } = await supabase.from("claw_batches").upsert({
    batch_id: batchId.toString(),
    merkle_root: root,
    batch_size: BATCH_SIZE,
    outcomes: JSON.parse(JSON.stringify(outcomes, bigintReplacer)),
    tree_dump: JSON.parse(JSON.stringify(tree.dump(), bigintReplacer)),
    inventory: inventoryByClass,
    active: true,
  });

  if (upsertErr) {
    throw new Error(`Failed to store claw batch ${batchId} in Supabase: ${upsertErr.message}`);
  }

  logger?.(`Batch ${batchId} stored in Supabase`);

  return {
    active: true,
    opened: true,
    batchId,
    totalRemaining: BigInt(BATCH_SIZE),
    totalPlays: BigInt(BATCH_SIZE),
  };
}
