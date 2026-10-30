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
