# al-ai-secrets.tf: al-ai's API keys, its Firebase service account and its log group (AL-229 criterion 1).
#
# The keys go in Secrets Manager, not in the image or the task definition. When ECS starts an al-ai task,
# it reads them (as the execution role in al-ai-roles.tf) and hands each one to the container as an
# environment variable. So the image holds no keys, and changing a key needs no rebuild, only a redeploy.
#
# Terraform makes the secrets EMPTY: there is no aws_secretsmanager_secret_version here on purpose.
# Anything Terraform writes ends up in its state file, and the GitHub deploy role can read the state
# bucket. So Nic puts the values in once by hand (deploy/README.md, "Filling the al-ai secrets") and
# Terraform never sees them.
#
# Two secrets:
#   - agentic-lender/al-ai/api-keys: one JSON object holding GROQ_API_KEY, GEMINI_API_KEY, MISTRAL_API_KEY
#     and SERPER_API_KEY. ECS can pull each key out of it into its own environment variable.
#   - agentic-lender/al-ai/firebase-service-account: the whole service account JSON file from Firebase.
#
# The log group is here too, so `./deploy/al down` keeps the logs and the task definition only has to name it.
#
# Costs: USD 0.40 a month per secret, so USD 0.80 for both, plus USD 0.05 per 10,000 reads (one read per
# task start). Logs cost USD 0.57 per GB taken in; at our volume that's pennies.

resource "aws_secretsmanager_secret" "al_ai_api_keys" {
  name        = "agentic-lender/al-ai/api-keys"
  description = "al-ai's Groq, Gemini, Mistral and Serper keys, as one JSON object. Filled by hand, never by Terraform."

  # A deleted secret can be restored for 7 days, so a mistaken destroy isn't the end of the keys.
  # (0 would delete it at once, with no way back.)
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret" "al_ai_firebase_service_account" {
  name        = "agentic-lender/al-ai/firebase-service-account"
  description = "The Firebase service account JSON al-ai uses for Firestore. Filled by hand, never by Terraform."

  recovery_window_in_days = 7
}

# Where al-ai's container output goes. Each task writes its own "stream" inside this group.
resource "aws_cloudwatch_log_group" "al_ai" {
  name              = "/agentic-lender/al-ai"
  retention_in_days = 14 # older log lines are deleted, so the logs can't pile up a bill
}
