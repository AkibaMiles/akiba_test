/**
 * upgradeClawGame.ts — Upgrade AkibaClawGame to the IClawRng-based implementation
 *                      and wire the chosen randomness adapter.
 *
 * Usage:
 *   # Pyth Entropy (recommended — resolves in ~10 s):
 *   ADAPTER_ADDRESS=<PythEntropyAdapter> \
 *     npx hardhat run scripts/upgradeClawGame.ts --network celo
 *
 *   # Cross-chain Chainlink VRF (resolves in ~1-2 min):
 *   ADAPTER_ADDRESS=<CrossChainVRFAdapter> \
 *     npx hardhat run scripts/upgradeClawGame.ts --network celo
 *
 * Required env vars:
 *   PRIVATE_KEY
 *   ADAPTER_ADDRESS     — PythEntropyAdapter or CrossChainVRFAdapter address
 *
 * Hardcoded (update if proxy address changes):
 *   PROXY_ADDRESS       — existing AkibaClawGame proxy
 */

import { ethers } from "hardhat";

// ── Known addresses ──────────────────────────────────────────────────────────
const PROXY_ADDRESS = "0x32cd4449A49786f8e9C68A5466d46E4dbC5197B3";

// ERC-1967 implementation slot (for post-upgrade verification)
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddr = await deployer.getAddress();
  const balance = await ethers.provider.getBalance(deployerAddr);

  const adapterAddr = process.env.ADAPTER_ADDRESS ?? "";
  if (!adapterAddr) throw new Error("Set ADAPTER_ADDRESS in env");

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  AkibaClawGame — Upgrade to IClawRng / VRF V2");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Deployer: ${deployerAddr}`);
  console.log(`  Balance:  ${ethers.formatEther(balance)} CELO`);
  console.log(`  Proxy:    ${PROXY_ADDRESS}`);
  console.log(`  Adapter:  ${adapterAddr}`);
  console.log("");

  // ── 1. Deploy new implementation ──────────────────────────────────────────
  console.log("1/3  Deploying new AkibaClawGame implementation…");
  const Impl = await ethers.getContractFactory("AkibaClawGame");
  const impl = await Impl.deploy();
  await impl.waitForDeployment();
  const implAddr = await impl.getAddress();
  console.log(`     New impl: ${implAddr}`);

  // ── 2. Upgrade proxy ──────────────────────────────────────────────────────
  console.log("2/3  Calling upgradeTo on proxy…");
  const proxy = new ethers.Contract(
    PROXY_ADDRESS,
    ["function upgradeTo(address newImplementation) external"],
    deployer,
  );
  let tx = await proxy.upgradeTo(implAddr);
  await tx.wait(1);

  // Verify impl slot
  const slot = await ethers.provider.getStorage(PROXY_ADDRESS, IMPL_SLOT);
  const implOnChain = "0x" + slot.slice(26);
  if (implOnChain.toLowerCase() !== implAddr.toLowerCase()) {
    throw new Error(`Impl slot mismatch: expected ${implAddr}, got ${implOnChain}`);
  }
  console.log("     ✓ Proxy upgraded");

  // ── 3. Wire RNG adapter ───────────────────────────────────────────────────
  console.log("3/3  Wiring RNG adapter…");
  const game = new ethers.Contract(
    PROXY_ADDRESS,
    ["function setRng(address _rng) external"],
    deployer,
  );
  tx = await game.setRng(adapterAddr);
  await tx.wait(1);
  console.log(`     ✓ setRng(${adapterAddr})`);

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  UPGRADE COMPLETE ✓");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  New implementation: ${implAddr}`);
  console.log(`  Proxy (unchanged):  ${PROXY_ADDRESS}`);
  console.log(`  RNG adapter:        ${adapterAddr}`);
  console.log("");
  console.log("  Verify:");
  console.log(`  npx hardhat verify --network celo ${implAddr}`);
  console.log("═══════════════════════════════════════════════════════\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
