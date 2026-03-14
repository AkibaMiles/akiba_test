/**
 * deployClaw.ts — Deploy AkibaClawGame + dependencies to Celo mainnet via UUPS proxies.
 *
 * Usage:
 *   npx hardhat run scripts/deployClaw.ts --network celo
 *
 * Deployed contracts:
 *   AkibaRewardVault    (ERC-1967 proxy)
 *   AkibaVoucherRegistry (ERC-1967 proxy)
 *   AkibaClawGame       (ERC-1967 proxy)
 */

import { ethers } from "hardhat";

// ── Known Celo mainnet addresses ────────────────────────────────────────────
const WITNET_RNG   = "0xC0FFEE98AD1434aCbDB894BbB752e138c1006fAB";
const MINI_POINTS  = "0xEeD878017f027FE96316007D0ca5fDA58Ee93a6b";
const USDT         = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";

// ── Helpers ─────────────────────────────────────────────────────────────────

async function deployProxy(
  implName: string,
  initData: string,
): Promise<{ proxy: string; impl: string }> {
  const Impl = await ethers.getContractFactory(implName);
  const impl = await Impl.deploy();
  await impl.waitForDeployment();
  const implAddr = await impl.getAddress();
  console.log(`  ${implName} impl:  ${implAddr}`);

  // ERC1967Proxy(address _logic, bytes memory _data)
  const Proxy = await ethers.getContractFactory("ERC1967Proxy");
  const proxy = await Proxy.deploy(implAddr, initData);
  await proxy.waitForDeployment();
  const proxyAddr = await proxy.getAddress();
  console.log(`  ${implName} proxy: ${proxyAddr}`);

  return { proxy: proxyAddr, impl: implAddr };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddr = await deployer.getAddress();
  const balance = await ethers.provider.getBalance(deployerAddr);

  console.log("\n═══════════════════════════════════════════════");
  console.log("  Akiba Claw Game — Celo Mainnet Deployment");
  console.log("═══════════════════════════════════════════════");
  console.log(`  Deployer:  ${deployerAddr}`);
  console.log(`  Balance:   ${ethers.formatEther(balance)} CELO`);
  console.log(`  Witnet:    ${WITNET_RNG}`);
  console.log(`  Miles:     ${MINI_POINTS}`);
  console.log(`  USDT:      ${USDT}`);
  console.log("");

  if (balance < ethers.parseEther("0.05")) {
    throw new Error("Insufficient CELO balance — need at least 0.05 CELO for gas.");
  }

  // ── 1. AkibaRewardVault ──────────────────────────────────────────────────
  console.log("1/3  Deploying AkibaRewardVault…");
  const Vault = await ethers.getContractFactory("AkibaRewardVault");
  const vaultInitData = Vault.interface.encodeFunctionData("initialize", [USDT, deployerAddr]);
  const { proxy: vaultProxy } = await deployProxy("AkibaRewardVault", vaultInitData);

  // ── 2. AkibaVoucherRegistry ──────────────────────────────────────────────
  console.log("2/3  Deploying AkibaVoucherRegistry…");
  const Registry = await ethers.getContractFactory("AkibaVoucherRegistry");
  const registryInitData = Registry.interface.encodeFunctionData("initialize", [deployerAddr]);
  const { proxy: registryProxy } = await deployProxy("AkibaVoucherRegistry", registryInitData);

  // ── 3. AkibaClawGame ─────────────────────────────────────────────────────
  console.log("3/3  Deploying AkibaClawGame…");
  const Game = await ethers.getContractFactory("AkibaClawGame");
  const gameInitData = Game.interface.encodeFunctionData("initialize", [
    WITNET_RNG,
    MINI_POINTS,
    USDT,
    vaultProxy,
    registryProxy,
    deployerAddr,
  ]);
  const { proxy: gameProxy } = await deployProxy("AkibaClawGame", gameInitData);

  // ── 4. Wire authorizations ───────────────────────────────────────────────
  console.log("\n  Wiring authorizations…");

  const vault    = Vault.attach(vaultProxy).connect(deployer);
  const registry = Registry.attach(registryProxy).connect(deployer);

  let tx = await (vault as any).setAuthorized(gameProxy, true);
  await tx.wait(1);
  console.log(`  ✓ Vault authorized ClawGame`);

  tx = await (registry as any).setAuthorized(gameProxy, true);
  await tx.wait(1);
  console.log(`  ✓ Registry authorized ClawGame`);

  // ── 5. Set ClawGame as minter on MiniPoints ──────────────────────────────
  console.log("  Attempting setMinter on MiniPoints…");
  try {
    const milesAbi = ["function setMinter(address who, bool enabled) external"];
    const miles = new ethers.Contract(MINI_POINTS, milesAbi, deployer);
    tx = await miles.setMinter(gameProxy, true);
    await tx.wait(1);
    console.log(`  ✓ ClawGame set as minter on MiniPoints`);
  } catch (e: any) {
    console.warn(`  ⚠  setMinter failed (${e.reason ?? e.message}) — grant manually if needed`);
  }

  // ── 6. Get deploy block for event scanning ───────────────────────────────
  const deployBlock = await ethers.provider.getBlockNumber();

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════");
  console.log("  DEPLOYMENT COMPLETE ✓");
  console.log("═══════════════════════════════════════════════");
  console.log(`  AkibaRewardVault:     ${vaultProxy}`);
  console.log(`  AkibaVoucherRegistry: ${registryProxy}`);
  console.log(`  AkibaClawGame:        ${gameProxy}`);
  console.log(`  Deploy block:         ${deployBlock}`);
  console.log("");
  console.log("  Add to react-app/.env.local:");
  console.log(`  NEXT_PUBLIC_CLAW_GAME_ADDRESS=${gameProxy}`);
  console.log(`  NEXT_PUBLIC_CLAW_CHAIN_ID=42220`);
  console.log(`  NEXT_PUBLIC_CLAW_DEPLOY_BLOCK=${deployBlock}`);
  console.log(`  NEXT_PUBLIC_CLAW_USDT_ADDRESS=${USDT}`);
  console.log(`  NEXT_PUBLIC_CLAW_RPC_URL=https://forno.celo.org`);
  console.log("═══════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
