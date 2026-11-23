# github-images-role.tf: lets GitHub Actions push the al-ai and al-core images, and nothing else.
#
# The Images workflow (.github/workflows/images.yml) runs on every merge to main. It used to sign in as
# the deploy role, which has AdministratorAccess, so every image build held the keys to the account.
# This role can only push to the two registries in ecr.tf.
#
# It trusts exactly who the deploy role trusts (github-deploy-role.tf): a GitHub job from this repo's
# main branch. It reuses that trust policy, so tightening one tightens both.
#
# Costs nothing: IAM is free.

resource "aws_iam_role" "github_images" {
  name                 = "agentic-lender-github-images"
  description          = "Used by GitHub Actions on main to push the al-ai and al-core images to ECR. Nothing else."
  assume_role_policy   = data.aws_iam_policy_document.github_trust.json
  max_session_duration = 3600 # the temporary keys last at most 1 hour
}

data "aws_iam_policy_document" "github_images" {
  # Signing Docker in to ECR. AWS only accepts "*" for this action; the token alone reaches nothing.
  statement {
    sid       = "SignInToEcr"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  # A docker push to the two registries. No delete: tags are immutable and old images expire on their own.
  statement {
    sid = "PushToTheTwoRegistries"
    actions = [
      "ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload", "ecr:PutImage", "ecr:BatchGetImage",
    ]
    resources = [for repo in aws_ecr_repository.service : repo.arn]
  }
}

resource "aws_iam_role_policy" "github_images" {
  name   = "push-images"
  role   = aws_iam_role.github_images.id
  policy = data.aws_iam_policy_document.github_images.json
}
