# variables.tf: the settings for deploy/app. The al script sets target and image_tag for you.
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
  description = "The AWS Region everything goes in."
  type        = string
  default     = "eu-west-1"
}

variable "image_tag" {
  description = "Which build to run: the git commit id GitHub Actions tagged the al-ai and al-core images with."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{7,40}$", var.image_tag))
    error_message = "image_tag must be a git commit id (7 to 40 hex characters), e.g. 3166a3b."
  }
}

variable "domain" {
  description = "The domain we own. Its zone and the api certificate are made in deploy/foundations; this folder looks them up by this name."
  type        = string
  default     = "agentic-lender.com"
}
