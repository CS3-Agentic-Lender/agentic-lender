"""The team agreed on 28 Oct 2026 to run the valuation agent on Groq and drop Mistral. The docs and diagrams must say so."""

from pathlib import Path

import pytest

DOCS = Path(__file__).resolve().parents[2] / "docs"
INFRA = (DOCS / "infrastructure.md").read_text()


def test_the_infrastructure_doc_records_groq_as_the_valuation_model_and_no_longer_calls_it_provisional():
    assert "the valuation agent runs on Groq" in INFRA
    assert "Provisional" not in INFRA and "valuation agent runs on Mistral" not in INFRA
    assert "Gemini Flash-Lite" in INFRA and "made-up data" in INFRA  # the backup and the free-tier rule are both recorded


def test_the_llm_table_row_no_longer_lists_mistral_as_a_cloud_api():
    row = next(line for line in INFRA.splitlines() if line.startswith("| LLM inference"))
    assert "Mistral" not in row and "Groq" in row and "Gemini" in row


@pytest.mark.parametrize("name", [
    "api-design.md", "deployment.md", "diagrams/03-flow-submit-ai-review.mmd", "diagrams/05-committee-pipeline.mmd",
    "diagrams/01-system-overview.svg", "diagrams/03-flow-submit-ai-review.svg", "diagrams/05-committee-pipeline.svg",
    "diagrams/09-aws-architecture.drawio", "diagrams/09-aws-architecture.svg",
])
def test_no_doc_or_diagram_still_names_mistral_as_part_of_the_system(name):
    # the Bedrock options row in deployment.md lists models Bedrock offers (Mistral among them), which is not our system
    text = "\n".join(line for line in (DOCS / name).read_text().splitlines() if not line.startswith("| Affordability model"))
    assert "mistral" not in text.lower(), f"{name} still names Mistral"


def test_the_deployment_doc_says_which_ai_runs_each_agent_with_groq_for_valuation():
    row = next(line for line in (DOCS / "deployment.md").read_text().splitlines() if line.startswith("| Valuation |"))
    assert row.count("Groq") == 2 and "Gemini Flash-Lite" in row  # local and AWS columns
