"""The audit registry client (AL-172), against stand-ins for web3 and the contract so CI needs no chain.
The real contract is checked by test_chain_live.py when a local Hardhat node is running."""

import json

import pytest
from web3.exceptions import ContractLogicError, Web3Exception

from app import audit, chain
from app.chain import AuditRegistry, ChainError, NotConfigured

HASH = audit.audit_hash({"applicationId": "app-funded"})
OTHER = audit.audit_hash({"applicationId": "app-funded", "x": 1})
KEY = "0x" + "11" * 32


class Call:
    revert = None  # set to make the next build_transaction fail the way a reverting contract does

    def __init__(self, fn):
        self.fn = fn

    def call(self):
        return self.fn()

    def build_transaction(self, params):
        if Call.revert:
            raise ContractLogicError(Call.revert)
        return {"to": "registry", **params, "args": self.fn}


class Functions:
    def __init__(self, registry):
        self.registry = registry

    def recordOf(self, ref):
        self.registry.refs_read.append(ref)
        return Call(self.registry.read)

    def store(self, ref, value):
        self.registry.stored_with.append((ref, value))
        return Call((ref, value))


class FakeContract:
    """Holds at most one record, like the registry for one application."""

    def __init__(self, record=None):
        self.record = record  # (bytes32 hash, stored_at) or None
        self.refs_read, self.stored_with = [], []
        self.functions = Functions(self)

    def read(self):
        if self.record is None:
            raise ContractLogicError("UnknownApplication")
        return self.record


class FakeEth:
    def __init__(self, status=1, fail=None):
        self.status, self.fail, self.sent = status, fail, []

    def get_transaction_count(self, address, block="latest"):
        self.counted = block
        return 7

    def send_raw_transaction(self, raw):
        if self.fail:
            raise self.fail
        self.sent.append(raw)
        return bytes.fromhex("ab" * 32)

    def wait_for_transaction_receipt(self, tx_hash, timeout):
        return {"status": self.status}


class FakeAccount:
    address = "0xRegistrar"

    def sign_transaction(self, tx):
        class Signed:
            raw_transaction = b"signed"

        return Signed()


def registry(record=None, status=1, fail=None) -> AuditRegistry:
    reg = object.__new__(AuditRegistry)
    reg.account = FakeAccount()
    reg.contract = FakeContract(record)

    class W3:
        eth = FakeEth(status, fail)

    reg.w3 = W3()
    return reg


# ---- what is written ------------------------------------------------------------------------------------------------


def test_a_new_hash_is_signed_sent_and_its_transaction_hash_returned():
    reg = registry()
    stored = reg.store("app-funded", HASH)
    assert stored == chain.Stored(tx_hash="0x" + "ab" * 32, already_stored=False)
    assert reg.w3.eth.sent == [b"signed"]
    ref, value = reg.contract.stored_with[0]
    assert ref.hex() == audit.application_ref("app-funded") and value.hex() == HASH


def test_the_chain_gets_the_reference_not_the_application_id():
    reg = registry()
    reg.store("app-funded", HASH)
    assert b"app-funded" not in reg.contract.stored_with[0][0]


def test_the_same_hash_again_sends_nothing():
    reg = registry(record=(bytes.fromhex(HASH), 1793368451))
    assert reg.store("app-funded", HASH) == chain.Stored(tx_hash=None, already_stored=True)
    assert reg.w3.eth.sent == []


def test_a_different_hash_for_an_application_that_has_one_is_an_error_and_sends_nothing():
    reg = registry(record=(bytes.fromhex(HASH), 1793368451))
    with pytest.raises(ChainError, match="different audit hash"):
        reg.store("app-funded", OTHER)
    assert reg.w3.eth.sent == []


def test_the_nonce_counts_pending_transactions_so_two_close_writes_do_not_collide():
    reg = registry()
    reg.store("app-funded", HASH)
    assert reg.w3.eth.counted == "pending"


def test_a_revert_keeps_its_reason_so_the_caller_can_tell_a_missing_role_from_a_second_write():
    Call.revert = "execution reverted: AccessControlUnauthorizedAccount"
    try:
        with pytest.raises(ChainError, match="refused the audit hash: .*AccessControlUnauthorizedAccount"):
            registry().store("app-funded", HASH)
    finally:
        Call.revert = None


def test_a_very_long_revert_reason_is_cut_short():
    Call.revert = "execution reverted: " + "x" * 1000
    try:
        with pytest.raises(ChainError) as e:
            registry().store("app-funded", HASH)
        assert len(str(e.value)) < 300
    finally:
        Call.revert = None


def test_a_rejected_transaction_is_an_error():
    with pytest.raises(ChainError, match="rejected"):
        registry(status=0).store("app-funded", HASH)


def test_a_chain_that_cannot_be_reached_is_an_error_that_does_not_leak_the_wire_details():
    with pytest.raises(ChainError, match="could not be stored") as e:
        registry(fail=Web3Exception("http://secret-node: boom")).store("app-funded", HASH)
    assert "secret-node" not in str(e.value)


@pytest.mark.parametrize("bad", ["", "xyz", "ab" * 31, "ab" * 33, "0x" + "zz" * 32])
def test_a_hash_that_is_not_32_bytes_of_hex_is_refused_before_anything_is_sent(bad):
    reg = registry()
    with pytest.raises(ChainError):
        reg.store("app-funded", bad)
    assert reg.w3.eth.sent == []


def test_a_hash_with_a_0x_prefix_is_accepted():
    assert registry().store("app-funded", "0x" + HASH).tx_hash


# ---- what is read ---------------------------------------------------------------------------------------------------


def test_record_of_is_none_when_nothing_is_stored_and_the_hash_and_time_when_it_is():
    assert registry().record_of("app-funded") is None
    assert registry(record=(bytes.fromhex(HASH), 5)).record_of("app-funded") == (HASH, 5)


# ---- settings -------------------------------------------------------------------------------------------------------


def test_no_key_means_not_configured():
    with pytest.raises(NotConfigured, match="CHAIN_REGISTRAR_PRIVATE_KEY"):
        AuditRegistry.from_env({})


def test_no_address_and_no_deployment_file_means_not_configured(monkeypatch, tmp_path):
    monkeypatch.setattr(chain, "DEPLOYMENTS", tmp_path)
    with pytest.raises(NotConfigured, match="AUDIT_REGISTRY_ADDRESS"):
        AuditRegistry.from_env({"CHAIN_REGISTRAR_PRIVATE_KEY": KEY})


def test_the_address_comes_from_the_setting_or_else_from_the_deployment_file(monkeypatch, tmp_path):
    address = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"
    assert AuditRegistry.from_env({"CHAIN_REGISTRAR_PRIVATE_KEY": KEY, "AUDIT_REGISTRY_ADDRESS": address}).contract.address == address

    (tmp_path / "amoy.json").write_text(json.dumps({"AuditRegistry": {"address": address}}))
    monkeypatch.setattr(chain, "DEPLOYMENTS", tmp_path)
    assert AuditRegistry.from_env({"CHAIN_REGISTRAR_PRIVATE_KEY": KEY, "CHAIN_NETWORK": "amoy"}).contract.address == address


def test_a_deployment_file_with_no_registry_address_is_not_configured(monkeypatch, tmp_path):
    (tmp_path / "localhost.json").write_text(json.dumps({"LoanNote": {"address": "0x1"}}))
    monkeypatch.setattr(chain, "DEPLOYMENTS", tmp_path)
    with pytest.raises(NotConfigured):
        AuditRegistry.from_env({"CHAIN_REGISTRAR_PRIVATE_KEY": KEY})


def test_the_registrar_account_is_the_one_the_key_makes():
    reg = AuditRegistry.from_env({"CHAIN_REGISTRAR_PRIVATE_KEY": KEY, "AUDIT_REGISTRY_ADDRESS": "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"})
    assert reg.account.address.startswith("0x") and len(reg.account.address) == 42
