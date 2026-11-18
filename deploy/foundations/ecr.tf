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
#   - Keep the last 30: older images are deleted. Every merge to main pushes a pair, so 30 is about a week
#     of merges, and the deployed build stays pullable for a restart or `up`. (At 10 it could be gone
#     after a busy day.) al-ai is about 1.4 GB unpacked and al-core 0.4 GB, so 30 of each is roughly
#     18 GB compressed in ECR, about USD 1.80 a month.
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

resource "aws_ecr_lifecycle_policy" "keep_last_30" {
  for_each   = aws_ecr_repository.service
  repository = each.value.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the 30 newest images, delete the rest"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 30
      }
      action = { type = "expire" }
    }]
  })
}
