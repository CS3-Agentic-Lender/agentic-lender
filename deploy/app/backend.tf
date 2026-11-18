# backend.tf: deploy/app keeps its state in the same bucket as foundations, under its own key, locked.
# See foundations/backend.tf for how the state and the lock work.
#
# Costs nothing beyond the bucket.

terraform {
  backend "s3" {
    key          = "app/terraform.tfstate"
    region       = "eu-west-1"
    encrypt      = true
    use_lockfile = true
  }
}
