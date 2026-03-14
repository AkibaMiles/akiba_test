// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
// Stub — original file missing from repo. Keeps compilation unblocked for other contracts.
interface IPhysicalNFT {}

// Minimal stub so MiniRaffleV3 can reference PhysicalPrizeNFT.mintTo without the real impl.
contract PhysicalPrizeNFT {
    function mintTo(address, uint64, uint256, string calldata) external virtual {}
}
