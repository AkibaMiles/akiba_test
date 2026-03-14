// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Minimal Witnet RNG mock for testing AkibaClawGame.
///      Only implements the three functions the game contract actually calls.
contract MockWitnetRng {
    /// @dev blockNumber → whether randomness is ready
    mapping(uint256 => bool) public randomized;

    /// @dev The roll returned by random() — set per-test to force a reward class
    uint32 public fixedRoll;

    /* ─── Test helpers ──────────────────────────────────────────────────── */

    /// @notice Mark a block as having randomness available.
    function forceRandomize(uint256 blockNumber) external {
        randomized[blockNumber] = true;
    }

    /// @notice Set the value random() will return for the next settle.
    function setFixedRoll(uint32 roll) external {
        fixedRoll = roll;
    }

    /* ─── IWitRandomnessLegacy surface used by AkibaClawGame ────────────── */

    /// @notice Simulate posting a randomness request; charges no fee.
    function randomize() external payable returns (uint256) {
        // Return msg.value as "used fee" so excess refund logic is exercised.
        return msg.value;
    }

    /// @notice Returns whether randomness is available for the given block.
    function isRandomized(uint256 blockNumber) external view returns (bool) {
        return randomized[blockNumber];
    }

    /// @notice Returns the fixed roll, capped to [0, range).
    function random(uint32 range, uint256 /*nonce*/, uint256 /*blockNumber*/)
        external
        view
        returns (uint32)
    {
        return fixedRoll < range ? fixedRoll : range - 1;
    }

    /// @notice Fee estimate — always 0 in tests.
    function estimateRandomizeFee(uint256) external pure returns (uint256) {
        return 0;
    }
}
