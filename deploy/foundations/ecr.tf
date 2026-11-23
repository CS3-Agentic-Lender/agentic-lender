# ecr.tf: the two image registries, one per service (AL-227 criterion 1).
#
# GitHub Actions (.github/workflows/images.yml) pushes an ARM64 image to each on every merge to main,
# tagged with the commit id. deploy/app's ECS services pull them by that tag.
#
# They live here, not in deploy/app, so `./deploy/al down` keeps them and `up` can start the last build
# again without a rebuild.
#
#   - Scan on push: ECR's basic scan checks each new image for known CVEs. It reports, it doesn't block.
#   - Immutable tags: a commit id always means the same image, so nobody can quietly swap what's deployed.
#   - Keep 90 days: an image is deleted 90 days after it was pushed, however many merges came since.
#     So a build deployed now can still be pulled by `up` for the demo on 4 Jan 2027. (A count limit
#     can't promise that: a busy fortnight of merges could push the deployed build out of 30.)
#     An image is about 310 MB compressed for al-ai and 100 MB for al-core, but images share all but
#     their last few layers, and ECR stores a shared layer once, so each merge adds only a few MB.
#
# Costs: USD 0.10 per GB a month for what's stored. Pulls from inside eu-west-1 are free.

locals {
  services = ["al-ai", "al-core"]
}

resource "aws_ecr_repository" "service" {
  for_each = toset(local.services)

  name                 = "agentic-lender/${each.key}"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  # AES256 is ECR's default and free. (KMS would add a key at USD 1 a month for nothing we need.)
  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "keep_90_days" {
  for_each   = aws_ecr_repository.service
  repository = each.value.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Delete images 90 days after they were pushed"
      selection = {
        tagStatus   = "any"
        countType   = "sinceImagePushed"
        countUnit   = "days"
        countNumber = 90
      }
      action = { type = "expire" }
    }]
  })
}

moved {
  from = aws_ecr_lifecycle_policy.keep_last_30
  to   = aws_ecr_lifecycle_policy.keep_90_days
}
