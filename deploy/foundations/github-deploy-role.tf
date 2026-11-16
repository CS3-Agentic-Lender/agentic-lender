# github-deploy-role.tf: lets GitHub Actions deploy, from this repo's main branch only (AL-225 criterion 2).
#
# No AWS keys are stored in GitHub. Instead it uses OIDC:
#   1. A GitHub Actions job gets a short-lived token signed by GitHub, saying which repo and branch it runs from.
#   2. The job gives that token to AWS and asks for this role.
#   3. AWS checks the signature is GitHub's (the OIDC provider below) and that the token says our repo
#      and main (the trust policy below).
#   4. If both pass, the job gets temporary keys that expire after an hour.
# A pull request, a feature branch or a fork gets a token that says something else, so AWS refuses it.
#
# Costs nothing: IAM is free.

# Tells AWS to trust tokens signed by GitHub Actions. One per account.
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"] # the "audience" GitHub's official AWS action asks for
}

# The trust policy: WHO may use the role. Only a GitHub job from our repo's main branch.
data "aws_iam_policy_document" "github_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # StringEquals, not StringLike, so no wildcard can sneak in. If a workflow job ever uses a GitHub
    # "environment", GitHub changes this value to repo:<repo>:environment:<name> and it must be added here.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repo}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name                 = "agentic-lender-github-deploy"
  description          = "Used by GitHub Actions on main to push images and run deploys. Nothing else can use it."
  assume_role_policy   = data.aws_iam_policy_document.github_trust.json
  max_session_duration = 3600 # the temporary keys last at most 1 hour
}

# WHAT the role may do. A deploy runs Terraform on deploy/app, which creates load balancers, ECS
# services and their IAM roles, so it needs wide permissions; a tight list would break each time
# deploy/app grows. The risk is kept small another way: only main can use it, keys last an hour, and
# the budget action (AL-224) attaches a deny-everything policy to this role if spending runs away.
resource "aws_iam_role_policy_attachment" "github_deploy_admin" {
  role       = aws_iam_role.github_deploy.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

# ...but never against its own guardrails. In AWS an explicit Deny always beats an Allow, even
# AdministratorAccess, so a deploy can't loosen the main-only rule above, delete this role, remove
# the state bucket or switch off the budget kill switch. Nic's own login (which runs this folder)
# isn't this role, so these stay changeable on purpose, through Terraform.
data "aws_iam_policy_document" "github_deploy_guardrails" {
  statement {
    sid    = "CannotChangeItsOwnTrustOrPermissions"
    effect = "Deny"
    actions = [
      "iam:UpdateAssumeRolePolicy", "iam:UpdateRole", "iam:DeleteRole",
      "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:AttachRolePolicy", "iam:DetachRolePolicy",
      "iam:PutRolePermissionsBoundary", "iam:DeleteRolePermissionsBoundary",
    ]
    resources = [aws_iam_role.github_deploy.arn]
  }

  statement {
    sid       = "CannotChangeWhoGitHubIs"
    effect    = "Deny"
    actions   = ["iam:*OpenIDConnectProvider*"]
    resources = [aws_iam_openid_connect_provider.github.arn]
  }

  statement {
    sid       = "CannotDeleteTheState"
    effect    = "Deny"
    actions   = ["s3:DeleteBucket", "s3:DeleteBucketPolicy", "s3:PutBucketVersioning", "s3:PutLifecycleConfiguration"]
    resources = [aws_s3_bucket.state.arn]
  }

  statement {
    sid       = "CannotTouchTheBudgetKillSwitch"
    effect    = "Deny"
    actions   = ["budgets:*"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "github_deploy_guardrails" {
  name   = "guardrails"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy_guardrails.json
}
