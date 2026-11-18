"""The Bedrock client, used only by the AWS deployment. Tested with a fake network and made-up credentials, so nothing
reaches AWS and nothing is billed."""

import json
import logging

import pytest
from botocore.credentials import Credentials

from app.llm import clients, config, smoke

SCHEMA = {
    "type": "object",
    "properties": {"answer": {"type": "integer"}},
    "required": ["answer"],
    "additionalProperties": False,
}
MODEL = "qwen.qwen3-32b-v1:0"
SECRET = "made-up-secret-key-do-not-leak"
CREDS = Credentials("AKIDEXAMPLE", SECRET, "made-up-session-token")

# What Bedrock's Converse API sends back, trimmed to the parts we read. Qwen3 can add a reasoning block before its answer.
REPLY = {
    "output": {"message": {"role": "assistant", "content": [
        {"reasoningContent": {"reasoningText": {"text": "2 plus 2 is 4"}}},
        {"text": '{"answer": 4}'},
    ]}},
    "usage": {"inputTokens": 21, "outputTokens": 9},
    "stopReason": "end_turn",
}


class Net:
    def __init__(self, status=200, headers=None, body=None):
        self.calls, self.status, self.headers, self.body = [], status, headers or {"x-amzn-requestid": "bedrock-req-1"}, body or REPLY

    def __call__(self, url, headers, body, timeout):
        self.calls.append({"url": url, "headers": headers, "body": json.loads(body)})
        return self.status, self.headers, json.dumps(self.body).encode()


@pytest.fixture
def creds(monkeypatch):
    monkeypatch.setattr(clients, "aws_credentials", lambda: CREDS)


def ask(net, env=None):
    return clients.complete_json("bedrock", MODEL, "be brief", "what is 2+2", SCHEMA, transport=net, env=env or {})


def test_it_calls_converse_in_ireland_by_default_with_the_schema(creds):
    net = Net()
    ask(net)
    call = net.calls[0]
    assert call["url"] == "https://bedrock-runtime.eu-west-1.amazonaws.com/model/qwen.qwen3-32b-v1%3A0/converse"
    body = call["body"]
    assert body["system"] == [{"text": "be brief"}]
    assert body["messages"] == [{"role": "user", "content": [{"text": "what is 2+2"}]}]
    assert body["inferenceConfig"] == {"temperature": 0}
    json_schema = body["outputConfig"]["textFormat"]["structure"]["jsonSchema"]
    assert body["outputConfig"]["textFormat"]["type"] == "json_schema"
    assert json.loads(json_schema["schema"]) == SCHEMA


def test_aws_region_moves_the_endpoint(creds):
    net = Net()
    ask(net, env={"AWS_REGION": "eu-central-1"})
    assert net.calls[0]["url"].startswith("https://bedrock-runtime.eu-central-1.amazonaws.com/")


def test_the_request_is_signed_with_sigv4_for_bedrock(creds):
    net = Net()
    ask(net)
    headers = net.calls[0]["headers"]
    assert headers["Authorization"].startswith("AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/")
    assert "/eu-west-1/bedrock/aws4_request" in headers["Authorization"]
    assert headers["X-Amz-Security-Token"] == "made-up-session-token"
    assert "X-Amz-Date" in headers
    assert SECRET not in json.dumps(headers)  # the secret key signs the request but is never sent


def test_it_returns_the_answer_and_skips_the_reasoning_block(creds):
    result = ask(Net())
    assert result.parsed == {"answer": 4} and result.raw_reply == '{"answer": 4}'
    assert (result.provider, result.model) == ("bedrock", MODEL)
    assert (result.input_tokens, result.output_tokens, result.request_id) == (21, 9, "bedrock-req-1")


def test_no_credentials_fails_before_anything_is_sent(monkeypatch):
    monkeypatch.setattr(clients, "aws_credentials", lambda: None)
    net = Net()
    with pytest.raises(clients.MissingKey):
        ask(net)
    assert net.calls == []


def test_an_error_reply_raises_with_the_status_and_never_shows_the_secret(creds, caplog):
    net = Net(status=403, body={"message": "not authorized to perform bedrock:InvokeModel"})
    with caplog.at_level(logging.INFO, logger="al-ai.llm"), pytest.raises(clients.LlmError) as err:
        ask(net)
    assert err.value.status == 403 and "bedrock answered HTTP 403" in str(err.value)
    assert SECRET not in str(err.value) and SECRET not in caplog.text


def test_a_reply_that_breaks_the_schema_is_an_invalid_reply(creds):
    bad = {"output": {"message": {"content": [{"text": '{"answer": "four"}'}]}}, "usage": {}}
    with pytest.raises(clients.InvalidReply):
        ask(Net(body=bad))


# ---- which config file the service reads ------------------------------------------------------------------------

def test_local_runs_read_agents_json_so_affordability_stays_on_ollama():
    assert config.load(env={}).agent("affordability") == config.AgentModel("ollama", "qwen3.5:9b")


def test_the_aws_deployment_reads_agents_aws_json_and_only_affordability_changes():
    local, aws = config.load(env={}), config.load(env={config.CONFIG_ENV: "agents.aws.json"})
    assert aws.agent("affordability") == config.AgentModel("bedrock", MODEL)
    assert {k: v for k, v in aws.agents.items() if k != "affordability"} == {k: v for k, v in local.agents.items() if k != "affordability"}
    assert aws.backup == local.backup


def test_a_config_name_that_is_not_ours_is_refused():
    for name in ["../secrets.json", "/etc/agents.json", "agents.prod.json"]:
        with pytest.raises(config.ConfigError):
            config.load(env={config.CONFIG_ENV: name})


def test_smoke_skips_bedrock_when_there_are_no_aws_credentials(monkeypatch):
    monkeypatch.setattr(clients, "aws_credentials", lambda: None)
    results = smoke.run({"bedrock": MODEL}, env={}, transport=Net())
    assert results[0]["status"] == "skipped" and "AWS credentials" in results[0]["reason"]
