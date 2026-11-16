# Backend settings for practising on Floci, shared by foundations/ and app/ (tunnel open: ssh pc-aws).
bucket                      = "agentic-lender-tfstate-000000000000"
access_key                  = "test"
secret_key                  = "test"
endpoints                   = { s3 = "http://localhost:4566", sts = "http://localhost:4566" }
use_path_style              = true
skip_credentials_validation = true
skip_requesting_account_id  = true
skip_metadata_api_check     = true
