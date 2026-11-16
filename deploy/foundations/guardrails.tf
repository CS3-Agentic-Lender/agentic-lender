# guardrails.tf: the ceiling on everything the GitHub deploy role can do, and on every role it makes.
#
# A "permissions boundary" is a policy AWS checks ON TOP of a role's own permissions: an action only
# works if the role's policies allow it AND the boundary allows it. So the deploy role keeps
# AdministratorAccess for building the app, but anything this file denies stays impossible.
#
# Why a boundary and not just a deny on the deploy role: with admin, the role could create a NEW role
# without the deny, give it admin and use that instead. Here it can only create or change roles named
# agentic-lender-app-* that carry this same boundary, so every role it can reach has the same ceiling.
#
# What no role under this boundary can ever do:
#   - change the deploy role, the GitHub OIDC provider, the budget kill switch or this boundary
#   - create or change any IAM role outside agentic-lender-app-*, or one without this boundary
#   - hand any other role to a service (iam:PassRole), create IAM users or long-lived access keys
#   - delete, reconfigure or wipe the history of the Terraform state bucket
# Nic's own login runs this folder and isn't under the boundary, so all of it stays changeable on
# purpose, through Terraform.
#
# Costs nothing: IAM is free.

locals {
  account_id = data.aws_caller_identity.current.account_id

  # The only roles the deploy role may create, change or pass: the ECS task roles deploy/app makes.
  app_roles = "arn:aws:iam::${local.account_id}:role/agentic-lender-app-*"

  # Built by name, not from the resource, because the policy has to exist before anything uses it.
  guardrails_arn = "arn:aws:iam::${local.account_id}:policy/agentic-lender-guardrails"
}

data "aws_iam_policy_document" "guardrails" {
  # A boundary only takes away. Start from "everything", then the Deny statements below cut it down.
  statement {
    sid       = "EverythingExceptWhatIsDeniedBelow"
    effect    = "Allow"
    actions   = ["*"]
    resources = ["*"]
  }

  # Roles: only agentic-lender-app-* may be created, changed or deleted.
  statement {
    sid    = "OnlyAppRolesCanBeChanged"
    effect = "Deny"
    actions = [
      "iam:CreateRole", "iam:DeleteRole", "iam:UpdateRole", "iam:UpdateAssumeRolePolicy",
      "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:AttachRolePolicy", "iam:DetachRolePolicy",
      "iam:PutRolePermissionsBoundary", "iam:DeleteRolePermissionsBoundary",
      "iam:TagRole", "iam:UntagRole",
    ]
    not_resources = [local.app_roles]
  }

  # ...and only with this boundary on them, so a new role is never more powerful than the deploy role.
  statement {
    sid       = "AppRolesMustCarryThisBoundary"
    effect    = "Deny"
    actions   = ["iam:CreateRole", "iam:PutRolePermissionsBoundary", "iam:AttachRolePolicy", "iam:DetachRolePolicy", "iam:PutRolePolicy", "iam:DeleteRolePolicy"]
    resources = [local.app_roles]

    condition {
      test     = "StringNotEquals"
      variable = "iam:PermissionsBoundary"
      values   = [local.guardrails_arn]
    }
  }

  statement {
    sid       = "TheBoundaryCantBeRemoved"
    effect    = "Deny"
    actions   = ["iam:DeleteRolePermissionsBoundary"]
    resources = ["*"]
  }

  # Only app roles may be handed to a service (e.g. ECS running a task "as" that role).
  statement {
    sid           = "OnlyAppRolesCanBePassed"
    effect        = "Deny"
    actions       = ["iam:PassRole"]
    not_resources = [local.app_roles]
  }

  # No other way in: no IAM users, no long-lived keys, no changing who GitHub is or this ceiling.
  statement {
    sid    = "NoNewWaysIn"
    effect = "Deny"
    actions = [
      "iam:CreateUser", "iam:CreateAccessKey", "iam:CreateLoginProfile", "iam:UpdateLoginProfile",
      "iam:CreateOpenIDConnectProvider", "iam:DeleteOpenIDConnectProvider", "iam:UpdateOpenIDConnectProviderThumbprint",
      "iam:AddClientIDToOpenIDConnectProvider", "iam:RemoveClientIDFromOpenIDConnectProvider",
      "iam:CreateSAMLProvider", "iam:UpdateSAMLProvider",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "TheCeilingCantBeEdited"
    effect    = "Deny"
    actions   = ["iam:CreatePolicyVersion", "iam:DeletePolicy", "iam:DeletePolicyVersion", "iam:SetDefaultPolicyVersion"]
    resources = [local.guardrails_arn]
  }

  # The budget kill switch (AL-224) can't be switched off from inside.
  statement {
    sid       = "CannotTouchTheBudgetKillSwitch"
    effect    = "Deny"
    actions   = ["budgets:*"]
    resources = ["*"]
  }

  # Terraform's memory: the bucket can't be deleted, opened up or reconfigured...
  statement {
    sid    = "CannotReconfigureTheStateBucket"
    effect = "Deny"
    actions = [
      "s3:DeleteBucket", "s3:PutBucketPolicy", "s3:DeleteBucketPolicy", "s3:PutBucketVersioning",
      "s3:PutLifecycleConfiguration", "s3:PutEncryptionConfiguration", "s3:PutBucketPublicAccessBlock",
      "s3:PutBucketAcl", "s3:PutBucketOwnershipControls",
    ]
    resources = [aws_s3_bucket.state.arn]
  }

  # ...and old versions of the state can't be wiped. (Deleting the current file only adds a "deleted"
  # marker, which versioning can undo; the lock file is deleted that way after every run.)
  statement {
    sid       = "CannotWipeStateHistory"
    effect    = "Deny"
    actions   = ["s3:DeleteObjectVersion"]
    resources = ["${aws_s3_bucket.state.arn}/*"]
  }
}

resource "aws_iam_policy" "guardrails" {
  name        = "agentic-lender-guardrails"
  description = "Permissions boundary for the GitHub deploy role and every role it creates."
  policy      = data.aws_iam_policy_document.guardrails.json
}
