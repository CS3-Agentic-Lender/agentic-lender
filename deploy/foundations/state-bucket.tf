# state-bucket.tf: the S3 bucket that holds Terraform's state (AL-225 criterion 1).
#
# "State" is Terraform's memory: a JSON file listing every resource it built and its real AWS ID.
# On each plan Terraform compares three things: the code, the state, and what AWS really has. Lose
# the state and Terraform forgets it built anything, so it would try to build everything twice.
# Keeping it in S3 instead of on one laptop means GitHub Actions and you see the same memory.
#
# The bucket is:
#   - private:   no public access, and only HTTPS requests are allowed.
#   - encrypted: every file is encrypted at rest with S3's own keys (free, unlike a KMS key).
#   - versioned: every old copy of the state is kept, so a bad apply can be rolled back.
#   - locked:    a lock file stops two applies running at once (set in backend.tf, not here).
#   - protected: Terraform refuses to delete it (prevent_destroy), even if asked.
#
# Costs about EUR 0.01 a month: a few small files.

# Who am I signed in as? Used for the account number in the bucket name.
data "aws_caller_identity" "current" {}

locals {
  # S3 bucket names are shared by every AWS customer in the world, so ours ends with the account
  # number to make it unique.
  state_bucket_name = "agentic-lender-tfstate-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket" "state" {
  bucket = local.state_bucket_name

  lifecycle {
    prevent_destroy = true # deleting this would make Terraform forget everything it built
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256" # S3-managed keys
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket = aws_s3_bucket.state.id

  # All four switches on: nothing in this bucket can ever be made public.
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Old versions of the state are only needed for a while. After 90 days they're deleted, so the
# bucket can't slowly fill up.
resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    id     = "expire-old-state-versions"
    status = "Enabled"
    filter {} # applies to every file in the bucket

    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

# Refuse any request that isn't HTTPS, so the state never crosses the internet unencrypted.
resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "HttpsOnly"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })

  depends_on = [aws_s3_bucket_public_access_block.state] # set the public block first, then the policy
}
