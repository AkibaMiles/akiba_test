/**
 * verifyClaw.ts — Verify all Claw Game contracts on Celoscan.
 *
 * Reads implementation addresses from UUPS proxies automatically via the
 * ERC-1967 implementation storage slot, then verifies each contract.
 *
 * Usage:
 *   CLAW_GAME_PROXY=<addr> \
 *   VAULT_PROXY=<addr> \
 *   REGISTRY_PROXY=<addr> \
 *   BATCH_RNG=<addr> \
 *     npx hardhat run scripts/verifyClaw.ts --network celo
 *
 * If VAULT_PROXY or REGISTRY_PROXY are not set they are skipped.
 * BATCH_RNG is a regular (non-proxy) contract — its constructor arg is
 * the deployer address derived from PRIVATE_KEY in .env.
 */

import hre, { ethers } from "hardhat";

// ERC-1967 implementation storage slot
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

async function getImplAddress(proxyAddress: string): Promise<string> {
  const raw = await ethers.provider.getStorage(proxyAddress, IMPL_SLOT);
  // The slot stores a padded address — take the last 20 bytes
  return ethers.getAddress("0x" + raw.slice(-40));
}

async function verify(label: string, address: string, constructorArguments: unknown[] = []) {
  console.log(`\nVerifying ${label} (${address})…`);
  try {
    await hre.run("verify:verify", { address, constructorArguments });
    console.log(`  ✓ ${label} verified`);
  } catch (e: any) {
    if (e.message?.toLowerCase().includes("already verified")) {
      console.log(`  ✓ ${label} already verified`);
    } else {
      console.error(`  ✗ ${label} failed: ${e.message}`);
    }
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

  // ── 1. AkibaClawGame impl ───────────────────────────────────────────────
  const gameImpl = await getImplAddress(gameProxy);
  console.log(`  ClawGame impl:   ${gameImpl}`);
  await verify("AkibaClawGame (impl)", gameImpl);

  // ── 2. AkibaRewardVault impl ────────────────────────────────────────────
  if (vaultProxy) {
    const vaultImpl = await getImplAddress(vaultProxy);
    console.log(`  Vault impl:      ${vaultImpl}`);
    await verify("AkibaRewardVault (impl)", vaultImpl);
  }

  // ── 3. AkibaVoucherRegistry impl ────────────────────────────────────────
  if (registryProxy) {
    const registryImpl = await getImplAddress(registryProxy);
    console.log(`  Registry impl:   ${registryImpl}`);
    await verify("AkibaVoucherRegistry (impl)", registryImpl);
  }

  // ── 4. MerkleBatchRng (plain deploy, constructor = deployer address) ────
  if (batchRng) {
    await verify("MerkleBatchRng", batchRng, [deployerAddr]);
  }

  console.log("\n═══════════════════════════════════════════════");
  console.log("  Done.");
  console.log("  Proxy contracts may still need manual linking:");
  console.log("  On Celoscan, open each proxy and click");
  console.log('  "More Options → Is this a proxy?" to link impl.');
  console.log("═══════════════════════════════════════════════\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
