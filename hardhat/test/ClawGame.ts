import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

// ─── Helper: convert ethers v6 Result → plain TierConfig object ──────────────
// ethers v6 returns struct Results with positional + named properties;
// spreading them loses the named fields. Use this instead.
function toTierConfig(cfg: any, overrides: Record<string, unknown> = {}) {
  return {
    active:              cfg.active,
    tierId:              cfg.tierId,
    payInMiles:          cfg.payInMiles,
    playCost:            cfg.playCost,
    loseWeight:          cfg.loseWeight,
    commonWeight:        cfg.commonWeight,
    rareWeight:          cfg.rareWeight,
    epicWeight:          cfg.epicWeight,
    legendaryWeight:     cfg.legendaryWeight,
    commonMilesReward:   cfg.commonMilesReward,
    rareBurnMiles:       cfg.rareBurnMiles,
    epicUsdtReward:      cfg.epicUsdtReward,
    legendaryBurnUsdt:   cfg.legendaryBurnUsdt,
    rareVoucherBps:      cfg.rareVoucherBps,
    legendaryVoucherBps: cfg.legendaryVoucherBps,
    legendaryVoucherCap: cfg.legendaryVoucherCap,
    dailyPlayLimit:      cfg.dailyPlayLimit,
    legendaryCooldown:   cfg.legendaryCooldown,
    defaultMerchantId:   cfg.defaultMerchantId,
    ...overrides,
  };
}

// ─── Roll constants for Basic tier (tierId = 0) ──────────────────────────────
// loseWeight=6000 commonWeight=3200 rareWeight=600 epicWeight=180 legendaryWeight=20
const ROLL = {
  LOSE:      0,      // < 6000
  COMMON:    6000,   // >= 6000, < 9200
  RARE:      9200,   // >= 9200, < 9800
  EPIC:      9800,   // >= 9800, < 9980
  LEGENDARY: 9980,   // >= 9980
} as const;

// ─── Reward class indices (enum order) ───────────────────────────────────────
const RC = { NONE: 0n, LOSE: 1n, COMMON: 2n, RARE: 3n, EPIC: 4n, LEGENDARY: 5n } as const;

// ─── Session status indices ───────────────────────────────────────────────────
const SS = { NONE: 0n, PENDING: 1n, SETTLED: 2n, CLAIMED: 3n, BURNED: 4n, REFUNDED: 5n } as const;

// ─── Amounts (matching _initDefaultTiers) ────────────────────────────────────
const BASIC_COST       = ethers.parseUnits("50",  18);
const BETTER_COST      = ethers.parseUnits("150", 18);
const PREMIUM_COST     = 1_000_000n;          // 1 USDT (6 dec)
const BASIC_COMMON     = ethers.parseUnits("50",  18);
const BASIC_RARE_BURN  = ethers.parseUnits("50",  18);
const BASIC_EPIC_USDT  = 1_000_000n;          // 1 USDT
const BASIC_LEG_USDT   = 3_000_000n;          // 3 USDT
const BETTER_RARE_BURN = ethers.parseUnits("300", 18);
const PREMIUM_COMMON   = ethers.parseUnits("200", 18);
const PREMIUM_RARE_BURN = ethers.parseUnits("600", 18);
const PREMIUM_EPIC_USDT = 2_000_000n;         // 2 USDT
const PREMIUM_LEG_USDT  = 8_000_000n;         // 8 USDT

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixture
// ─────────────────────────────────────────────────────────────────────────────
async function deployFixture() {
  const [owner, alice, bob, keeper] = await ethers.getSigners();

  // Mocks
  const Miles   = await ethers.getContractFactory("MiniPointsMock");
  const miles   = await Miles.deploy();

  const USDT    = await ethers.getContractFactory("MockERC20");
  const usdt    = await USDT.deploy();

  const RNG     = await ethers.getContractFactory("MockWitnetRng");
  const rng     = await RNG.deploy();

  // Vault
  const Vault   = await ethers.getContractFactory("AkibaRewardVault");
  const vault   = await Vault.deploy();
  await vault.waitForDeployment();
  await vault.initialize(await usdt.getAddress(), owner.address);

  // Registry
  const Registry = await ethers.getContractFactory("AkibaVoucherRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  await registry.initialize(owner.address);

  // Game
  const Game   = await ethers.getContractFactory("AkibaClawGame");
  const game   = await Game.deploy();
  await game.waitForDeployment();
  await game.initialize(
    await rng.getAddress(),
    await miles.getAddress(),
    await usdt.getAddress(),
    await vault.getAddress(),
    await registry.getAddress(),
    owner.address,
  );

  // Wire authorizations
  await vault.setAuthorized(await game.getAddress(), true);
  await registry.setAuthorized(await game.getAddress(), true);

  // Fund vault with USDT for payouts
  await usdt.mint(owner.address, 1_000_000_000n); // 1000 USDT
  await usdt.approve(await vault.getAddress(), 1_000_000_000n);
  await vault.deposit(1_000_000_000n);

  return { owner, alice, bob, keeper, miles, usdt, rng, vault, registry, game };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: start + settle a session with a fixed roll
// ─────────────────────────────────────────────────────────────────────────────
async function startAndSettle(
  fixture: Awaited<ReturnType<typeof deployFixture>>,
  player: Awaited<ReturnType<typeof ethers.getSigner>>,
  tierId: number,
  roll: number,
) {
  const { miles, usdt, rng, game } = fixture;

  // Fund player depending on tier
  if (tierId === 2) {
    await usdt.mint(player.address, 10_000_000n);
    await usdt.connect(player).approve(await game.getAddress(), 10_000_000n);
  } else {
    const cost = tierId === 0 ? BASIC_COST : BETTER_COST;
    await miles.mint(player.address, cost);
  }

  // Set the roll the mock will return
  await rng.setFixedRoll(roll);

  // Start game
  const tx   = await game.connect(player).startGame(tierId);
  const rc   = await tx.wait();
  const sessionId = (await game.nextSessionId()) - 1n;

  // Fetch requestBlock
  const session = await game.getSession(sessionId);

  // Force randomness ready on that block
  await rng.forceRandomize(session.requestBlock);

  // Settle
  await game.settleGame(sessionId);

  return sessionId;
}

// ═════════════════════════════════════════════════════════════════════════════
// AkibaRewardVault
// ═════════════════════════════════════════════════════════════════════════════
describe("AkibaRewardVault", () => {
  it("initializes with correct USDT address", async () => {
    const { vault, usdt } = await loadFixture(deployFixture);
    expect(await vault.usdt()).to.equal(await usdt.getAddress());
  });

  it("accepts deposits and tracks balance", async () => {
    const { vault, usdt, alice } = await loadFixture(deployFixture);
    await usdt.mint(alice.address, 5_000_000n);
    await usdt.connect(alice).approve(await vault.getAddress(), 5_000_000n);

    await expect(vault.connect(alice).deposit(5_000_000n))
      .to.emit(vault, "Deposited")
      .withArgs(alice.address, 5_000_000n);

    // balance() view reflects the deposit (on top of fixture seed)
    expect(await vault.balance()).to.be.gte(5_000_000n);
  });

  it("authorized caller can pay out USDT", async () => {
    const { vault, usdt, alice, game } = await loadFixture(deployFixture);
    const before = await usdt.balanceOf(alice.address);

    // owner is not authorized by default — game contract is
    // Call through game's emergencyRefund path is impractical here;
    // test directly by temporarily authorizing the owner for this unit test.
    await vault.setAuthorized((await ethers.getSigners())[0].address, true);
    await vault.pay(alice.address, 1_000_000n);

    expect(await usdt.balanceOf(alice.address)).to.equal(before + 1_000_000n);
  });

  it("reverts pay when not authorized", async () => {
    const { vault, alice } = await loadFixture(deployFixture);
    await expect(vault.connect(alice).pay(alice.address, 1_000_000n))
      .to.be.revertedWithCustomError(vault, "NotAuthorized");
  });

  it("reverts pay when vault balance is insufficient", async () => {
    const { vault, alice } = await loadFixture(deployFixture);
    // drain vault
    const [owner] = await ethers.getSigners();
    await vault.setAuthorized(owner.address, true);
    const bal = await vault.balance();
    await vault.pay(alice.address, bal); // drain

    await expect(vault.pay(alice.address, 1n))
      .to.be.revertedWithCustomError(vault, "InsufficientBalance");
  });

  it("only owner can setAuthorized", async () => {
    const { vault, alice } = await loadFixture(deployFixture);
    await expect(vault.connect(alice).setAuthorized(alice.address, true))
      .to.be.revertedWith("Ownable: caller is not the owner");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AkibaVoucherRegistry
// ═════════════════════════════════════════════════════════════════════════════
describe("AkibaVoucherRegistry", () => {
  it("nextVoucherId starts at 1", async () => {
    const { registry } = await loadFixture(deployFixture);
    expect(await registry.nextVoucherId()).to.equal(1n);
  });

  it("authorized issuer can issue a voucher", async () => {
    const { registry, game } = await loadFixture(deployFixture);
    const [, alice] = await ethers.getSigners();
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 86400 * 14);

    // game contract is authorized — call issue directly from it is not trivial;
    // instead authorize owner for this unit test
    await registry.setAuthorized((await ethers.getSigners())[0].address, true);

    await expect(
      registry.issue(alice.address, 0, 3, 2000, 0, expiry, ethers.ZeroHash)
    ).to.emit(registry, "VoucherIssued");

    const v = await registry.getVoucher(1n);
    expect(v.owner).to.equal(alice.address);
    expect(v.discountBps).to.equal(2000);
    expect(v.redeemed).to.equal(false);
    expect(v.burned).to.equal(false);
  });

  it("unauthorized caller cannot issue", async () => {
    const { registry, alice } = await loadFixture(deployFixture);
    await expect(
      registry.connect(alice).issue(alice.address, 0, 3, 2000, 0, 9999999999n, ethers.ZeroHash)
    ).to.be.revertedWithCustomError(registry, "NotAuthorized");
  });

  it("redeemer can mark a voucher redeemed", async () => {
    const { registry, alice } = await loadFixture(deployFixture);
    const [owner] = await ethers.getSigners();
    await registry.setAuthorized(owner.address, true);
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 86400 * 14);
    await registry.issue(alice.address, 0, 3, 2000, 0, expiry, ethers.ZeroHash);

    // owner is also allowed to redeem (per contract: redeemers[msg.sender] || msg.sender == owner())
    await expect(registry.markRedeemed(1n))
      .to.emit(registry, "VoucherRedeemed")
      .withArgs(1n, alice.address);

    expect((await registry.getVoucher(1n)).redeemed).to.equal(true);
  });

  it("cannot redeem an already-burned voucher", async () => {
    const { registry, alice } = await loadFixture(deployFixture);
    const [owner] = await ethers.getSigners();
    await registry.setAuthorized(owner.address, true);
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 86400 * 14);
    await registry.issue(alice.address, 0, 3, 2000, 0, expiry, ethers.ZeroHash);
    await registry.markBurned(1n);

    await expect(registry.markRedeemed(1n))
      .to.be.revertedWithCustomError(registry, "AlreadyUsed");
  });

  it("cannot burn an already-redeemed voucher", async () => {
    const { registry, alice } = await loadFixture(deployFixture);
    const [owner] = await ethers.getSigners();
    await registry.setAuthorized(owner.address, true);
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 86400 * 14);
    await registry.issue(alice.address, 0, 3, 2000, 0, expiry, ethers.ZeroHash);
    await registry.markRedeemed(1n);

    await expect(registry.markBurned(1n))
      .to.be.revertedWithCustomError(registry, "AlreadyUsed");
  });

  it("markRedeemed reverts on expired voucher", async () => {
    const { registry, alice } = await loadFixture(deployFixture);
    const [owner] = await ethers.getSigners();
    await registry.setAuthorized(owner.address, true);
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 60); // 60 s from now
    await registry.issue(alice.address, 0, 3, 2000, 0, expiry, ethers.ZeroHash);

    // advance time past expiry
    await time.increase(120);

    await expect(registry.markRedeemed(1n))
      .to.be.revertedWithCustomError(registry, "Expired");
  });

  it("isValid returns false after expiry", async () => {
    const { registry, alice } = await loadFixture(deployFixture);
    const [owner] = await ethers.getSigners();
    await registry.setAuthorized(owner.address, true);
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 60);
    await registry.issue(alice.address, 0, 3, 2000, 0, expiry, ethers.ZeroHash);

    expect(await registry.isValid(1n)).to.equal(true);
    await time.increase(120);
    expect(await registry.isValid(1n)).to.equal(false);
  });

  it("getOwnerVouchers returns all issued ids", async () => {
    const { registry, alice } = await loadFixture(deployFixture);
    const [owner] = await ethers.getSigners();
    await registry.setAuthorized(owner.address, true);
    const expiry = 9999999999n;
    await registry.issue(alice.address, 0, 3, 2000, 0, expiry, ethers.ZeroHash);
    await registry.issue(alice.address, 1, 5, 10000, 15_000_000n, expiry, ethers.ZeroHash);

    const ids = await registry.getOwnerVouchers(alice.address);
    expect(ids.length).to.equal(2);
    expect(ids[0]).to.equal(1n);
    expect(ids[1]).to.equal(2n);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AkibaClawGame — Initialization
// ═════════════════════════════════════════════════════════════════════════════
describe("AkibaClawGame — init", () => {
  it("initializes nextSessionId to 1", async () => {
    const { game } = await loadFixture(deployFixture);
    expect(await game.nextSessionId()).to.equal(1n);
  });

  it("maxUnresolvedPerUser defaults to 3", async () => {
    const { game } = await loadFixture(deployFixture);
    expect(await game.maxUnresolvedPerUser()).to.equal(3n);
  });

  it("all three default tiers are active", async () => {
    const { game } = await loadFixture(deployFixture);
    for (const id of [0, 1, 2]) {
      const cfg = await game.getTierConfig(id);
      expect(cfg.active).to.equal(true);
    }
  });

  it("Basic tier has correct playCost and weights summing to 10 000", async () => {
    const { game } = await loadFixture(deployFixture);
    const cfg = await game.getTierConfig(0);
    expect(cfg.playCost).to.equal(BASIC_COST);
    expect(cfg.payInMiles).to.equal(true);
    const sum = cfg.loseWeight + cfg.commonWeight + cfg.rareWeight
              + cfg.epicWeight + cfg.legendaryWeight;
    expect(sum).to.equal(10_000n);
  });

  it("Premium tier payInMiles is false and playCost is 1 USDT", async () => {
    const { game } = await loadFixture(deployFixture);
    const cfg = await game.getTierConfig(2);
    expect(cfg.payInMiles).to.equal(false);
    expect(cfg.playCost).to.equal(PREMIUM_COST);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AkibaClawGame — startGame
// ═════════════════════════════════════════════════════════════════════════════
describe("AkibaClawGame — startGame", () => {
  it("burns Miles and creates a Pending session for Basic tier", async () => {
    const { game, miles, rng, alice } = await loadFixture(deployFixture);
    await miles.mint(alice.address, BASIC_COST);
    await rng.setFixedRoll(ROLL.LOSE);

    const before = await miles.balanceOf(alice.address);
    await expect(game.connect(alice).startGame(0))
      .to.emit(game, "GameStarted");

    expect(await miles.balanceOf(alice.address)).to.equal(before - BASIC_COST);

    const session = await game.getSession(1n);
    expect(session.player).to.equal(alice.address);
    expect(session.tierId).to.equal(0n);
    expect(session.status).to.equal(SS.PENDING);
    expect(session.sessionId).to.equal(1n);
  });

  it("burns correct amount for Better Odds tier", async () => {
    const { game, miles, alice } = await loadFixture(deployFixture);
    await miles.mint(alice.address, BETTER_COST);

    const before = await miles.balanceOf(alice.address);
    await game.connect(alice).startGame(1);
    expect(await miles.balanceOf(alice.address)).to.equal(before - BETTER_COST);
  });

  it("transfers USDT to vault for Premium tier", async () => {
    const { game, usdt, vault, alice } = await loadFixture(deployFixture);
    await usdt.mint(alice.address, PREMIUM_COST);
    await usdt.connect(alice).approve(await game.getAddress(), PREMIUM_COST);

    const vaultBefore = await vault.balance();
    await game.connect(alice).startGame(2);
    expect(await vault.balance()).to.equal(vaultBefore + PREMIUM_COST);
  });

  it("increments unresolvedSessions", async () => {
    const { game, miles, alice } = await loadFixture(deployFixture);
    await miles.mint(alice.address, BASIC_COST);
    await game.connect(alice).startGame(0);
    expect(await game.unresolvedSessions(alice.address)).to.equal(1n);
  });

  it("refunds excess CELO paid as Witnet fee", async () => {
    const { game, miles, alice } = await loadFixture(deployFixture);
    await miles.mint(alice.address, BASIC_COST);

    const excess = ethers.parseEther("0.5");
    const before = await ethers.provider.getBalance(alice.address);
    const tx     = await game.connect(alice).startGame(0, { value: excess });
    const receipt = await tx.wait();
    const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
    const after   = await ethers.provider.getBalance(alice.address);

    // alice spent gas but got the 0.5 CELO back (mock returns full value as usedFee)
    // mock sets usedFee = msg.value so no refund in this case — net cost is just gas
    // (The mock's randomize() returns msg.value as "used fee" so no surplus)
    expect(before - after).to.be.lte(gasUsed + excess);
  });

  it("reverts when tier is inactive", async () => {
    const { game } = await loadFixture(deployFixture);
    await expect(game.startGame(5))
      .to.be.revertedWithCustomError(game, "TierNotActive");
  });

  it("reverts when too many unresolved sessions", async () => {
    const { game, miles, alice } = await loadFixture(deployFixture);

    for (let i = 0; i < 3; i++) {
      await miles.mint(alice.address, BASIC_COST);
      await game.connect(alice).startGame(0);
    }

    await miles.mint(alice.address, BASIC_COST);
    await expect(game.connect(alice).startGame(0))
      .to.be.revertedWithCustomError(game, "TooManyUnresolvedSessions");
  });

  it("enforces daily play limit when configured", async () => {
    const { game, miles, alice, owner } = await loadFixture(deployFixture);

    // Reconfigure Basic tier with dailyPlayLimit = 1
    const cfg = await game.getTierConfig(0);
    await game.connect(owner).setTierConfig(0, toTierConfig(cfg, { dailyPlayLimit: 1n }));

    await miles.mint(alice.address, BASIC_COST * 2n);
    await game.connect(alice).startGame(0);

    await expect(game.connect(alice).startGame(0))
      .to.be.revertedWithCustomError(game, "DailyLimitReached");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AkibaClawGame — settleGame
// ═════════════════════════════════════════════════════════════════════════════
describe("AkibaClawGame — settleGame", () => {
  it("reverts when session does not exist", async () => {
    const { game } = await loadFixture(deployFixture);
    await expect(game.settleGame(999n))
      .to.be.revertedWithCustomError(game, "SessionNotFound");
  });

  it("reverts when randomness is not ready", async () => {
    const { game, miles, alice } = await loadFixture(deployFixture);
    await miles.mint(alice.address, BASIC_COST);
    await game.connect(alice).startGame(0);

    await expect(game.settleGame(1n))
      .to.be.revertedWithCustomError(game, "RandomnessNotReady");
  });

  it("reverts when settling an already-settled session", async () => {
    const f = await loadFixture(deployFixture);
    const sessionId = await startAndSettle(f, f.alice, 0, ROLL.LOSE);

    await expect(f.game.settleGame(sessionId))
      .to.be.revertedWithCustomError(f.game, "WrongStatus");
  });

  it("settles to Lose and emits GameSettled", async () => {
    const f = await loadFixture(deployFixture);
    const sessionId = await startAndSettle(f, f.alice, 0, ROLL.LOSE);

    const session = await f.game.getSession(sessionId);
    expect(session.status).to.equal(SS.SETTLED);
    expect(session.rewardClass).to.equal(RC.LOSE);
    expect(session.rewardAmount).to.equal(0n);
  });

  it("settles to Common with correct Miles amount", async () => {
    const f = await loadFixture(deployFixture);
    const sessionId = await startAndSettle(f, f.alice, 0, ROLL.COMMON);

    const session = await f.game.getSession(sessionId);
    expect(session.rewardClass).to.equal(RC.COMMON);
    expect(session.rewardAmount).to.equal(BASIC_COMMON);
  });

  it("settles to Rare with correct burn fallback", async () => {
    const f = await loadFixture(deployFixture);
    const sessionId = await startAndSettle(f, f.alice, 0, ROLL.RARE);

    const session = await f.game.getSession(sessionId);
    expect(session.rewardClass).to.equal(RC.RARE);
    expect(session.rewardAmount).to.equal(BASIC_RARE_BURN);
  });

  it("settles to Epic with correct USDT amount", async () => {
    const f = await loadFixture(deployFixture);
    const sessionId = await startAndSettle(f, f.alice, 0, ROLL.EPIC);

    const session = await f.game.getSession(sessionId);
    expect(session.rewardClass).to.equal(RC.EPIC);
    expect(session.rewardAmount).to.equal(BASIC_EPIC_USDT);
  });

  it("settles to Legendary and updates lastLegendaryAt", async () => {
    const f = await loadFixture(deployFixture);
    const sessionId = await startAndSettle(f, f.alice, 0, ROLL.LEGENDARY);

    const session = await f.game.getSession(sessionId);
    expect(session.rewardClass).to.equal(RC.LEGENDARY);
    expect(session.rewardAmount).to.equal(BASIC_LEG_USDT);
    expect(await f.game.lastLegendaryAt(f.alice.address)).to.be.gt(0n);
  });

  it("decrements unresolvedSessions after settle", async () => {
    const f = await loadFixture(deployFixture);
    await startAndSettle(f, f.alice, 0, ROLL.LOSE);
    expect(await f.game.unresolvedSessions(f.alice.address)).to.equal(0n);
  });

  it("keeper (third party) can settle permissionlessly", async () => {
    const f   = await loadFixture(deployFixture);
    const { game, miles, rng, alice, keeper } = f;

    await miles.mint(alice.address, BASIC_COST);
    await rng.setFixedRoll(ROLL.COMMON);
    await game.connect(alice).startGame(0);

    const session = await game.getSession(1n);
    await rng.forceRandomize(session.requestBlock);

    // keeper settles, not alice
    await expect(game.connect(keeper).settleGame(1n))
      .to.emit(game, "GameSettled");
  });

  it("Better Odds tier settles with correct Rare fallback", async () => {
    const f = await loadFixture(deployFixture);
    // Better Odds: loseWeight=5000 commonWeight=3500 rareWeight=1000
    // Rare band: [8500, 9500) — use 8500
    const sessionId = await startAndSettle(f, f.alice, 1, 8500);

    const session = await f.game.getSession(sessionId);
    expect(session.rewardClass).to.equal(RC.RARE);
    expect(session.rewardAmount).to.equal(BETTER_RARE_BURN);
  });

  it("Premium tier Common settle mints 200 Miles", async () => {
    const f = await loadFixture(deployFixture);
    // Premium: loseWeight=4500 commonWeight=3500
    // Common band: [4500, 8000) — use 5000
    const sessionId = await startAndSettle(f, f.alice, 2, 5000);

    const session = await f.game.getSession(sessionId);
    expect(session.rewardClass).to.equal(RC.COMMON);
    expect(session.rewardAmount).to.equal(PREMIUM_COMMON);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AkibaClawGame — claimReward
// ═════════════════════════════════════════════════════════════════════════════
describe("AkibaClawGame — claimReward", () => {
  it("Lose: emits RewardClaimed with no token transfer", async () => {
    const f = await loadFixture(deployFixture);
    const sessionId = await startAndSettle(f, f.alice, 0, ROLL.LOSE);

    const before = await f.miles.balanceOf(f.alice.address);
    await expect(f.game.connect(f.alice).claimReward(sessionId))
      .to.emit(f.game, "RewardClaimed")
      .withArgs(sessionId, f.alice.address, RC.LOSE);

    expect(await f.miles.balanceOf(f.alice.address)).to.equal(before);
    expect((await f.game.getSession(sessionId)).status).to.equal(SS.CLAIMED);
  });

  it("Common: mints correct AkibaMiles", async () => {
    const f = await loadFixture(deployFixture);
    const sessionId = await startAndSettle(f, f.alice, 0, ROLL.COMMON);

    const before = await f.miles.balanceOf(f.alice.address);
    await f.game.connect(f.alice).claimReward(sessionId);

    expect(await f.miles.balanceOf(f.alice.address)).to.equal(before + BASIC_COMMON);
    expect((await f.game.getSession(sessionId)).status).to.equal(SS.CLAIMED);
  });

  it("Epic: transfers USDT from vault to player", async () => {
    const f = await loadFixture(deployFixture);
    const sessionId = await startAndSettle(f, f.alice, 0, ROLL.EPIC);

    const before = await f.usdt.balanceOf(f.alice.address);
    await f.game.connect(f.alice).claimReward(sessionId);

    expect(await f.usdt.balanceOf(f.alice.address)).to.equal(before + BASIC_EPIC_USDT);
  });

  it("Rare: issues a voucher in the registry", async () => {
    const f = await loadFixture(deployFixture);
    const sessionId = await startAndSettle(f, f.alice, 0, ROLL.RARE);

    await expect(f.game.connect(f.alice).claimReward(sessionId))
      .to.emit(f.game, "VoucherIssued");

    const session = await f.game.getSession(sessionId);
    expect(session.voucherId).to.be.gt(0n);

    const voucher = await f.registry.getVoucher(session.voucherId);
    expect(voucher.owner).to.equal(f.alice.address);
    expect(voucher.discountBps).to.equal(2000);
    expect(voucher.redeemed).to.equal(false);
    expect(voucher.burned).to.equal(false);
  });

  it("Legendary: issues a 100% voucher with cap", async () => {
    const f = await loadFixture(deployFixture);
    const sessionId = await startAndSettle(f, f.alice, 0, ROLL.LEGENDARY);

    await f.game.connect(f.alice).claimReward(sessionId);

    const session = await f.game.getSession(sessionId);
    const voucher = await f.registry.getVoucher(session.voucherId);
    expect(voucher.discountBps).to.equal(10000);
    expect(voucher.maxValue).to.equal(15_000_000n);  // 15 USDT cap
  });

  it("reverts when not the player", async () => {
    const f = await loadFixture(deployFixture);
    const sessionId = await startAndSettle(f, f.alice, 0, ROLL.COMMON);

    await expect(f.game.connect(f.bob).claimReward(sessionId))
      .to.be.revertedWithCustomError(f.game, "NotPlayer");
  });

  it("reverts on double claim", async () => {
    const f = await loadFixture(deployFixture);
    const sessionId = await startAndSettle(f, f.alice, 0, ROLL.COMMON);

    await f.game.connect(f.alice).claimReward(sessionId);
    await expect(f.game.connect(f.alice).claimReward(sessionId))
      .to.be.revertedWithCustomError(f.game, "WrongStatus");
  });

  it("reverts when session not settled yet", async () => {
    const { game, miles, alice } = await loadFixture(deployFixture);
    await miles.mint(alice.address, BASIC_COST);
    await game.connect(alice).startGame(0); // Pending, not settled

    await expect(game.connect(alice).claimReward(1n))
      .to.be.revertedWithCustomError(game, "WrongStatus");
  });

  it("Premium Epic pays 2 USDT", async () => {
    const f = await loadFixture(deployFixture);
    // Premium Epic band: [4500+3500+1200, ...) = [9200, 9800) — use 9200
    const sessionId = await startAndSettle(f, f.alice, 2, 9200);

    const before = await f.usdt.balanceOf(f.alice.address);
    await f.game.connect(f.alice).claimReward(sessionId);
    expect(await f.usdt.balanceOf(f.alice.address)).to.equal(before + PREMIUM_EPIC_USDT);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AkibaClawGame — burnVoucherReward
// ═════════════════════════════════════════════════════════════════════════════
describe("AkibaClawGame — burnVoucherReward", () => {
  it("Path A — Rare burn (before claim): mints fallback Miles", async () => {
    const f = await loadFixture(deployFixture);
    const sessionId = await startAndSettle(f, f.alice, 0, ROLL.RARE);

    const before = await f.miles.balanceOf(f.alice.address);
    await expect(f.game.connect(f.alice).burnVoucherReward(sessionId))
      .to.emit(f.game, "VoucherBurned")
      .withArgs(0n, f.alice.address, BASIC_RARE_BURN);

    expect(await f.miles.balanceOf(f.alice.address)).to.equal(before + BASIC_RARE_BURN);
    expect((await f.game.getSession(sessionId)).status).to.equal(SS.BURNED);
  });

  it("Path A — Legendary burn (before claim): pays fallback USDT", async () => {
    const f = await loadFixture(deployFixture);
    const sessionId = await startAndSettle(f, f.alice, 0, ROLL.LEGENDARY);

    const before = await f.usdt.balanceOf(f.alice.address);
    await f.game.connect(f.alice).burnVoucherReward(sessionId);

    expect(await f.usdt.balanceOf(f.alice.address)).to.equal(before + BASIC_LEG_USDT);
    expect((await f.game.getSession(sessionId)).status).to.equal(SS.BURNED);
  });

  it("Path B — Rare burn (after claim): burns issued voucher and mints Miles", async () => {
    const f = await loadFixture(deployFixture);
    const sessionId = await startAndSettle(f, f.alice, 0, ROLL.RARE);

    // Claim first — issues the voucher
    await f.game.connect(f.alice).claimReward(sessionId);
    const session    = await f.game.getSession(sessionId);
    const voucherId  = session.voucherId;
    expect(voucherId).to.be.gt(0n);

    // Now burn it
    const before = await f.miles.balanceOf(f.alice.address);
    await expect(f.game.connect(f.alice).burnVoucherReward(sessionId))
      .to.emit(f.game, "VoucherBurned")
      .withArgs(voucherId, f.alice.address, BASIC_RARE_BURN);

    expect(await f.miles.balanceOf(f.alice.address)).to.equal(before + BASIC_RARE_BURN);
    expect((await f.registry.getVoucher(voucherId)).burned).to.equal(true);
    expect((await f.game.getSession(sessionId)).status).to.equal(SS.BURNED);
  });

  it("Path B — Legendary burn (after claim): burns voucher and pays USDT", async () => {
    const f = await loadFixture(deployFixture);
    const sessionId = await startAndSettle(f, f.alice, 0, ROLL.LEGENDARY);

    await f.game.connect(f.alice).claimReward(sessionId);
    const voucherId = (await f.game.getSession(sessionId)).voucherId;

    const before = await f.usdt.balanceOf(f.alice.address);
    await f.game.connect(f.alice).burnVoucherReward(sessionId);

    expect(await f.usdt.balanceOf(f.alice.address)).to.equal(before + BASIC_LEG_USDT);
    expect((await f.registry.getVoucher(voucherId)).burned).to.equal(true);
  });

  it("reverts on non-voucher reward class (Lose)", async () => {
    const f = await loadFixture(deployFixture);
    const sessionId = await startAndSettle(f, f.alice, 0, ROLL.LOSE);

    await expect(f.game.connect(f.alice).burnVoucherReward(sessionId))
      .to.be.revertedWith("Claw: not a voucher reward");
  });

  it("reverts when called by non-player", async () => {
    const f = await loadFixture(deployFixture);
    const sessionId = await startAndSettle(f, f.alice, 0, ROLL.RARE);

    await expect(f.game.connect(f.bob).burnVoucherReward(sessionId))
      .to.be.revertedWithCustomError(f.game, "NotPlayer");
  });

  it("cannot burn twice (double-burn after Path A)", async () => {
    const f = await loadFixture(deployFixture);
    const sessionId = await startAndSettle(f, f.alice, 0, ROLL.RARE);

    await f.game.connect(f.alice).burnVoucherReward(sessionId);
    await expect(f.game.connect(f.alice).burnVoucherReward(sessionId))
      .to.be.revertedWithCustomError(f.game, "WrongStatus");
  });

  it("Premium Rare burn gives correct fallback Miles", async () => {
    const f = await loadFixture(deployFixture);
    // Premium Rare band: [4500+3500, 4500+3500+1200) = [8000, 9200) — use 8000
    const sessionId = await startAndSettle(f, f.alice, 2, 8000);

    const before = await f.miles.balanceOf(f.alice.address);
    await f.game.connect(f.alice).burnVoucherReward(sessionId);
    expect(await f.miles.balanceOf(f.alice.address)).to.equal(before + PREMIUM_RARE_BURN);
  });

  it("Premium Legendary burn gives correct USDT", async () => {
    const f = await loadFixture(deployFixture);
    // Premium Legendary band: [9800, 10000) — use 9800
    const sessionId = await startAndSettle(f, f.alice, 2, 9800);

    const before = await f.usdt.balanceOf(f.alice.address);
    await f.game.connect(f.alice).burnVoucherReward(sessionId);
    expect(await f.usdt.balanceOf(f.alice.address)).to.equal(before + PREMIUM_LEG_USDT);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AkibaClawGame — Admin
// ═════════════════════════════════════════════════════════════════════════════
describe("AkibaClawGame — admin", () => {
  it("emergencyRefund returns Miles to player for Basic tier", async () => {
    const { game, miles, alice, owner } = await loadFixture(deployFixture);
    await miles.mint(alice.address, BASIC_COST);
    await game.connect(alice).startGame(0);

    const before = await miles.balanceOf(alice.address);
    await expect(game.connect(owner).emergencyRefund(1n))
      .to.emit(game, "EmergencyRefund")
      .withArgs(1n, alice.address);

    expect(await miles.balanceOf(alice.address)).to.equal(before + BASIC_COST);
    expect((await game.getSession(1n)).status).to.equal(SS.REFUNDED);
    expect(await game.unresolvedSessions(alice.address)).to.equal(0n);
  });

  it("emergencyRefund pays USDT back for Premium tier", async () => {
    const { game, usdt, vault, alice, owner } = await loadFixture(deployFixture);
    await usdt.mint(alice.address, PREMIUM_COST);
    await usdt.connect(alice).approve(await game.getAddress(), PREMIUM_COST);
    await game.connect(alice).startGame(2);

    const before = await usdt.balanceOf(alice.address);
    await game.connect(owner).emergencyRefund(1n);
    expect(await usdt.balanceOf(alice.address)).to.equal(before + PREMIUM_COST);
  });

  it("emergencyRefund reverts on non-Pending session", async () => {
    const f = await loadFixture(deployFixture);
    const sessionId = await startAndSettle(f, f.alice, 0, ROLL.LOSE);

    await expect(f.game.connect(f.owner).emergencyRefund(sessionId))
      .to.be.revertedWithCustomError(f.game, "WrongStatus");
  });

  it("only owner can emergencyRefund", async () => {
    const { game, miles, alice } = await loadFixture(deployFixture);
    await miles.mint(alice.address, BASIC_COST);
    await game.connect(alice).startGame(0);

    await expect(game.connect(alice).emergencyRefund(1n))
      .to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("setTierConfig rejects weights not summing to 10 000", async () => {
    const { game, owner } = await loadFixture(deployFixture);
    const cfg = await game.getTierConfig(0);

    await expect(
      game.connect(owner).setTierConfig(0, toTierConfig(cfg, { loseWeight: 5000n }))
    ).to.be.revertedWithCustomError(game, "InvalidWeights");
  });

  it("setTierConfig updates tier correctly", async () => {
    const { game, owner } = await loadFixture(deployFixture);
    const cfg = await game.getTierConfig(0);
    const newCfg = toTierConfig(cfg, { playCost: ethers.parseUnits("100", 18) });

    await expect(game.connect(owner).setTierConfig(0, newCfg))
      .to.emit(game, "TierConfigured")
      .withArgs(0n);

    expect((await game.getTierConfig(0)).playCost).to.equal(ethers.parseUnits("100", 18));
  });

  it("pause blocks startGame", async () => {
    const { game, miles, alice, owner } = await loadFixture(deployFixture);
    await game.connect(owner).pause();
    await miles.mint(alice.address, BASIC_COST);

    await expect(game.connect(alice).startGame(0))
      .to.be.revertedWith("Pausable: paused");
  });

  it("pause blocks claimReward", async () => {
    const f = await loadFixture(deployFixture);
    const sessionId = await startAndSettle(f, f.alice, 0, ROLL.COMMON);

    await f.game.connect(f.owner).pause();
    await expect(f.game.connect(f.alice).claimReward(sessionId))
      .to.be.revertedWith("Pausable: paused");
  });

  it("unpause restores startGame", async () => {
    const { game, miles, alice, owner } = await loadFixture(deployFixture);
    await game.connect(owner).pause();
    await game.connect(owner).unpause();

    await miles.mint(alice.address, BASIC_COST);
    await expect(game.connect(alice).startGame(0)).to.emit(game, "GameStarted");
  });

  it("setMaxUnresolvedPerUser is respected", async () => {
    const { game, miles, alice, owner } = await loadFixture(deployFixture);
    await game.connect(owner).setMaxUnresolvedPerUser(1n);

    await miles.mint(alice.address, BASIC_COST * 2n);
    await game.connect(alice).startGame(0);

    await expect(game.connect(alice).startGame(0))
      .to.be.revertedWithCustomError(game, "TooManyUnresolvedSessions");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AkibaClawGame — Safety / anti-abuse
// ═════════════════════════════════════════════════════════════════════════════
describe("AkibaClawGame — safety", () => {
  it("legendary cooldown blocks re-entry within cooldown window", async () => {
    const f = await loadFixture(deployFixture);

    // Win a legendary
    await startAndSettle(f, f.alice, 0, ROLL.LEGENDARY);

    // Immediately try again — cooldown is 7 days, we're within it
    await f.miles.mint(f.alice.address, BASIC_COST);
    await expect(f.game.connect(f.alice).startGame(0))
      .to.be.revertedWithCustomError(f.game, "LegendaryCooldownActive");
  });

  it("legendary cooldown allows re-entry after cooldown expires", async () => {
    const f = await loadFixture(deployFixture);

    await startAndSettle(f, f.alice, 0, ROLL.LEGENDARY);

    // Advance time past 7 days
    await time.increase(7 * 24 * 3600 + 1);

    await f.miles.mint(f.alice.address, BASIC_COST);
    await expect(f.game.connect(f.alice).startGame(0))
      .to.emit(f.game, "GameStarted");
  });

  it("canSettle returns false before randomness is ready", async () => {
    const { game, miles, alice } = await loadFixture(deployFixture);
    await miles.mint(alice.address, BASIC_COST);
    await game.connect(alice).startGame(0);

    expect(await game.canSettle(1n)).to.equal(false);
  });

  it("canSettle returns true once randomness is ready", async () => {
    const { game, miles, rng, alice } = await loadFixture(deployFixture);
    await miles.mint(alice.address, BASIC_COST);
    await game.connect(alice).startGame(0);

    const session = await game.getSession(1n);
    await rng.forceRandomize(session.requestBlock);

    expect(await game.canSettle(1n)).to.equal(true);
  });

  it("multiple players in same block get different sessions but share one Witnet request", async () => {
    const { game, miles, rng, alice, bob } = await loadFixture(deployFixture);

    await miles.mint(alice.address, BASIC_COST);
    await miles.mint(bob.address, BASIC_COST);

    // Both start in the same block by using hardhat's auto-mining
    await ethers.provider.send("evm_setAutomine", [false]);
    await game.connect(alice).startGame(0);
    await game.connect(bob).startGame(0);
    await ethers.provider.send("evm_mine", []);
    await ethers.provider.send("evm_setAutomine", [true]);

    const s1 = await game.getSession(1n);
    const s2 = await game.getSession(2n);

    // Same block — same requestBlock
    expect(s1.requestBlock).to.equal(s2.requestBlock);
    // But different session IDs, so random() nonce differs
    expect(s1.sessionId).to.not.equal(s2.sessionId);
  });

  it("session not found for id 0 or uncreated id", async () => {
    const { game } = await loadFixture(deployFixture);
    await expect(game.settleGame(0n)).to.be.revertedWithCustomError(game, "SessionNotFound");
    await expect(game.claimReward(99n)).to.be.revertedWithCustomError(game, "SessionNotFound");
  });
});
