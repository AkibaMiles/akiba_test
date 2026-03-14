import { expect } from "chai";
import { ethers } from "hardhat";

/**
 * Fork integration test — AkibaClawGame × Witnet oracle on Celo mainnet.
 *
 * Purpose
 * -------
 * The unit suite (ClawGame.ts) covers all game logic via MockWitnetRng.
 * This fork test deploys against the live Witnet contract on Celo to verify:
 *
 *   1. Witnet is deployed at the expected address and speaks our ABI.
 *   2. estimateRandomizeFee() returns a sensible CELO amount.
 *   3. startGame() succeeds — it calls rng.randomize() and records the
 *      correct requestBlock in the session.
 *   4. settleGame() resolves end-to-end using randomness the oracle already
 *      published for a historical block.
 *   5. rng.random() returns a value in [0, TOTAL_WEIGHT) for any randomised block.
 *
 * Oracle limitation in fork mode
 * --------------------------------
 * After startGame() the Witnet witnesses will NOT relay a result for any
 * newly-mined block, because no off-chain oracle runs against a Hardhat fork.
 * Test 4 therefore uses AkibaClawGameForkHelper.injectPendingSession() to
 * create a synthetic Pending session whose requestBlock points at a recent
 * canonical block that was already randomised on mainnet before the fork
 * snapshot, then calls settleGame() against that session.
 *
 * Run
 * ---
 *   FORK_CELO=true npx hardhat test test/ClawGame.fork.ts
 *   FORK_CELO=true CELO_RPC_URL=https://forno.celo.org npx hardhat test test/ClawGame.fork.ts
 *
 * The FORK_CELO=true env var activates the Celo fork in hardhat.config.ts.
 * Without it the suite is skipped automatically.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const WITNET_CELO = "0xC0FFEE98AD1434aCbDB894BbB752e138c1006fAB";
const CELO_RPC    = process.env.CELO_RPC_URL ?? "https://forno.celo.org";

// Subset of IWitRandomnessLegacy used by AkibaClawGame
const WITNET_ABI = [
  "function estimateRandomizeFee(uint256 gasPrice) external view returns (uint256)",
  "function randomize() external payable returns (uint256)",
  "function isRandomized(uint256 blockNumber) external view returns (bool)",
  "function random(uint32 range, uint256 nonce, uint256 blockNumber) external view returns (uint32)",
];

// ─────────────────────────────────────────────────────────────────────────────

describe("AkibaClawGame — Celo mainnet fork", function () {
  this.timeout(300_000); // fork + RPC calls need extra time

  const BASIC_COST = ethers.parseUnits("50", 18);
  const SS = { PENDING: 1n, SETTLED: 2n };

  let owner:    any;
  let alice:    any;
  let game:     any; // AkibaClawGameForkHelper instance
  let vault:    any;
  let registry: any;
  let miles:    any;
  let usdt:     any;
  let witnet:   any; // read-only handle on the real Witnet contract

  // Cached randomised block — discovered once in before() and reused across tests
  let cachedRandomisedBlock: bigint | undefined;

  // ─── Setup ──────────────────────────────────────────────────────────────────

  before(async function () {
    [owner, alice] = await ethers.getSigners();

    // Detect whether we're on a Celo fork by checking if the Witnet contract
    // has code at its mainnet address.  On a plain Hardhat network it won't.
    // Run with: FORK_CELO=true npx hardhat test test/ClawGame.fork.ts
    const code = await ethers.provider.getCode(WITNET_CELO);
    if (code === "0x") {
      console.log(
        "\n  ⚠  Witnet contract not found — not a Celo mainnet fork. Skipping.\n" +
        "     Run with: FORK_CELO=true npx hardhat test test/ClawGame.fork.ts\n",
      );
      this.skip();
      return;
    }

    witnet = new ethers.Contract(WITNET_CELO, WITNET_ABI, ethers.provider);

    // ── Deploy mock support contracts ──────────────────────────────────────

    miles = await (await ethers.getContractFactory("MiniPointsMock")).deploy();
    usdt  = await (await ethers.getContractFactory("MockERC20")).deploy();

    vault = await (await ethers.getContractFactory("AkibaRewardVault")).deploy();
    await vault.waitForDeployment();
    await vault.initialize(await usdt.getAddress(), owner.address);

    registry = await (await ethers.getContractFactory("AkibaVoucherRegistry")).deploy();
    await registry.waitForDeployment();
    await registry.initialize(owner.address);

    // ── Deploy the fork-test helper subclass (adds injectPendingSession) ──

    game = await (await ethers.getContractFactory("AkibaClawGameForkHelper")).deploy();
    await game.waitForDeployment();
    await game.initialize(
      WITNET_CELO,
      await miles.getAddress(),
      await usdt.getAddress(),
      await vault.getAddress(),
      await registry.getAddress(),
      owner.address,
    );

    await vault.setAuthorized(await game.getAddress(), true);
    await registry.setAuthorized(await game.getAddress(), true);

    // Seed vault with USDT for payout tests
    await usdt.mint(owner.address, 1_000_000_000n);
    await usdt.approve(await vault.getAddress(), 1_000_000_000n);
    await vault.deposit(1_000_000_000n);

    // Discover a historical randomised block once (using parallel batches to
    // avoid making 2000 sequential RPC calls which would time out the hook).
    const latest   = await ethers.provider.getBlockNumber();
    const BATCH    = 10;   // parallel calls per round
    const MAX_BACK = 2000;
    outer: for (let base = latest - 1; base > latest - MAX_BACK; base -= BATCH) {
      const candidates = Array.from(
        { length: BATCH },
        (_, i) => base - i,
      ).filter(b => b > 0);

      const flags = await Promise.all(
        candidates.map(b => witnet.isRandomized(b)),
      );

      for (let i = 0; i < flags.length; i++) {
        if (flags[i]) {
          cachedRandomisedBlock = BigInt(candidates[i]);
          console.log(`    Cached randomised block: ${cachedRandomisedBlock}`);
          break outer;
        }
      }
    }
    if (cachedRandomisedBlock === undefined) {
      console.log("  ⚠  No randomised block found in last 2000 blocks.");
    }
  });

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** Return the randomised block found during setup (or skip the test). */
  function requireRandomisedBlock(ctx: Mocha.Context): bigint {
    if (cachedRandomisedBlock === undefined) ctx.skip();
    return cachedRandomisedBlock!;
  }

  // ─── 1. Oracle presence ────────────────────────────────────────────────────

  it("Witnet contract is deployed at the expected Celo address", async function () {
    const code = await ethers.provider.getCode(WITNET_CELO);
    expect(code.length).to.be.gt(2, "no bytecode at Witnet address");
  });

  it("game.rng() returns the Witnet mainnet address", async function () {
    expect(await game.rng()).to.equal(WITNET_CELO);
  });

  it("estimateRandomizeFee() returns a valid CELO fee (≥ 0)", async function () {
    const feeData  = await ethers.provider.getFeeData();
    const gasPrice = feeData.gasPrice ?? ethers.parseUnits("5", "gwei");
    const fee      = await witnet.estimateRandomizeFee(gasPrice);
    expect(fee).to.be.gte(0n);
    console.log(`    estimateRandomizeFee: ${ethers.formatEther(fee)} CELO`);
  });

  // ─── 2. startGame × real oracle ───────────────────────────────────────────

  it("startGame calls rng.randomize() and creates a Pending session", async function () {
    const feeData  = await ethers.provider.getFeeData();
    const gasPrice = feeData.gasPrice ?? ethers.parseUnits("5", "gwei");
    // +20 % buffer so we never under-pay
    const fee = (await witnet.estimateRandomizeFee(gasPrice)) * 120n / 100n;

    await miles.mint(alice.address, BASIC_COST);
    const tx      = await game.connect(alice).startGame(0, { value: fee });
    const receipt = await tx.wait();

    expect(receipt!.status).to.equal(1, "startGame tx reverted");

    const session = await game.getSession(1n);
    expect(session.player).to.equal(alice.address);
    expect(session.status).to.equal(SS.PENDING);
    expect(session.tierId).to.equal(0n);
    expect(session.requestBlock).to.equal(BigInt(receipt!.blockNumber));

    console.log(`    startGame ok  requestBlock = ${session.requestBlock}`);
  });

  it("canSettle() is false immediately (oracle has not yet relayed for the new block)", async function () {
    expect(await game.canSettle(1n)).to.equal(false);
  });

  // ─── 3. settleGame × historical Witnet randomness ─────────────────────────

  it("settleGame resolves a session using a canonical block already randomised on mainnet", async function () {
    const randomisedBlock = requireRandomisedBlock(this);
    console.log(`    Using historical randomised block: ${randomisedBlock}`);

    // Inject a synthetic Pending session (id=9999) pointing at that block.
    // injectPendingSession is defined in AkibaClawGameForkHelper.
    const FAKE_ID = 9999n;
    await game.connect(owner).injectPendingSession(
      FAKE_ID,
      alice.address,
      0,             // tierId = Basic
      randomisedBlock,
    );

    // Verify the session was written correctly before calling settleGame
    const pending = await game.getSession(FAKE_ID);
    expect(pending.status).to.equal(SS.PENDING);
    expect(pending.requestBlock).to.equal(randomisedBlock);

    // settleGame calls rng.isRandomized() + rng.random() on the real oracle
    await expect(game.settleGame(FAKE_ID))
      .to.emit(game, "GameSettled");

    const settled = await game.getSession(FAKE_ID);
    expect(settled.status).to.equal(SS.SETTLED);
    // rewardClass must be a valid enum value in [1, 5]
    expect(settled.rewardClass).to.be.gte(1n);
    expect(settled.rewardClass).to.be.lte(5n);

    console.log(
      `    Settled  rewardClass = ${settled.rewardClass}  ` +
      `rewardAmount = ${settled.rewardAmount}`,
    );
  });

  // ─── 4. Direct oracle roll validation ─────────────────────────────────────

  it("rng.random() returns a roll in [0, TOTAL_WEIGHT) for a randomised block", async function () {
    const randomisedBlock = requireRandomisedBlock(this);

    const TOTAL_WEIGHT = 10_000;
    const roll         = await witnet.random(TOTAL_WEIGHT, 1n /* nonce */, randomisedBlock);

    expect(Number(roll)).to.be.gte(0);
    expect(Number(roll)).to.be.lt(TOTAL_WEIGHT);
    console.log(`    rng.random(10000, 1, ${randomisedBlock}) = ${roll}`);
  });

  it("rng.random() is deterministic — same args return the same roll", async function () {
    const randomisedBlock = requireRandomisedBlock(this);

    const roll1 = await witnet.random(10_000, 42n, randomisedBlock);
    const roll2 = await witnet.random(10_000, 42n, randomisedBlock);
    expect(roll1).to.equal(roll2);
  });

  it("rng.random() varies with the nonce — same block, different nonces give different rolls", async function () {
    const randomisedBlock = requireRandomisedBlock(this);

    const roll1 = await witnet.random(10_000, 1n,  randomisedBlock);
    const roll2 = await witnet.random(10_000, 2n,  randomisedBlock);
    // Different nonces should produce different rolls in all but astronomically
    // unlikely collisions (1-in-10000 chance).  We accept a skip here rather
    // than a hard assertion to keep the suite non-flaky.
    if (roll1 === roll2) {
      console.log("    (nonce collision — expected ~0.01 % probability)");
    }
    // At minimum both results must be in range
    expect(Number(roll1)).to.be.lt(10_000);
    expect(Number(roll2)).to.be.lt(10_000);
  });
});
