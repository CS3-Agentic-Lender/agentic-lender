"""Looking up a past chain event in windows a public RPC accepts (app/chain.py find_logs and start_block).

PublicNode, Polygon Amoy's free RPC, refuses a log query over 10,000 blocks, and Amoy makes about 43,000 blocks a day, so the
three recovery lookups (the audit write's transaction, an already-minted note, an already-closed note) must never ask from
block 0. They search newest first in windows of at most MAX_LOG_BLOCKS, down to the contracts' deploy block.
"""

import json

import pytest

from app import chain
from app.chain import MAX_LOG_BLOCKS, AuditRegistry, NotConfigured, find_logs, start_block
from app.loan_notes import LoanNotes
from tests.test_chain import registry
from tests.test_loan_notes import TERMS, TX, FakeContract, notes, on_chain
from tests.test_loan_notes_close import CLOSED_AT, CLOSED_TX, CloseContract

KEY = "0x" + "11" * 32
REGISTRY = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"
LOAN_NOTE = "0x5FbDB2315678afecb367f032d93F642f64180aa3"


class Chain:
    """A chain `height` blocks long whose event was emitted in the blocks listed. Like PublicNode, it refuses a wider range."""

    def __init__(self, height, event_blocks=()):
        self.eth = type("Eth", (), {"block_number": height})()
        self.event_blocks, self.asked = list(event_blocks), []

    def get_logs(self, from_block, to_block, argument_filters):
        self.asked.append((from_block, to_block))
        if to_block - from_block + 1 > MAX_LOG_BLOCKS:
            raise OSError("exceed maximum block range: 10000")
        return [{"blockNumber": b} for b in self.event_blocks if from_block <= b <= to_block]


def windows_ok(asked, start, height):
    """Every query fits the cap, they run newest first without gaps or overlaps, and none goes below start or above height."""
    assert asked[0][1] == height
    for (lo, hi), (next_lo, next_hi) in zip(asked, asked[1:]):
        assert next_hi == lo - 1
    assert all(hi - lo + 1 <= MAX_LOG_BLOCKS and start <= lo <= hi <= height for lo, hi in asked)


# ---- the shared lookup -------------------------------------------------------------------------

def test_the_cap_is_the_one_publicnode_enforces():
    assert MAX_LOG_BLOCKS == 10_000


def test_an_old_event_is_found_by_walking_back_window_by_window():
    c = Chain(25_000, event_blocks=[3])
    assert find_logs(c, c, {"x": 1}, 0) == [{"blockNumber": 3}]
    assert c.asked == [(15_001, 25_000), (5_001, 15_000), (0, 5_000)]
    windows_ok(c.asked, 0, 25_000)


def test_a_recent_event_is_found_in_the_newest_window_alone():
    c = Chain(1_000_000, event_blocks=[999_950, 3])
    assert find_logs(c, c, {}, 0) == [{"blockNumber": 999_950}]
    assert c.asked == [(990_001, 1_000_000)]


def test_a_miss_walks_down_to_the_start_block_and_never_below():
    c = Chain(60_000, event_blocks=[100])  # before the start block, so it must not be found
    assert find_logs(c, c, {}, 30_000) == []
    assert c.asked[-1][0] == 30_000 and min(lo for lo, _ in c.asked) == 30_000
    windows_ok(c.asked, 30_000, 60_000)


def test_a_start_block_above_the_chain_asks_nothing():
    c = Chain(100)
    assert find_logs(c, c, {}, 101) == [] and c.asked == []


def test_a_one_block_chain_from_zero_is_one_query():
    c = Chain(0, event_blocks=[0])
    assert find_logs(c, c, {}, 0) == [{"blockNumber": 0}] and c.asked == [(0, 0)]


# ---- where the search stops --------------------------------------------------------------------

def test_the_setting_wins_over_the_deployment_file(tmp_path, monkeypatch):
    monkeypatch.setattr(chain, "DEPLOYMENTS", tmp_path)
    (tmp_path / "amoy.json").write_text(json.dumps({"deployBlock": 5}))
    assert start_block({"CHAIN_START_BLOCK": "53619738"}, "amoy") == 53619738


def test_without_the_setting_the_deployment_files_deploy_block_is_used(tmp_path, monkeypatch):
    monkeypatch.setattr(chain, "DEPLOYMENTS", tmp_path)
    (tmp_path / "amoy.json").write_text(json.dumps({"deployBlock": 53619738}))
    assert start_block({}, "amoy") == 53619738
    assert start_block({"CHAIN_START_BLOCK": ""}, "amoy") == 53619738  # empty, as .env.example has, means unset


@pytest.mark.parametrize("file", [None, {}, "not json"])
def test_with_neither_it_is_zero_as_on_a_local_chain(tmp_path, monkeypatch, file):
    monkeypatch.setattr(chain, "DEPLOYMENTS", tmp_path)
    if file is not None:
        (tmp_path / "localhost.json").write_text(file if isinstance(file, str) else json.dumps(file))
    assert start_block({}, "localhost") == 0


@pytest.mark.parametrize("bad", ["-1", "12.5", "latest", "0x10"])
def test_a_setting_that_is_not_a_block_number_is_refused(bad):
    with pytest.raises(NotConfigured, match="CHAIN_START_BLOCK"):
        start_block({"CHAIN_START_BLOCK": bad}, "amoy")


def test_the_committed_amoy_record_holds_the_real_deploy_block():
    record = json.loads((chain.DEPLOYMENTS / "amoy.json").read_text())
    assert record["deployBlock"] == 53619738  # LoanNote's creation block; AuditRegistry followed in 53619740
    assert start_block({}, "amoy") == 53619738


def test_both_clients_take_the_start_block_from_the_settings():
    env = {"CHAIN_START_BLOCK": "53619738", "CHAIN_NETWORK": "amoy"}
    assert AuditRegistry.from_env({**env, "CHAIN_REGISTRAR_PRIVATE_KEY": KEY, "AUDIT_REGISTRY_ADDRESS": REGISTRY}).start_block == 53619738
    assert LoanNotes.from_env({**env, "CHAIN_MINTER_PRIVATE_KEY": KEY, "LOAN_NOTE_ADDRESS": LOAN_NOTE}).start_block == 53619738


# ---- the three recovery paths on a long chain ---------------------------------------------------

HEIGHT, START = 53_700_000, 53_619_738


def test_the_audit_writes_transaction_is_looked_up_in_capped_windows_down_to_the_start():
    reg = registry()
    reg.w3.eth.block_number, reg.start_block = HEIGHT, START
    assert reg.tx_of("app-funded") is None  # no event: it walks every window, then gives up as before
    asked = [(lo, hi) for lo, hi, _ in reg.contract.log_filters]
    windows_ok(asked, START, HEIGHT)
    assert asked[-1][0] == START


def test_an_already_minted_note_is_found_in_the_newest_window():
    contract = FakeContract(token=5, note=on_chain(), logs=[{"transactionHash": bytes.fromhex(TX)}])
    client = notes(contract)
    client.w3.eth.block_number, client.start_block = HEIGHT, START
    assert client.mint("app-approved", TERMS).already_minted
    assert contract.ranges_asked == [(HEIGHT - MAX_LOG_BLOCKS + 1, HEIGHT)]


def test_an_already_closed_note_is_found_in_the_newest_window():
    contract = CloseContract(status=2, closed_at=CLOSED_AT, logs=[{"transactionHash": bytes.fromhex(CLOSED_TX)}])
    client = notes(contract)
    client.w3.eth.block_number, client.start_block = HEIGHT, START
    assert client.close("app-funded").already_closed
    assert contract.ranges_asked == [(HEIGHT - MAX_LOG_BLOCKS + 1, HEIGHT)]
