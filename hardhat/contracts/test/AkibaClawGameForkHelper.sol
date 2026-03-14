// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AkibaClawGame} from "../claw/AkibaClawGame.sol";

/**
 * @dev Fork-test helper that extends AkibaClawGame with a single admin-only
 *      function for injecting a synthetic Pending session without going through
 *      startGame (which would require Witnet oracle resolution in fork mode).
 *
 *      Relies on _sessions and _tiers being `internal` in AkibaClawGame.
 *
 *      NEVER deploy this in production.
 */
contract AkibaClawGameForkHelper is AkibaClawGame {

    /**
     * @notice Inject a Pending GameSession pointing at `requestBlock`.
     *         Increments unresolvedSessions[player] and advances nextSessionId
     *         past `sessionId` if needed.
     *
     * @param sessionId    Desired session ID (must not already exist)
     * @param player       Address recorded as the session owner
     * @param tierId       Tier to reference when settling (must be active)
     * @param requestBlock Block whose Witnet randomness will be consumed
     */
    function injectPendingSession(
        uint256 sessionId,
        address player,
        uint8   tierId,
        uint256 requestBlock
    ) external onlyOwner {
        require(_sessions[sessionId].sessionId == 0, "ForkHelper: session exists");

        _sessions[sessionId] = GameSession({
            sessionId:    sessionId,
            player:       player,
            tierId:       tierId,
            status:       SessionStatus.Pending,
            createdAt:    block.timestamp,
            settledAt:    0,
            requestBlock: requestBlock,
            rewardClass:  RewardClass.None,
            rewardAmount: 0,
            voucherId:    0
        });

        unresolvedSessions[player]++;

        if (nextSessionId <= sessionId) {
            nextSessionId = sessionId + 1;
        }
    }
}
