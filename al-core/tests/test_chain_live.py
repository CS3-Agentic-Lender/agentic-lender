"""The audit registry client against a real contract (AL-172). Skipped unless CHAIN_LIVE_TEST=1 and a local Hardhat node is up:

    cd chain && npx hardhat node          (one terminal; it prints the test accounts and their keys)
    cd chain && npm run deploy:local      (another; writes chain/deployments/localhost.json)
    CHAIN_LIVE_TEST=1 CHAIN_REGISTRAR_PRIVATE_KEY=<account #0's key from the node> uv run pytest tests/test_chain_live.py
"""

import os
import uuid

import pytest

from app import audit
from app.chain import AuditRegistry, ChainError

pytestmark = pytest.mark.skipif(os.getenv("CHAIN_LIVE_TEST") != "1", reason="needs a local Hardhat node, see the module docstring")


def test_a_hash_is_stored_once_read_back_and_never_replaced():
    registry = AuditRegistry.from_env()
    application_id = f"live-{uuid.uuid4()}"
    first = audit.audit_hash({"applicationId": application_id, "n": 1})
    second = audit.audit_hash({"applicationId": application_id, "n": 2})

    assert registry.record_of(application_id) is None
    stored = registry.store(application_id, first)
    assert stored.tx_hash and not stored.already_stored
    assert registry.record_of(application_id)[0] == first

    again = registry.store(application_id, first)
    assert again.already_stored and again.tx_hash is None
    with pytest.raises(ChainError, match="different audit hash"):
        registry.store(application_id, second)
    assert registry.record_of(application_id)[0] == first


def test_a_loan_note_is_minted_once_and_found_again_with_its_transaction():
    from app.loan_notes import LoanNotes, NoteTerms, borrower_ref

    notes = LoanNotes.from_env()
    application_id = f"live-{uuid.uuid4()}"
    terms = NoteTerms(27_000_000, 425, 360, "mortgage", borrower_ref("borrower1", "live-salt"))

    first = notes.mint(application_id, terms)
    assert first.token_id >= 1 and not first.already_minted
    assert first.contract_address == notes.address and first.tx_hash.startswith("0x")

    again = notes.mint(application_id, terms)
    assert again.already_minted and (again.token_id, again.tx_hash) == (first.token_id, first.tx_hash)

    other = NoteTerms(27_000_100, 425, 360, "mortgage", terms.borrower_ref)
    with pytest.raises(ChainError, match="different terms"):
        notes.mint(application_id, other)


def test_a_wallet_without_the_minter_role_is_refused_with_the_reason(monkeypatch):
    from app.loan_notes import LoanNotes, NoteTerms, borrower_ref

    stranger = os.getenv("CHAIN_LIVE_STRANGER_KEY")
    if not stranger:
        pytest.skip("set CHAIN_LIVE_STRANGER_KEY to a funded account that is not the minter")
    notes = LoanNotes.from_env({**os.environ, "CHAIN_MINTER_PRIVATE_KEY": stranger})
    terms = NoteTerms(1_000_000, 400, 120, "heloc", borrower_ref("borrower1", "live-salt"))
    with pytest.raises(ChainError, match="refused the loan note: .*AccessControlUnauthorizedAccount"):
        notes.mint(f"live-{uuid.uuid4()}", terms)
