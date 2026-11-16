# versions.tf: which Terraform and which AWS provider this folder needs.
#
# A "provider" is the plugin that turns Terraform code into AWS API calls. Pinning its version means
# everyone (your Mac, GitHub Actions) builds with the same plugin, so a new release can't change what
# a plan does without us noticing. `terraform init` downloads it and records the exact build in
# .terraform.lock.hcl, which is committed.
#
# Costs nothing: this file creates no AWS resources.

terraform {
  # 1.10 is the first version that can lock the state with S3 alone (see state-bucket.tf).
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0" # any 6.x release, never 7.0, which could rename or remove things we use
    }
  }
}
