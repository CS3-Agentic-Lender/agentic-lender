# backend.tf: keep Terraform's state in the S3 bucket from state-bucket.tf, locked (AL-225 criterion 1).
#
# The chicken and egg: this bucket has to exist before Terraform can keep its state in it, so the
# very first apply runs with the state on the laptop. Then, once:
#     terraform init -migrate-state -backend-config=../backend-aws.hcl -backend-config="bucket=<state_bucket output>"
# copies it up, and from then on every run reads and writes it in S3.
#
# The settings that differ between real AWS and Floci (which bucket, how to sign in, where S3 is)
# live in deploy/backend-aws.hcl and deploy/backend-floci.hcl (shared with deploy/app), because a backend block can't use variables.
#
# Costs nothing beyond the bucket.

terraform {
  backend "s3" {
    key     = "foundations/terraform.tfstate" # deploy/app will use app/terraform.tfstate in the same bucket
    region  = "eu-west-1"
    encrypt = true # the state file is encrypted in S3 (the bucket does this too; belt and braces)

    # The lock: while a plan or apply runs, Terraform writes foundations/terraform.tfstate.tflock next
    # to the state and deletes it at the end. A second run that finds it waits or stops, so two
    # applies can never overwrite each other. (Terraform 1.10+; older setups needed a DynamoDB table.)
    use_lockfile = true
  }
}
