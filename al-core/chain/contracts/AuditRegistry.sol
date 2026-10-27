// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title AL audit registry
/// @notice Stores one SHA-256 hash per decision, so anyone can later prove a decision record hasn't changed.
/// The hash is of the canonical decision record built by al-core (see al-core/SCHEMA.md and app/audit.py).
/// Only the hash and an application reference go on-chain: the reference is a SHA-256 of the application id,
/// built the same way as the loan note's, so no personal data is stored. A hash can be written once and
/// never changed or removed.
contract AuditRegistry is AccessControl {
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");

    struct Entry {
        bytes32 hash;
        uint64 storedAt;
    }

    mapping(bytes32 applicationRef => Entry) private _entries;

    event HashStored(bytes32 indexed applicationRef, bytes32 hash, uint64 storedAt);

    error AlreadyStored(bytes32 applicationRef);
    error InvalidEntry(string reason);
    error UnknownApplication(bytes32 applicationRef);
    error ZeroAddress(string role);

    /// @param admin can grant and revoke roles (the team's deployer wallet)
    /// @param registrar al-core's wallet, the only account that can store a hash
    constructor(address admin, address registrar) {
        if (admin == address(0)) revert ZeroAddress("admin");
        if (registrar == address(0)) revert ZeroAddress("registrar");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REGISTRAR_ROLE, registrar);
    }

    /// @notice Store the hash of an application's final decision record. A second write for the same
    /// application is refused, so a stored hash can't be changed.
    function store(bytes32 applicationRef, bytes32 hash) external onlyRole(REGISTRAR_ROLE) {
        if (applicationRef == bytes32(0)) revert InvalidEntry("application reference is empty");
        if (hash == bytes32(0)) revert InvalidEntry("hash is empty");
        if (_entries[applicationRef].storedAt != 0) revert AlreadyStored(applicationRef);

        uint64 storedAt = uint64(block.timestamp);
        _entries[applicationRef] = Entry({hash: hash, storedAt: storedAt});
        emit HashStored(applicationRef, hash, storedAt);
    }

    /// @notice The stored hash and the time it was stored. Reverts if nothing is stored for the application.
    function recordOf(bytes32 applicationRef) external view returns (bytes32 hash, uint64 storedAt) {
        Entry memory entry = _entries[applicationRef];
        if (entry.storedAt == 0) revert UnknownApplication(applicationRef);
        return (entry.hash, entry.storedAt);
    }
}
