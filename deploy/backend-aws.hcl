# Backend settings for the real team account, shared by foundations/ and app/.
# The bucket name holds the account number, so it's passed at init (deploy/al does this for app/):
#   -backend-config="bucket=agentic-lender-tfstate-<account number>"
# Sign-in comes from the environment: AWS_PROFILE=agentic-lender on a laptop, OIDC in GitHub Actions.
# This file has to set at least one value, so it pins the region here too.
region = "eu-west-1"
