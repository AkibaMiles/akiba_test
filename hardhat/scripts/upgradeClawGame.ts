/**
 * upgradeClawGame.ts — Upgrade AkibaClawGame proxy to the new implementation
 *                      that pays the Witnet fee from the contract's CELO reserve
 *                      (MiniPay-compatible — no msg.value required from players).
 *
 * Usage:
 *   npx hardhat run scripts/upgradeClawGame.ts --network celo
 */

import { ethers } from "hardhat";

// ── Known addresses ──────────────────────────────────────────────────────────
const PROXY_ADDRESS = "0x32cd4449A49786f8e9C68A5466d46E4dbC5197B3";

// CELO to send as initial fee reserve (funds ~2 000–10 000 games)
const CELO_RESERVE = ethers.parseEther("1");

// ── UUPS upgradeTo ABI ───────────────────────────────────────────────────────
const upgradeAbi = ["function upgradeTo(address newImplementation) external"];

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddr = await deployer.getAddress();
  const balance = await ethers.provider.getBalance(deployerAddr);

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  AkibaClawGame — Upgrade to MiniPay-compatible version");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Deployer: ${deployerAddr}`);
  console.log(`  Balance:  ${ethers.formatEther(balance)} CELO`);
  console.log(`  Proxy:    ${PROXY_ADDRESS}`);
  console.log("");

  if (balance < ethers.parseEther("0.05") + CELO_RESERVE) {
    throw new Error("Insufficient CELO — need at least 1.05 CELO (1 for reserve + gas).");
  }

  // ── 1. Deploy new implementation ──────────────────────────────────────────
  console.log("1/3  Deploying new AkibaClawGame implementation…");
  const Impl = await ethers.getContractFactory("AkibaClawGame");
  const impl = await Impl.deploy();
  await impl.waitForDeployment();
  const implAddr = await impl.getAddress();
  console.log(`     New impl: ${implAddr}`);

  // ── 2. Upgrade proxy to new implementation ─────────────────────────────────
  console.log("2/3  Calling upgradeTo on proxy…");
  const proxy = new ethers.Contract(PROXY_ADDRESS, upgradeAbi, deployer);
  const tx = await proxy.upgradeTo(implAddr);
  await tx.wait(1);
  console.log(`     ✓ Proxy upgraded`);

  // ── 3. Fund CELO reserve ──────────────────────────────────────────────────
  console.log(`3/3  Sending ${ethers.formatEther(CELO_RESERVE)} CELO to proxy as fee reserve…`);
  const fundTx = await deployer.sendTransaction({
    to: PROXY_ADDRESS,
    value: CELO_RESERVE,
  });
  await fundTx.wait(1);
  console.log(`     ✓ Reserve funded`);

  // ── Verify reserve ────────────────────────────────────────────────────────
  const reserve = await ethers.provider.getBalance(PROXY_ADDRESS);
  console.log(`     Contract CELO balance: ${ethers.formatEther(reserve)} CELO`);

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  UPGRADE COMPLETE ✓");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  New implementation: ${implAddr}`);
  console.log(`  Proxy (unchanged):  ${PROXY_ADDRESS}`);
  console.log(`  CELO reserve:       ${ethers.formatEther(reserve)} CELO`);
  console.log("  Players no longer need CELO — fully MiniPay compatible.");
  console.log("═══════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
