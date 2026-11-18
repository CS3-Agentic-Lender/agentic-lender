# al-core-secrets.tf: al-core's keys, its Firebase service account and its log group (AL-326 criterion 1).
#
# The keys go in Secrets Manager, not in the image or the task definition. When ECS starts an al-core
# task, it reads them (as the execution role in al-core-roles.tf) and hands each one to the container as
# an environment variable. So the image holds no keys, and changing a key needs no rebuild, only a redeploy.
#
# Terraform makes the secrets EMPTY: there is no aws_secretsmanager_secret_version here on purpose.
# Anything Terraform writes ends up in its state file, and the GitHub deploy role can read the state
# bucket. So Nic puts the values in by hand (deploy/README.md, "Filling the al-core secrets") and
# Terraform never sees them.
#
# Three secrets:
#   - agentic-lender/al-core/keys: one JSON object holding BORROWER_REF_SALT, STRIPE_SECRET_KEY and
#     STRIPE_WEBHOOK_SECRET. ECS can pull each one out of it into its own environment variable.
#   - agentic-lender/al-core/chain-keys: one JSON object holding CHAIN_MINTER_PRIVATE_KEY and
#     CHAIN_REGISTRAR_PRIVATE_KEY, the testnet wallet keys. They only exist after the public-testnet
#     deploy, so this one is filled later. It's its own secret because filling a secret replaces its
#     whole JSON: kept apart, filling the wallet keys can never wipe the salt or the Stripe keys.
#   - agentic-lender/al-core/firebase-service-account: the whole service account JSON file from Firebase,
#     a separate key from al-ai's. ECS hands it to the container as FIREBASE_SERVICE_ACCOUNT_JSON;
#     al-core's entrypoint (Solomon's change, in its own PR) writes it to /tmp/firebase-sa.json and
#     points GOOGLE_APPLICATION_CREDENTIALS at it.
#
# The log group is here too, so `./deploy/al down` keeps the logs and the task definition only has to name it.
#
# Costs: USD 0.40 a month per secret, so USD 1.20 for all three, plus USD 0.05 per 10,000 reads (one read per
# task start). Logs cost USD 0.57 per GB taken in; at our volume that's pennies.

resource "aws_secretsmanager_secret" "al_core_keys" {
  name        = "agentic-lender/al-core/keys"
  description = "al-core's borrower salt and Stripe keys, as one JSON object. Filled by hand, never by Terraform."

  # A deleted secret can be restored for 7 days, so a mistaken destroy isn't the end of the keys.
  # (0 would delete it at once, with no way back.)
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret" "al_core_chain_keys" {
  name        = "agentic-lender/al-core/chain-keys"
  description = "al-core's two testnet wallet keys (minter and registrar), as one JSON object. Filled by hand, never by Terraform."

  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret" "al_core_firebase_service_account" {
  name        = "agentic-lender/al-core/firebase-service-account"
  description = "The Firebase service account JSON al-core uses for Firestore and Auth. Filled by hand, never by Terraform."

  recovery_window_in_days = 7
}

# Where al-core's container output goes. Each task writes its own "stream" inside this group.
resource "aws_cloudwatch_log_group" "al_core" {
  name              = "/agentic-lender/al-core"
  retention_in_days = 14 # older log lines are deleted, so the logs can't pile up a bill
}
