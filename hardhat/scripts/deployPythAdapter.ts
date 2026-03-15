/**
 * deployPythAdapter.ts — Deploy PythEntropyAdapter on Celo mainnet.
 *
 * This is the RECOMMENDED randomness adapter: Pyth Entropy resolves in ~10 s
 * (2 Celo blocks), with auto-settlement directly in the callback.
 *
 * Usage:
 *   npx hardhat run scripts/deployPythAdapter.ts --network celo
 *
 * Required env vars:
 *   PRIVATE_KEY
 *   CLAW_GAME_PROXY          — existing AkibaClawGame proxy address
 *
 * After running, call upgradeClawGame.ts to point the game at the new adapter.
 */

import { ethers } from "hardhat";

// ── Celo mainnet Pyth addresses ──────────────────────────────────────────────
// Source: https://docs.pyth.network/entropy/contract-addresses
const PYTH_ENTROPY  = "0x36825bf3Fbdf5a29E2d5148bfe7Dcf7B5639e320";
const PYTH_PROVIDER = "0x6CC14824Ea2918f5De5C2f75A9Da968ad4BD6344"; // Fortuna

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddr = await deployer.getAddress();
  const balance = await ethers.provider.getBalance(deployerAddr);

  const gameProxy = process.env.CLAW_GAME_PROXY ?? "";
  if (!gameProxy) throw new Error("Set CLAW_GAME_PROXY in env");

  console.log("\n═══════════════════════════════════════════════");
  console.log("  PythEntropyAdapter — Celo Mainnet Deployment");
  console.log("═══════════════════════════════════════════════");
  console.log(`  Deployer:  ${deployerAddr}`);
  console.log(`  Balance:   ${ethers.formatEther(balance)} CELO`);
  console.log(`  Entropy:   ${PYTH_ENTROPY}`);
  console.log(`  Provider:  ${PYTH_PROVIDER}`);
  console.log(`  GameProxy: ${gameProxy}`);
  console.log("");

  // 1. Deploy adapter
  console.log("1/2  Deploying PythEntropyAdapter…");
  const Adapter = await ethers.getContractFactory("PythEntropyAdapter");
  const adapter = await Adapter.deploy(PYTH_ENTROPY, PYTH_PROVIDER, deployerAddr);
  await adapter.waitForDeployment();
  const adapterAddr = await adapter.getAddress();
  console.log(`     PythEntropyAdapter: ${adapterAddr}`);

  // 2. Wire game
  console.log("2/2  Setting game on adapter…");
  let tx = await (adapter as any).setGame(gameProxy);
  await tx.wait(1);
  console.log(`     ✓ setGame(${gameProxy})`);

  // 3. Fund adapter with a small CELO buffer for Pyth fees
  //    (The game contract also holds CELO; fees flow: game → adapter → Pyth)
  console.log("     Funding adapter with 0.01 CELO for fee buffer…");
  tx = await deployer.sendTransaction({ to: adapterAddr, value: ethers.parseEther("0.01") });
  await tx.wait(1);
  console.log("     ✓ Funded");

  console.log("\n═══════════════════════════════════════════════");
  console.log("  DEPLOYMENT COMPLETE ✓");
  console.log("═══════════════════════════════════════════════");
  console.log(`  PythEntropyAdapter: ${adapterAddr}`);
  console.log("");
  console.log("  Next steps:");
  console.log("  1. Run upgradeClawGame.ts to upgrade the game impl + point rng at this adapter");
  console.log("  2. Grant game.setRng(adapter) if skipping the full upgrade");
  console.log("  3. Verify: npx hardhat verify --network celo " + adapterAddr +
              ` ${PYTH_ENTROPY} ${PYTH_PROVIDER} ${deployerAddr}`);
  console.log("═══════════════════════════════════════════════\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
