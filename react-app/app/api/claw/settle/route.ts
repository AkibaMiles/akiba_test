/**
 * POST /api/claw/settle
 *
 * Called by the frontend immediately after startGame() confirms.
 * Reads the pre-committed outcome from Supabase, generates a Merkle proof,
 * and calls commitOutcome() on MerkleBatchRng via the relayer key.
 * MerkleBatchRng then auto-calls settleGame(), resolving the session in one tx.
 */

import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http } from "viem";
import { celo } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { supabase } from "@/lib/supabaseClient";
import batchRngArtifact from "@/contexts/merkleBatchRng.json";

/* ─── Config ──────────────────────────────────────────────────────────────── */

const BATCH_RNG_ADDRESS = (process.env.NEXT_PUBLIC_BATCH_RNG_ADDRESS ?? "") as `0x${string}`;
const CELO_RPC_URL      = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const RELAYER_PK        = process.env.CELO_RELAYER_PK;

const RC_NAMES: Record<number, string> = {
  1: "Lose", 2: "Common", 3: "Rare", 4: "Epic", 5: "Legendary",
};

/* ─── Clients ─────────────────────────────────────────────────────────────── */

function getClients() {
  if (!RELAYER_PK) throw new Error("CELO_RELAYER_PK not configured");
  const account = privateKeyToAccount(`0x${RELAYER_PK}`);
  const wallet  = createWalletClient({ chain: celo, transport: http(CELO_RPC_URL), account });
  const pub     = createPublicClient({ chain: celo, transport: http(CELO_RPC_URL) });
  return { wallet, pub, account };
}

/* ─── Route ───────────────────────────────────────────────────────────────── */

export async function POST(req: Request) {
  try {
    const { sessionId } = await req.json();
    if (!sessionId && sessionId !== 0)
      return NextResponse.json({ error: "sessionId required" }, { status: 400 });

    if (!BATCH_RNG_ADDRESS)
      return NextResponse.json({ error: "BATCH_RNG not configured" }, { status: 500 });

    const { wallet, pub, account } = getClients();
    const sid = BigInt(sessionId);

    // 1. Fetch the play slot assigned to this session
    const sp = await pub.readContract({
      address: BATCH_RNG_ADDRESS,
      abi: batchRngArtifact,
      functionName: "getSessionPlay",
      args: [sid],
    }) as { batchId: bigint; playIndex: bigint; committedClass: number };

    if (sp.batchId === 0n)
      return NextResponse.json({ error: "Session not registered in batch RNG" }, { status: 400 });

    if (sp.committedClass !== 0)
      return NextResponse.json({ status: "already_settled" }, { status: 200 });

    // 2. Load batch data from Supabase
    const { data, error } = await supabase
      .from("claw_batches")
      .select("outcomes, tree_dump")
      .eq("batch_id", sp.batchId.toString())
      .single();

    if (error || !data)
      return NextResponse.json({ error: `Batch ${sp.batchId} not found in DB` }, { status: 404 });

    // 3. Get outcome + generate Merkle proof
    const outcomes: number[]  = data.outcomes;
    const playIndex           = Number(sp.playIndex);
    const rewardClass         = outcomes[playIndex];
    const tree                = StandardMerkleTree.load(data.tree_dump);
    const proof               = tree.getProof([sp.batchId, BigInt(playIndex), BigInt(rewardClass)]);

    console.log(`[claw/settle] session=${sid} playIndex=${playIndex} outcome=${RC_NAMES[rewardClass]}`);

    // 4. Call commitOutcome — MerkleBatchRng auto-calls settleGame() on success
    const hash = await wallet.writeContract({
      address: BATCH_RNG_ADDRESS,
      abi: batchRngArtifact,
      functionName: "commitOutcome",
      args: [sid, rewardClass, proof],
      account,
    });

    // Wait for 1 confirmation so the frontend's next loadGame() sees the settled state
    await pub.waitForTransactionReceipt({ hash, confirmations: 1 });

    console.log(`[claw/settle] ✓ session=${sid} settled as ${RC_NAMES[rewardClass]} tx=${hash}`);
    return NextResponse.json({ hash, rewardClass, outcome: RC_NAMES[rewardClass] });

  } catch (err: any) {
    console.error("[claw/settle]", err);
    return NextResponse.json(
      { error: err?.shortMessage ?? err?.message ?? "Unknown error" },
      { status: 500 },
    );
  }
}
