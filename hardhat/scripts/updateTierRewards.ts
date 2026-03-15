/**
 * updateTierRewards.ts — Update commonMilesReward to 2× play cost for Tiers 0 and 1.
 *
 * Usage:
 *   npx hardhat run scripts/updateTierRewards.ts --network celo
 */

import { ethers } from "hardhat";

const PROXY_ADDRESS = "0x32cd4449A49786f8e9C68A5466d46E4dbC5197B3";

async function main() {
  const [deployer] = await ethers.getSigners();
  const game = await ethers.getContractAt("AkibaClawGame", PROXY_ADDRESS, deployer);

  for (const tierId of [0, 1]) {
    const c = await game.getTierConfig(tierId);
    const newCommon = c.playCost * 2n;

    console.log(`Tier ${tierId}: ${ethers.formatEther(c.commonMilesReward)} → ${ethers.formatEther(newCommon)} Miles`);

    const tx = await game.setTierConfig(tierId, {
      active:              c.active,
      tierId:              c.tierId,
      payInMiles:          c.payInMiles,
      playCost:            c.playCost,
      loseWeight:          c.loseWeight,
      commonWeight:        c.commonWeight,
      rareWeight:          c.rareWeight,
      epicWeight:          c.epicWeight,
      legendaryWeight:     c.legendaryWeight,
      commonMilesReward:   newCommon,
      rareBurnMiles:       c.rareBurnMiles,
      epicUsdtReward:      c.epicUsdtReward,
      legendaryBurnUsdt:   c.legendaryBurnUsdt,
      rareVoucherBps:      c.rareVoucherBps,
      legendaryVoucherBps: c.legendaryVoucherBps,
      legendaryVoucherCap: c.legendaryVoucherCap,
      dailyPlayLimit:      c.dailyPlayLimit,
      legendaryCooldown:   c.legendaryCooldown,
      defaultMerchantId:   c.defaultMerchantId,
    });
    await tx.wait(1);
    console.log(`  ✓ tx ${tx.hash}`);
  }

  console.log("\nDone — Tier 0 Common = 100 Miles, Tier 1 Common = 300 Miles");
}

main().catch((e) => { console.error(e); process.exit(1); });
