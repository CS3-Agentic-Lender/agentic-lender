# providers.tf: which AWS this folder talks to, the real team account or Floci on the PC.
#
# Real account: signs in with your `aws login` profile (no access keys on the laptop).
# Floci:        sends every call to http://localhost:4566 with the fake keys test/test.
#               Open the tunnel first with `ssh pc-aws`.
#
# The switch is one variable, `target` (variables.tf). Everything else in this folder is the same
# for both, which is the point: what works on Floci is the code that runs on AWS.
#
# Costs nothing: this file creates no AWS resources.

locals {
  floci = var.target == "floci"

  # null means "use AWS's normal address", so on the real account these lines do nothing.
  floci_url = local.floci ? "http://localhost:4566" : null
}

provider "aws" {
  region = var.region

  # Real account: your profile. Floci: the fake keys it accepts.
  profile    = local.floci ? null : var.aws_profile
  access_key = local.floci ? "test" : null
  secret_key = local.floci ? "test" : null

  # Real account: stop before doing anything if the login belongs to any other account.
  allowed_account_ids = local.floci ? null : [var.team_account_id]

  # Floci isn't real AWS, so skip the checks that only real AWS can answer.
  skip_credentials_validation = local.floci
  skip_metadata_api_check     = local.floci
  skip_requesting_account_id  = local.floci
  s3_use_path_style           = local.floci # Floci serves buckets at localhost:4566/<bucket>

  # Every service this folder uses is listed here. One missing would go to real AWS by mistake.
  endpoints {
    s3      = local.floci_url
    iam     = local.floci_url
    sts     = local.floci_url
    route53 = local.floci_url
    acm     = local.floci_url
    sns     = local.floci_url
    ecr     = local.floci_url
  }

  # Stamped on every resource this folder makes, so the console and the bill can group them.
  default_tags {
    tags = {
      project    = "agentic-lender"
      stack      = "foundations"
      managed_by = "terraform"
    }
  }
}
