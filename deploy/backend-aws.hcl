# Backend settings for the real team account, shared by foundations/ and app/.
# The bucket name holds the account number, so it's passed at init (the al script does this):
#   -backend-config="bucket=$(terraform -chdir=foundations output -raw state_bucket)"
profile = "agentic-lender"
