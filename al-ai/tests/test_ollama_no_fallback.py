"""An unreachable Ollama fails the affordability step and never sends its prompt to a cloud model (AL-29 criterion 4).

The borrower's financial data is meant to be handled by a model we run ourselves. So when Ollama cannot be reached the step
fails and the run is saved as failed, even though Gemini and Groq keys are set and could have answered. Fake network only.
"""

import json

import test_committee as tc
from app import affordability_agent as ag
from app.llm import config

OLLAMA = config.AgentModel("ollama", "qwen3.5:9b")
CLOUD_HOSTS = ("generativelanguage", "api.groq.com", "api.mistral.ai")


class Network:
    """Records the host of every request. Ollama refuses the connection; any other host answers with a made-up reply."""

    def __init__(self):
        self.requests = []  # (url, body text)

    def __call__(self, url, headers, body, timeout):
        self.requests.append((url, body.decode()))
        if "ollama" in url or "localhost" in url or "127.0.0.1" in url:
            raise OSError("connection refused")
        raise AssertionError(f"a cloud model was called: {url}")

    def urls(self):
        return [url for url, _ in self.requests]


def test_an_unreachable_ollama_fails_the_affordability_step_and_no_cloud_model_is_called():
    net = Network()
    result = ag.run(
        ag.build_facts(
            loan=300_000, years=30, benchmark_rate=0.04, gross_annual_income=90_000, net_monthly_income=5_000,
            monthly_debts=200, monthly_living_costs=1_800, first_time_buyer=True,
        ),
        run_id="r", agent=OLLAMA, transport=net, env={**tc.ENV, "MISTRAL_API_KEY": "k"}, sleep=lambda s: None,
    )
    assert not result.ok and "could not be reached" in result.failure_reason
    assert len(result.attempts) == 3  # the first try and the two retries, all to Ollama
    assert {a["provider"] for a in result.attempts} == {"ollama"}
    assert net.urls() and all("ollama.test" in url for url in net.urls())
    assert not any(host in url for url in net.urls() for host in CLOUD_HOSTS)


def test_the_same_holds_when_no_ollama_address_is_set_and_the_default_local_one_is_unreachable():
    net = Network()
    facts = ag.build_facts(
        loan=300_000, years=30, benchmark_rate=0.04, gross_annual_income=90_000, net_monthly_income=5_000,
        monthly_debts=200, monthly_living_costs=1_800, first_time_buyer=True,
    )
    env = {"GROQ_API_KEY": "k", "GEMINI_API_KEY": "k"}  # cloud keys are set and could answer; no OLLAMA_HOST
    result = ag.run(facts, run_id="r", agent=OLLAMA, transport=net, env=env, sleep=lambda s: None)
    assert not result.ok and net.urls() and all("localhost" in url or "127.0.0.1" in url for url in net.urls())


def test_a_committee_run_with_ollama_down_is_saved_as_failed_and_the_affordability_prompt_goes_nowhere_else():
    class OllamaDown(tc.Providers):
        def __init__(self):
            super().__init__()
            self.bodies = []  # every request that went to a cloud model

        def __call__(self, url, headers, body, timeout):
            if "ollama.test" in url:
                self.calls.append(("ollama.test", json.loads(body)))
                raise OSError("connection refused")
            self.bodies.append(body.decode())
            return super().__call__(url, headers, body, timeout)

    providers = OllamaDown()
    record, _, store = tc.go(tc.MORTGAGE, providers)
    assert record["status"] == "failed" and record["failed_step"] == "affordability"
    assert record["original_recommendation"] is None and record["effective_recommendation"] is None
    assert {a["provider"] for a in record["steps"]["affordability"]["attempts"]} == {"ollama"}
    assert "generativelanguage" not in providers.hosts()  # the strategist never ran
    facts = record["steps"]["calculations"]["output"]["affordability_facts"]
    user_prompt = json.dumps(ag.build_prompt(facts))[1:-1]  # as it would appear inside a request body
    assert providers.bodies and not any(user_prompt in body for body in providers.bodies)  # the valuation agent's own call never carries it
    assert store.saved == [record]
