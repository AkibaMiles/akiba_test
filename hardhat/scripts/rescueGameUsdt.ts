/**
 * rescueGameUsdt.ts — Recover USDT accidentally sent to the AkibaClawGame proxy.
 *
 * The game contract normally never holds ERC-20 tokens — USDT flows directly
 * from the player to the AkibaRewardVault on startGame(). Any USDT sitting in
 * the game proxy is accidental and can be swept with rescueToken().
 *
 * This script:
 *   1. Deploys a new AkibaClawGame implementation that includes rescueToken().
 *   2. Upgrades the proxy to the new implementation (all existing state is preserved).
 *   3. Calls rescueToken(USDT, vault, fullBalance) to move the USDT to the vault.
 *
 * Usage:
 *   npx hardhat run scripts/rescueGameUsdt.ts --network celo
 *
 * Required env: PRIVATE_KEY (must be the contract owner / deployer key)
 */

import { ethers } from "hardhat";

const PROXY_ADDRESS = "0x32cd4449A49786f8e9C68A5466d46E4dbC5197B3";
const VAULT_ADDRESS = "0xE7eAF0c4070Dc3bcb9AF085353e67bdb3d22228F";
const USDT_ADDRESS  = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";

const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddr = await deployer.getAddress();

  console.log("\n═══════════════════════════════════════════════");
  console.log("  AkibaClawGame — USDT Rescue");
  console.log("═══════════════════════════════════════════════");
  console.log(`  Owner:   ${deployerAddr}`);
  console.log(`  Proxy:   ${PROXY_ADDRESS}`);
  console.log(`  Vault:   ${VAULT_ADDRESS}`);
  console.log(`  USDT:    ${USDT_ADDRESS}`);
  console.log("");

  const usdt = new ethers.Contract(
    USDT_ADDRESS,
    ["function balanceOf(address) view returns (uint256)"],
    deployer,
  );

  const stuck = await usdt.balanceOf(PROXY_ADDRESS) as bigint;
  console.log(`  USDT stuck in proxy: ${ethers.formatUnits(stuck, 6)} USDT`);
  if (stuck === 0n) {
    console.log("  Nothing to rescue. Exiting.");
    return;
  }

  // ── 1. Deploy new implementation ────────────────────────────────────────
  console.log("\n1/3  Deploying new AkibaClawGame implementation (with rescueToken)…");
  const Impl = await ethers.getContractFactory("AkibaClawGame");
  const impl = await Impl.deploy();
  await impl.waitForDeployment();
  const implAddr = await impl.getAddress();
  console.log(`     New impl: ${implAddr}`);

  // ── 2. Upgrade proxy ────────────────────────────────────────────────────
  console.log("2/3  Upgrading proxy…");
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

  // ── 3. Rescue USDT ──────────────────────────────────────────────────────
  console.log(`3/3  Calling rescueToken — sweeping ${ethers.formatUnits(stuck, 6)} USDT to vault…`);
  const game = new ethers.Contract(
    PROXY_ADDRESS,
    ["function rescueToken(address token, address to, uint256 amount) external"],
    deployer,
  );
  tx = await game.rescueToken(USDT_ADDRESS, VAULT_ADDRESS, stuck);
  await tx.wait(1);
  console.log("     ✓ rescueToken confirmed");

  // ── Verify balances ─────────────────────────────────────────────────────
  const proxyBal = await usdt.balanceOf(PROXY_ADDRESS) as bigint;
  const vaultBal = await usdt.balanceOf(VAULT_ADDRESS) as bigint;
  console.log(`\n  Proxy USDT balance: ${ethers.formatUnits(proxyBal, 6)} USDT`);
  console.log(`  Vault USDT balance: ${ethers.formatUnits(vaultBal, 6)} USDT`);

  console.log("\n═══════════════════════════════════════════════");
  console.log("  RESCUE COMPLETE ✓");
  console.log("═══════════════════════════════════════════════");
  console.log(`  New implementation: ${implAddr}`);
  console.log("  Don't forget to verify the new impl:");
  console.log(`  npx hardhat verify --network celo ${implAddr}`);
  console.log("═══════════════════════════════════════════════\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
