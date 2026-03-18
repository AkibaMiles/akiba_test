/**
 * verifyClaw.ts — Verify all Claw Game contracts on Celoscan.
 *
 * For each UUPS proxy this script does TWO things:
 *   1. Verifies the implementation contract bytecode via hardhat-verify.
 *   2. Submits the proxy → implementation link to Celoscan using the
 *      "verifyproxycontract" API endpoint (the automated equivalent of
 *      clicking "More Options → Is this a proxy?" in the Celoscan UI).
 *
 * MerkleBatchRng is a plain (non-proxy) deployment — only step 1 applies.
 *
 * Usage:
 *   CLAW_GAME_PROXY=<addr> \
 *   VAULT_PROXY=<addr> \
 *   REGISTRY_PROXY=<addr> \
 *   BATCH_RNG=<addr> \
 *     npx hardhat run scripts/verifyClaw.ts --network celo
 *
 * Requires CELOSCAN_API_KEY to be set in .env.
 * VAULT_PROXY, REGISTRY_PROXY, and BATCH_RNG are optional.
 */

import hre, { ethers } from "hardhat";

// ERC-1967 implementation storage slot
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

// Celoscan v1 API — proxy verification endpoints are not available on v2
const CELOSCAN_API = "https://api.celoscan.io/api";

async function getImplAddress(proxyAddress: string): Promise<string> {
  const raw = await ethers.provider.getStorage(proxyAddress, IMPL_SLOT);
  return ethers.getAddress("0x" + raw.slice(-40));
}

async function verifyImpl(label: string, address: string, constructorArguments: unknown[] = []) {
  console.log(`\nVerifying ${label} impl (${address})…`);
  try {
    await hre.run("verify:verify", { address, constructorArguments });
    console.log(`  ✓ ${label} impl verified`);
  } catch (e: any) {
    if (e.message?.toLowerCase().includes("already verified")) {
      console.log(`  ✓ ${label} impl already verified`);
    } else {
      console.error(`  ✗ ${label} impl failed: ${e.message}`);
    }
  }
}

async function linkProxy(label: string, proxyAddress: string, implAddress: string) {
  const apiKey = process.env.CELOSCAN_API_KEY;
  if (!apiKey) {
    console.warn(`  ⚠  CELOSCAN_API_KEY not set — skipping proxy link for ${label}`);
    return;
  }

  console.log(`\nLinking proxy ${label} (${proxyAddress}) → impl (${implAddress})…`);

  try {
    // Submit proxy verification
    const submitUrl = `${CELOSCAN_API}?module=contract&action=verifyproxycontract&apikey=${apiKey}`;
    const submitBody = new URLSearchParams({
      address: proxyAddress,
      expectedimplementation: implAddress,
    });
    const submitRes = await fetch(submitUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: submitBody.toString(),
    });
    const submitJson = await submitRes.json() as { status: string; result: string; message?: string };

    if (submitJson.status !== "1") {
      // "Already verified" is fine
      if (submitJson.result?.toLowerCase().includes("already verified") ||
          submitJson.result?.toLowerCase().includes("already linked")) {
        console.log(`  ✓ ${label} proxy already linked`);
        return;
      }
      console.error(`  ✗ ${label} proxy link submission failed: ${submitJson.result ?? submitJson.message}`);
      return;
    }

    const guid = submitJson.result;
    console.log(`  Submitted — polling GUID: ${guid}`);

    // Poll for result (up to 30 s)
    const pollUrl = `${CELOSCAN_API}?module=contract&action=checkproxyverification&guid=${guid}&apikey=${apiKey}`;
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const pollRes  = await fetch(pollUrl);
      const pollJson = await pollRes.json() as { status: string; result: string };

      if (pollJson.result?.toLowerCase().includes("pending")) {
        process.stdout.write(".");
        continue;
      }
      if (
        pollJson.status === "1" ||
        pollJson.result?.toLowerCase().includes("already verified") ||
        pollJson.result?.toLowerCase().includes("successfully")
      ) {
        console.log(`\n  ✓ ${label} proxy linked`);
        return;
      }
      console.error(`\n  ✗ ${label} proxy link check: ${pollJson.result}`);
      return;
    }
    console.warn(`\n  ⚠  ${label} proxy link timed out — check Celoscan manually`);
  } catch (e: any) {
    console.error(`  ✗ ${label} proxy link error: ${e.message}`);
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddr = await deployer.getAddress();

  const gameProxy     = process.env.CLAW_GAME_PROXY ?? "";
  const vaultProxy    = process.env.VAULT_PROXY     ?? "";
  const registryProxy = process.env.REGISTRY_PROXY  ?? "";
  const batchRng      = process.env.BATCH_RNG       ?? "";

  if (!gameProxy) throw new Error("Set CLAW_GAME_PROXY in env");

  console.log("\n═══════════════════════════════════════════════");
  console.log("  Akiba Claw — Celoscan Verification");
  console.log("═══════════════════════════════════════════════");
  console.log(`  Deployer:        ${deployerAddr}`);
  console.log(`  ClawGame proxy:  ${gameProxy}`);
  if (vaultProxy)    console.log(`  Vault proxy:     ${vaultProxy}`);
  if (registryProxy) console.log(`  Registry proxy:  ${registryProxy}`);
  if (batchRng)      console.log(`  MerkleBatchRng:  ${batchRng}`);
  console.log("");

  // ── 1. AkibaClawGame ────────────────────────────────────────────────────
  const gameImpl = await getImplAddress(gameProxy);
  console.log(`  ClawGame impl:   ${gameImpl}`);
  await verifyImpl("AkibaClawGame", gameImpl);
  await linkProxy("AkibaClawGame", gameProxy, gameImpl);

  // ── 2. AkibaRewardVault ─────────────────────────────────────────────────
  if (vaultProxy) {
    const vaultImpl = await getImplAddress(vaultProxy);
    console.log(`  Vault impl:      ${vaultImpl}`);
    await verifyImpl("AkibaRewardVault", vaultImpl);
    await linkProxy("AkibaRewardVault", vaultProxy, vaultImpl);
  }

  // ── 3. AkibaVoucherRegistry ─────────────────────────────────────────────
  if (registryProxy) {
    const registryImpl = await getImplAddress(registryProxy);
    console.log(`  Registry impl:   ${registryImpl}`);
    await verifyImpl("AkibaVoucherRegistry", registryImpl);
    await linkProxy("AkibaVoucherRegistry", registryProxy, registryImpl);
  }

  // ── 4. MerkleBatchRng (plain deploy, constructor = deployer address) ────
  if (batchRng) {
    await verifyImpl("MerkleBatchRng", batchRng, [deployerAddr]);
    // Not a proxy — no link step needed
  }

  console.log("\n═══════════════════════════════════════════════");
  console.log("  Done.");
  console.log("═══════════════════════════════════════════════\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
