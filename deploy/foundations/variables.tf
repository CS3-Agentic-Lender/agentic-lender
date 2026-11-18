# variables.tf: the few settings you can change without editing the other files.
#
# Each one has a default, so a plain `terraform plan` works. Override one on the command line,
# e.g. `terraform plan -var target=floci`.
#
# Costs nothing: this file creates no AWS resources.

variable "target" {
  description = "Where to build: \"aws\" for the real team account, \"floci\" for the practice AWS on the PC."
  type        = string
  default     = "aws"

  validation {
    condition     = contains(["aws", "floci"], var.target)
    error_message = "target must be \"aws\" or \"floci\"."
  }
}

variable "aws_profile" {
  description = "The AWS CLI profile to sign in with on the real account, e.g. \"agentic-lender\". null uses AWS_PROFILE or, in GitHub Actions, the OIDC credentials. Ignored for Floci."
  type        = string
  default     = null
}

variable "team_account_id" {
  description = "The team AWS account. Terraform refuses to touch any other account on the real target."
  type        = string
  default     = "176550299403"
}

variable "region" {
  description = "The AWS Region everything goes in. Ireland, close to our users and where Bedrock serves Qwen3 32B."
  type        = string
  default     = "eu-west-1"
}

variable "github_repo" {
  description = <<-EOT
    The only GitHub repository allowed to use the deploy role, as GitHub writes it in a job's token:
    owner@owner-id/name@repo-id. Our repo uses GitHub's immutable subject, which adds the ID numbers so a
    deleted and re-created repo with the same name can't take over the role. Check it with
    `gh api repos/CS3-Agentic-Lender/agentic-lender/actions/oidc/customization/sub`.
  EOT
  type        = string
  default     = "CS3-Agentic-Lender@330450351/agentic-lender@1374486526"
}

variable "domain" {
  description = "The domain we own. Registered in Nic's personal AWS account; its DNS zone lives here."
  type        = string
  default     = "agentic-lender.com"
}
