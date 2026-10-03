// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Optional public timestamps for Ludus Chronicle hashes. No token fees.
/// @dev An anchor is a publisher's claim, not proof of authorship or truth.
contract PeachExChronicleAnchor {
    address public immutable peachExToken;
    struct Checkpoint { bytes32 head; uint64 eventIndex; bool exists; }
    mapping(address => mapping(bytes32 => Checkpoint)) public checkpoints;
    error InvalidToken();
    error EmptyCommitment();
    error NonIncreasingIndex();
    event ChronicleAnchored(address indexed publisher, bytes32 indexed chronicleId, bytes32 head, uint64 eventIndex);

    constructor(address token) {
        if (token.code.length == 0) revert InvalidToken();
        peachExToken = token;
    }

    function anchor(bytes32 chronicleId, uint64 eventIndex, bytes32 head) external {
        if (chronicleId == bytes32(0) || head == bytes32(0)) revert EmptyCommitment();
        Checkpoint storage previous = checkpoints[msg.sender][chronicleId];
        if (previous.exists && eventIndex <= previous.eventIndex) revert NonIncreasingIndex();
        checkpoints[msg.sender][chronicleId] = Checkpoint(head, eventIndex, true);
        emit ChronicleAnchored(msg.sender, chronicleId, head, eventIndex);
    }
}
