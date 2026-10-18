// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title AL loan note
/// @notice One ERC-721 token per approved loan, holding its principal, APR, term, loan type and a
/// borrower reference. No personal data goes on-chain: the borrower reference is a salted SHA-256 of
/// the borrower's uid and the application reference is a hash of the application id, both made by al-core.
/// Only al-core's wallet (MINTER_ROLE) can mint or close a note. Every note is held by one fixed
/// holder address (the bank) and can't be transferred: it is a record of the loan, not a tradable asset.
contract LoanNote is ERC721, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// Longest term accepted, in months (40 years).
    uint16 public constant MAX_TERM_MONTHS = 480;
    /// Highest APR accepted, in basis points (100%).
    uint16 public constant MAX_APR_BPS = 10_000;

    enum LoanType {
        Mortgage,
        Heloc
    }

    enum Status {
        None,
        Active,
        Closed
    }

    struct Note {
        bytes32 applicationRef;
        bytes32 borrowerRef;
        uint256 principalCents;
        uint16 aprBps;
        uint16 termMonths;
        LoanType loanType;
        Status status;
        uint64 mintedAt;
        uint64 closedAt;
    }

    mapping(uint256 tokenId => Note) private _notes;

    /// @notice The token minted for an application, or 0 if none has been minted.
    mapping(bytes32 applicationRef => uint256 tokenId) public tokenOfApplication;

    /// @notice The bank's address, which holds every note. Fixed at deploy, so changing the minter wallet
    /// doesn't move or strand any notes.
    address public immutable holder;

    uint256 private _nextTokenId = 1;

    event NoteMinted(
        uint256 indexed tokenId,
        bytes32 indexed applicationRef,
        bytes32 borrowerRef,
        uint256 principalCents,
        uint16 aprBps,
        uint16 termMonths,
        LoanType loanType
    );
    event NoteClosed(uint256 indexed tokenId, bytes32 indexed applicationRef);

    error AlreadyMinted(bytes32 applicationRef, uint256 tokenId);
    error InvalidNote(string reason);
    error UnknownNote(uint256 tokenId);
    error NotActive(uint256 tokenId);
    error ZeroAddress(string role);
    error NotTransferable(uint256 tokenId);

    /// @param admin can grant and revoke roles (the team's deployer wallet)
    /// @param minter al-core's wallet, the only account that can mint and close notes
    /// @param holder_ the bank's address, which holds every note
    constructor(address admin, address minter, address holder_) ERC721("AL Loan Note", "ALLN") {
        if (admin == address(0)) revert ZeroAddress("admin");
        if (minter == address(0)) revert ZeroAddress("minter");
        if (holder_ == address(0)) revert ZeroAddress("holder");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, minter);
        holder = holder_;
    }

    /// @notice Mint the note for an approved loan. The note goes to the holder (the bank), not the minter.
    /// @return tokenId the new note's id, starting at 1
    function mint(
        bytes32 applicationRef,
        bytes32 borrowerRef,
        uint256 principalCents,
        uint16 aprBps,
        uint16 termMonths,
        LoanType loanType
    ) external onlyRole(MINTER_ROLE) returns (uint256 tokenId) {
        if (applicationRef == bytes32(0)) revert InvalidNote("application reference is empty");
        if (borrowerRef == bytes32(0)) revert InvalidNote("borrower reference is empty");
        if (principalCents == 0) revert InvalidNote("principal must be above zero");
        if (aprBps > MAX_APR_BPS) revert InvalidNote("APR is above 100%");
        if (termMonths == 0 || termMonths > MAX_TERM_MONTHS) revert InvalidNote("term must be 1 to 480 months");

        uint256 existing = tokenOfApplication[applicationRef];
        if (existing != 0) revert AlreadyMinted(applicationRef, existing);

        tokenId = _nextTokenId++;
        _notes[tokenId] = Note({
            applicationRef: applicationRef,
            borrowerRef: borrowerRef,
            principalCents: principalCents,
            aprBps: aprBps,
            termMonths: termMonths,
            loanType: loanType,
            status: Status.Active,
            mintedAt: uint64(block.timestamp),
            closedAt: 0
        });
        tokenOfApplication[applicationRef] = tokenId;

        _mint(holder, tokenId);
        emit NoteMinted(tokenId, applicationRef, borrowerRef, principalCents, aprBps, termMonths, loanType);
    }

    /// @notice Mark a loan as paid off. A note can only be closed once and can't be reopened.
    function close(uint256 tokenId) external onlyRole(MINTER_ROLE) {
        Note storage note = _notes[tokenId];
        if (note.status == Status.None) revert UnknownNote(tokenId);
        if (note.status != Status.Active) revert NotActive(tokenId);
        note.status = Status.Closed;
        note.closedAt = uint64(block.timestamp);
        emit NoteClosed(tokenId, note.applicationRef);
    }

    /// @notice Every stored field of a note.
    function noteOf(uint256 tokenId) external view returns (Note memory) {
        Note memory note = _notes[tokenId];
        if (note.status == Status.None) revert UnknownNote(tokenId);
        return note;
    }

    /// @dev Every ERC-721 mint, transfer and burn passes through here. Only a mint (no previous owner) is
    /// allowed, so a note can never leave the holder, whether it is active or closed.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (_ownerOf(tokenId) != address(0)) revert NotTransferable(tokenId);
        return super._update(to, tokenId, auth);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
