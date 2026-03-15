/**
 * deployMerkleBatch.ts — Deploy MerkleBatchRng on Celo and wire it to the game.
 *
 * Usage:
 *   CLAW_GAME_PROXY=<addr> npx hardhat run scripts/deployMerkleBatch.ts --network celo
 *
 * After deploying:
 *   Run upgradeClawGame.ts with ADAPTER_ADDRESS=<MerkleBatchRng address>
 *   Then run createBatch.ts to open the first batch.
 */

import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddr = await deployer.getAddress();

  const gameProxy = process.env.CLAW_GAME_PROXY ?? "";
  if (!gameProxy) throw new Error("Set CLAW_GAME_PROXY in env");

  console.log("\n═══════════════════════════════════════════════");
  console.log("  MerkleBatchRng — Celo Mainnet Deployment");
  console.log("═══════════════════════════════════════════════");
  console.log(`  Deployer:  ${deployerAddr}`);
  console.log(`  Game:      ${gameProxy}`);
  console.log("");

  console.log("1/2  Deploying MerkleBatchRng…");
  const MBR = await ethers.getContractFactory("MerkleBatchRng");
  const mbr = await MBR.deploy(deployerAddr);
  await mbr.waitForDeployment();
  const mbrAddr = await mbr.getAddress();
  console.log(`     MerkleBatchRng: ${mbrAddr}`);

  console.log("2/2  Wiring game address…");
  const tx = await (mbr as any).setGame(gameProxy);
  await tx.wait(1);
  console.log(`     ✓ setGame(${gameProxy})`);

  console.log("\n═══════════════════════════════════════════════");
  console.log("  DEPLOYMENT COMPLETE ✓");
  console.log("═══════════════════════════════════════════════");
  console.log(`  MerkleBatchRng: ${mbrAddr}`);
  console.log("");
  console.log("  Next steps:");
  console.log(`  1. ADAPTER_ADDRESS=${mbrAddr} npx hardhat run scripts/upgradeClawGame.ts --network celo`);
  console.log(`  2. BATCH_RNG=${mbrAddr} npx hardhat run scripts/createBatch.ts --network celo`);
  console.log(`  3. BATCH_RNG=${mbrAddr} CLAW_GAME=${gameProxy} BATCH_FILE=./batches/batch_<id>.json \\`);
  console.log(`       npx hardhat run scripts/batchKeeper.ts --network celo`);
  console.log(`  4. npx hardhat verify --network celo ${mbrAddr} ${deployerAddr}`);
  console.log("═══════════════════════════════════════════════\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
