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
  description = "The AWS CLI profile to sign in with on the real account (the one `aws login` uses). Ignored for Floci."
  type        = string
  default     = "agentic-lender"
}

variable "region" {
  description = "The AWS Region everything goes in. Ireland, close to our users and where Bedrock serves Qwen3 32B."
  type        = string
  default     = "eu-west-1"
}

variable "github_repo" {
  description = "The only GitHub repository allowed to use the deploy role, as owner/name."
  type        = string
  default     = "CS3-Agentic-Lender/agentic-lender"
}

variable "domain" {
  description = "The domain we own. Registered in Nic's personal AWS account; its DNS zone lives here."
  type        = string
  default     = "agentic-lender.com"
}
