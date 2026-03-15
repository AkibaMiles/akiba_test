/**
 * deployVRFBridge.ts — Deploy ClawVRFBridge on OP Mainnet.
 *
 * This is Step 1 of the cross-chain Chainlink VRF setup (alternative to Pyth).
 * Run AFTER you have created a Chainlink VRF v2.5 subscription on OP and added
 * this contract as a consumer.
 *
 * Usage:
 *   npx hardhat run scripts/deployVRFBridge.ts --network optimism
 *
 * Required env vars:
 *   PRIVATE_KEY
 *   VRF_SUBSCRIPTION_ID      — Chainlink VRF v2.5 subscription ID on OP
 *   CELO_ADAPTER_ADDRESS     — CrossChainVRFAdapter address on Celo (deploy that first)
 *
 * After deploying:
 *   - Fund the bridge with ETH for LZ return fees (0.05 ETH suggested)
 *   - Add the bridge as a consumer on your Chainlink subscription
 *   - Call bridge.setPeer(celoEid, adapterAddress) and adapter.setPeer(opEid, bridgeAddress)
 */

import { ethers } from "hardhat";

// ── OP Mainnet addresses ─────────────────────────────────────────────────────
// Chainlink VRF v2.5 Coordinator on OP Mainnet
const VRF_COORDINATOR   = "0xd5AFdc4CC1f474a29bfe06e28E7D1A40F9be7FD9";
// 150-gwei key hash (check https://docs.chain.link/vrf/v2-5/supported-networks)
const VRF_KEY_HASH      = "0x027f94ff1465b3525f9fc03e9ff7d6d2c0953482246dd6ae0e8a04b93f1f7f53";

// LayerZero v2 constants
const LZ_ENDPOINT       = "0x1a44076050125825900e736c501f859c50fE728c"; // same on all chains
const LZ_CELO_EID       = 30125;   // Celo mainnet LZ v2 EID
const LZ_RECEIVE_GAS    = 300_000; // gas forwarded to lzReceive on Celo

// VRF settings — tune to your gas price / latency preference
const REQUEST_CONFIRMATIONS = 1;   // 1 = fastest on OP
const CALLBACK_GAS_LIMIT    = 100_000; // fulfillRandomWords only stores; kept cheap

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddr = await deployer.getAddress();
  const balance = await ethers.provider.getBalance(deployerAddr);

  const subId = process.env.VRF_SUBSCRIPTION_ID ?? "";
  if (!subId) throw new Error("Set VRF_SUBSCRIPTION_ID in env");

  console.log("\n═══════════════════════════════════════════════");
  console.log("  ClawVRFBridge — OP Mainnet Deployment");
  console.log("═══════════════════════════════════════════════");
  console.log(`  Deployer:    ${deployerAddr}`);
  console.log(`  Balance:     ${ethers.formatEther(balance)} ETH`);
  console.log(`  VRF Sub ID:  ${subId}`);
  console.log(`  LZ Celo EID: ${LZ_CELO_EID}`);
  console.log("");

  // 1. Deploy bridge
  console.log("1/2  Deploying ClawVRFBridge…");
  const Bridge = await ethers.getContractFactory("ClawVRFBridge");
  // Constructor: vrfCoordinator, lzEndpoint, keyHash, subscriptionId,
  //              requestConfirmations, callbackGasLimit, celoEid, lzReceiveGasLimit
  const bridge = await Bridge.deploy(
    VRF_COORDINATOR,
    LZ_ENDPOINT,
    VRF_KEY_HASH,
    BigInt(subId),
    REQUEST_CONFIRMATIONS,
    CALLBACK_GAS_LIMIT,
    LZ_CELO_EID,
    LZ_RECEIVE_GAS,
  );
  await bridge.waitForDeployment();
  const bridgeAddr = await bridge.getAddress();
  console.log(`     ClawVRFBridge: ${bridgeAddr}`);

  // 2. Fund with ETH for LZ return fees
  console.log("2/2  Funding bridge with 0.05 ETH for LZ fees…");
  const tx = await deployer.sendTransaction({
    to: bridgeAddr,
    value: ethers.parseEther("0.05"),
  });
  await tx.wait(1);
  console.log("     ✓ Funded");

  const celoAdapterAddr = process.env.CELO_ADAPTER_ADDRESS ?? "<deploy CrossChainVRFAdapter first>";

  console.log("\n═══════════════════════════════════════════════");
  console.log("  DEPLOYMENT COMPLETE ✓");
  console.log("═══════════════════════════════════════════════");
  console.log(`  ClawVRFBridge (OP): ${bridgeAddr}`);
  console.log("");
  console.log("  Remaining manual steps:");
  console.log(`  1. Add ${bridgeAddr} as a consumer on VRF subscription ${subId}`);
  console.log(`  2. On bridge (OP):   setPeer(${LZ_CELO_EID}, bytes32(${celoAdapterAddr}))`);
  console.log(`  3. On adapter (Celo): setPeer(30111, bytes32(${bridgeAddr}))`);
  console.log(`  4. Verify: npx hardhat verify --network optimism ${bridgeAddr} \\`);
  console.log(`       ${VRF_COORDINATOR} ${LZ_ENDPOINT} \\`);
  console.log(`       ${VRF_KEY_HASH} ${subId} ${REQUEST_CONFIRMATIONS} \\`);
  console.log(`       ${CALLBACK_GAS_LIMIT} ${LZ_CELO_EID} ${LZ_RECEIVE_GAS}`);
  console.log("═══════════════════════════════════════════════\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
