/**
 * POST /api/claw/settle
 *
 * Called by the frontend immediately after startGame() confirms.
 * Reads the pre-committed outcome from Supabase, generates a Merkle proof,
 * calls commitOutcome() on MerkleBatchRng (which auto-calls settleGame()),
 * then immediately calls claimReward() on AkibaClawGame.
 * Users only need to sign startGame() — everything else is relayer-driven.
 */

import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, type Abi } from "viem";
import { celo } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { supabase } from "@/lib/supabaseClient";
import batchRngArtifact from "@/contexts/merkleBatchRng.json";
import clawGameArtifactRaw from "@/contexts/akibaClawGame.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const clawGameArtifact = clawGameArtifactRaw.abi as unknown as Abi;
const batchRngAbi = batchRngArtifact as unknown as Abi;

/* ─── Config ──────────────────────────────────────────────────────────────── */

const BATCH_RNG_ADDRESS = (process.env.NEXT_PUBLIC_BATCH_RNG_ADDRESS ?? "") as `0x${string}`;
const CLAW_GAME_ADDRESS = (process.env.NEXT_PUBLIC_CLAW_GAME_ADDRESS  ?? "") as `0x${string}`;
const CELO_RPC_URL      = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const RELAYER_PK        = process.env.CELO_RELAYER_PK;

const RC_NAMES: Record<number, string> = {
  1: "Lose", 2: "Common", 3: "Rare", 4: "Epic", 5: "Legendary",
};

const SESSION_STATUS = {
  none: 0,
  pending: 1,
  settled: 2,
  claimed: 3,
  burned: 4,
  refunded: 5,
} as const;

const inFlightSessions = new Set<string>();
const SETTLE_TIMEOUT_MS = 25_000;
const STEP_WAIT_MS = 900;

/* ─── Clients ─────────────────────────────────────────────────────────────── */

function getClients() {
  if (!RELAYER_PK) throw new Error("CELO_RELAYER_PK not configured");
  const account = privateKeyToAccount(`0x${RELAYER_PK}`);
  const wallet  = createWalletClient({ chain: celo, transport: http(CELO_RPC_URL), account });
  const pub     = createPublicClient({ chain: celo, transport: http(CELO_RPC_URL) });
  return { wallet, pub, account };
}

async function writeWithFreshNonce({
  pub,
  wallet,
  account,
  address,
  abi,
  functionName,
  args,
}: {
  pub: any;
  wallet: any;
  account: any;
  address: `0x${string}`;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
}) {
  const nonce = await pub.getTransactionCount({
    address: account.address,
    blockTag: "pending",
  });

  return await wallet.writeContract({
    address,
    abi,
    functionName,
    args,
    account,
    nonce,
  });
}

async function readSession(pub: any, sessionId: bigint) {
  return await pub.readContract({
    address: CLAW_GAME_ADDRESS,
    abi: clawGameArtifact,
    functionName: "getSession",
    args: [sessionId],
  }) as {
    sessionId: bigint;
    status: number;
    rewardClass: number;
    voucherId: bigint;
  };
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function traceClawSettle({
  sessionId,
  phase,
  level = "info",
  message,
  txHash,
  details,
}: {
  sessionId: bigint;
  phase: string;
  level?: "info" | "warn" | "error";
  message?: string;
  txHash?: `0x${string}` | "";
  details?: Record<string, unknown>;
}) {
  try {
    await supabase.from("claw_settle_logs").insert({
      session_id: sessionId.toString(),
      phase,
      level,
      message,
      tx_hash: txHash || null,
      details: details ?? null,
    });
  } catch (err) {
    console.error("[claw/settle] trace write failed", err);
  }
}

function isAlreadyKnownNonceError(err: any) {
  const message = `${err?.shortMessage ?? ""} ${err?.details ?? ""} ${err?.message ?? ""}`.toLowerCase();
  return message.includes("already known") || message.includes("nonce provided for the transaction is lower");
}

function isIgnorableCommitError(err: any) {
  const message = `${err?.shortMessage ?? ""} ${err?.details ?? ""} ${err?.message ?? ""}`.toLowerCase();
  return (
    message.includes("already known") ||
    message.includes("nonce provided for the transaction is lower") ||
    message.includes("batch: already committed")
  );
}

function isIgnorableSettleError(err: any) {
  const message = `${err?.shortMessage ?? ""} ${err?.details ?? ""} ${err?.message ?? ""}`.toLowerCase();
  return (
    message.includes("already known") ||
    message.includes("nonce provided for the transaction is lower") ||
    message.includes("wrongstatus") ||
    message.includes("randomnessnotready")
  );
}

function isIgnorableClaimError(err: any) {
  const message = `${err?.shortMessage ?? ""} ${err?.details ?? ""} ${err?.message ?? ""}`.toLowerCase();
  return (
    message.includes("already known") ||
    message.includes("nonce provided for the transaction is lower") ||
    message.includes("wrongstatus")
  );
}

/* ─── Route ───────────────────────────────────────────────────────────────── */

export async function POST(req: Request) {
  let sid: bigint | null = null;
  try {
    const { sessionId } = await req.json();
    if (!sessionId && sessionId !== 0)
      return NextResponse.json({ error: "sessionId required" }, { status: 400 });

    if (!BATCH_RNG_ADDRESS)
      return NextResponse.json({ error: "BATCH_RNG not configured" }, { status: 500 });

    if (!CLAW_GAME_ADDRESS)
      return NextResponse.json({ error: "CLAW_GAME not configured" }, { status: 500 });

    const { wallet, pub, account } = getClients();
    sid = BigInt(sessionId);
    const sessionKey = sid.toString();

    await traceClawSettle({
      sessionId: sid,
      phase: "request_started",
      message: "Settle request received",
    });

    if (inFlightSessions.has(sessionKey)) {
      await traceClawSettle({
        sessionId: sid,
        phase: "in_flight",
        level: "warn",
        message: "Session already processing in this runtime",
      });
      return NextResponse.json({ status: "processing" }, { status: 202 });
    }
    inFlightSessions.add(sessionKey);

    let session = await readSession(pub, sid);
    await traceClawSettle({
      sessionId: sid,
      phase: "session_read",
      details: {
        status: session.status,
        rewardClass: session.rewardClass,
        voucherId: session.voucherId.toString(),
      },
    });
    if (session.status === SESSION_STATUS.claimed || session.status === SESSION_STATUS.burned) {
      await traceClawSettle({
        sessionId: sid,
        phase: "already_terminal",
        message: "Session already claimed or burned",
        details: { status: session.status },
      });
      return NextResponse.json({ status: "already_claimed", rewardClass: Number(session.rewardClass) }, { status: 200 });
    }
    if (session.status === SESSION_STATUS.refunded) {
      await traceClawSettle({
        sessionId: sid,
        phase: "already_refunded",
        message: "Session already refunded",
      });
      return NextResponse.json({ status: "refunded" }, { status: 200 });
    }

    let sp = {
      batchId: 0n,
      playIndex: 0n,
      committedClass: 0,
    } as { batchId: bigint; playIndex: bigint; committedClass: number };
    let rewardClass = 0;
    let proof: `0x${string}`[] = [];
    let hasLoggedOutcome = false;
    let settleHash = "" as `0x${string}` | "";
    let claimHash = "" as `0x${string}` | "";
    const deadline = Date.now() + SETTLE_TIMEOUT_MS;

    while (Date.now() < deadline) {
      session = await readSession(pub, sid);
      sp = await pub.readContract({
        address: BATCH_RNG_ADDRESS,
        abi: batchRngAbi,
        functionName: "getSessionPlay",
        args: [sid],
      }) as { batchId: bigint; playIndex: bigint; committedClass: number };

      if (session.status === SESSION_STATUS.claimed || session.status === SESSION_STATUS.burned) {
        await traceClawSettle({
          sessionId: sid,
          phase: "terminal_reached",
          message: "Session reached terminal state during processing",
          details: { status: session.status },
        });
        break;
      }

      if (sp.batchId === 0n) {
        await traceClawSettle({
          sessionId: sid,
          phase: "pending_registration",
          message: "Session play not registered in batch yet",
        });
        await wait(STEP_WAIT_MS);
        continue;
      }

      if (rewardClass === 0) {
        const { data, error } = await supabase
          .from("claw_batches")
          .select("outcomes, tree_dump")
          .eq("batch_id", sp.batchId.toString())
          .single();

        if (error || !data) {
          await traceClawSettle({
            sessionId: sid,
            phase: "batch_lookup_failed",
            level: "error",
            message: `Batch ${sp.batchId} not found in DB`,
          });
          return NextResponse.json({ error: `Batch ${sp.batchId} not found in DB` }, { status: 404 });
        }

        const outcomes: number[] = data.outcomes;
        const playIndex = Number(sp.playIndex);
        rewardClass = outcomes[playIndex];
        const tree = StandardMerkleTree.load(data.tree_dump);
        proof = tree.getProof([sp.batchId, BigInt(playIndex), BigInt(rewardClass)]) as `0x${string}`[];

        if (!hasLoggedOutcome) {
          console.log(`[claw/settle] session=${sid} playIndex=${playIndex} outcome=${RC_NAMES[rewardClass]}`);
          await traceClawSettle({
            sessionId: sid,
            phase: "proof_loaded",
            message: "Loaded batch proof for session",
            details: {
              batchId: sp.batchId.toString(),
              playIndex,
              rewardClass,
              outcome: RC_NAMES[rewardClass],
            },
          });
          hasLoggedOutcome = true;
        }
      }

      if (sp.committedClass === 0 && session.status === SESSION_STATUS.pending) {
        try {
          const txHash = await writeWithFreshNonce({
            pub,
            wallet,
            account,
            address: BATCH_RNG_ADDRESS,
            abi: batchRngAbi,
            functionName: "commitOutcome",
            args: [sid, rewardClass, proof],
          });
          settleHash = txHash;
          await pub.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });
          console.log(`[claw/settle] ✓ session=${sid} committed tx=${settleHash}`);
          await traceClawSettle({
            sessionId: sid,
            phase: "commit_succeeded",
            txHash,
            message: "commitOutcome confirmed",
          });
          await wait(500);
          continue;
        } catch (err: any) {
          if (!isIgnorableCommitError(err)) {
            await traceClawSettle({
              sessionId: sid,
              phase: "commit_failed",
              level: "error",
              message: err?.shortMessage ?? err?.message ?? "commitOutcome failed",
              details: {
                details: err?.details ?? null,
              },
            });
            throw err;
          }
          console.warn(`[claw/settle] commit already landed or is in-flight for session=${sid}`);
          await traceClawSettle({
            sessionId: sid,
            phase: "commit_ignorable",
            level: "warn",
            message: err?.shortMessage ?? err?.message ?? "commitOutcome already landed or in-flight",
          });
          await wait(STEP_WAIT_MS);
          continue;
        }
      }

      if (session.status === SESSION_STATUS.pending) {
        try {
          const txHash = await writeWithFreshNonce({
            pub,
            wallet,
            account,
            address: CLAW_GAME_ADDRESS,
            abi: clawGameArtifact,
            functionName: "settleGame",
            args: [sid],
          });
          settleHash = txHash;
          await pub.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });
          console.log(`[claw/settle] ✓ session=${sid} settled tx=${settleHash}`);
          await traceClawSettle({
            sessionId: sid,
            phase: "settle_succeeded",
            txHash,
            message: "settleGame confirmed",
          });
          continue;
        } catch (err: any) {
          if (!isIgnorableSettleError(err)) {
            await traceClawSettle({
              sessionId: sid,
              phase: "settle_failed",
              level: "error",
              message: err?.shortMessage ?? err?.message ?? "settleGame failed",
              details: {
                details: err?.details ?? null,
              },
            });
            throw err;
          }
          console.warn(`[claw/settle] settle not ready or already in-flight for session=${sid}`);
          await traceClawSettle({
            sessionId: sid,
            phase: "settle_ignorable",
            level: "warn",
            message: err?.shortMessage ?? err?.message ?? "settleGame not ready or already in-flight",
          });
          await wait(STEP_WAIT_MS);
          continue;
        }
      }

      if (session.status === SESSION_STATUS.settled) {
        try {
          const txHash = await writeWithFreshNonce({
            pub,
            wallet,
            account,
            address: CLAW_GAME_ADDRESS,
            abi: clawGameArtifact,
            functionName: "claimReward",
            args: [sid],
          });
          claimHash = txHash;
          await pub.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });
          console.log(`[claw/settle] ✓ session=${sid} claimed tx=${claimHash}`);
          await traceClawSettle({
            sessionId: sid,
            phase: "claim_succeeded",
            txHash,
            message: "claimReward confirmed",
          });
          continue;
        } catch (err: any) {
          if (!isIgnorableClaimError(err)) {
            await traceClawSettle({
              sessionId: sid,
              phase: "claim_failed",
              level: "error",
              message: err?.shortMessage ?? err?.message ?? "claimReward failed",
              details: {
                details: err?.details ?? null,
              },
            });
            throw err;
          }
          console.warn(`[claw/settle] claim already in-flight or status changed for session=${sid}`);
          await traceClawSettle({
            sessionId: sid,
            phase: "claim_ignorable",
            level: "warn",
            message: err?.shortMessage ?? err?.message ?? "claimReward already in-flight or status changed",
          });
          await wait(STEP_WAIT_MS);
          continue;
        }
      }

      await wait(STEP_WAIT_MS);
    }

    session = await readSession(pub, sid);
    await traceClawSettle({
      sessionId: sid,
      phase: "request_finished",
      message: "Settle request finished",
      details: {
        status: session.status,
        rewardClass: session.rewardClass,
        hash: settleHash || null,
        claimHash: claimHash || null,
      },
    });

    return NextResponse.json({
      status:
        session.status === SESSION_STATUS.claimed ? "claimed" :
        session.status === SESSION_STATUS.settled ? "settled" :
        session.status === SESSION_STATUS.pending && sp.batchId === 0n ? "pending_registration" :
        session.status === SESSION_STATUS.pending ? "pending" :
        "processed",
      hash: settleHash || undefined,
      claimHash: claimHash || undefined,
      rewardClass: Number(session.rewardClass || rewardClass),
      outcome: RC_NAMES[session.rewardClass || rewardClass] ?? RC_NAMES[rewardClass],
    }, {
      status:
        session.status === SESSION_STATUS.claimed || session.status === SESSION_STATUS.burned
          ? 200
          : 202,
    });

  } catch (err: any) {
    console.error("[claw/settle]", err);
    if (sid !== null) {
      await traceClawSettle({
        sessionId: sid,
        phase: "request_failed",
        level: "error",
        message: err?.shortMessage ?? err?.message ?? "Unknown error",
        details: {
          details: err?.details ?? null,
        },
      });
    }
    return NextResponse.json(
      { error: err?.shortMessage ?? err?.message ?? "Unknown error" },
      { status: 500 },
    );
  } finally {
    if (sid !== null) {
      inFlightSessions.delete(sid.toString());
    }
  }
}
