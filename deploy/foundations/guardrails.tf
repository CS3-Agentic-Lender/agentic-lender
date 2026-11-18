# guardrails.tf: the ceiling on everything the GitHub deploy role can do, and on every role it makes.
#
# A "permissions boundary" is a policy AWS checks ON TOP of a role's own permissions: an action only
# works if the role's policies allow it AND the boundary allows it. So the deploy role keeps
# AdministratorAccess for building the app, but anything this file denies stays impossible.
#
# Why a boundary and not just a deny on the deploy role: a boundary also stops the role handing its
# work to something more powerful (a new role, another service's role). So it can't make roles at all,
# and can only pass the app roles made in foundations to the services that run the app.
#
# What no role under this boundary can ever do:
#   - change the deploy role, the GitHub OIDC provider, the budget kill switch or this boundary
#   - create or change any IAM role or policy (app roles are made in foundations, by Nic)
#   - hand any role but agentic-lender-app-* to a service (iam:PassRole), create IAM users or access keys
#   - use CloudFormation, CodeBuild or SSM Run Command, which run things as their own role
#   - delete, reconfigure or wipe the history of the Terraform state bucket, or write foundations' state
#   - delete the image registries or change their scan, tag and clean-up settings (pushing is fine)
#   - read, change or delete any agentic-lender/* secret, except that al-ai's execution role reads al-ai's
#     and al-core's execution role reads al-core's
# Nic's own login runs this folder and isn't under the boundary, so all of it stays changeable on
# purpose, through Terraform.
#
# Costs nothing: IAM is free.

locals {
  account_id = data.aws_caller_identity.current.account_id

  # The only roles and Lambda functions the deploy role may use: the app's, which all start
  # agentic-lender-app-.
  app_roles     = "arn:aws:iam::${local.account_id}:role/agentic-lender-app-*"
  app_functions = "arn:aws:lambda:*:${local.account_id}:function:agentic-lender-app-*"

  # The two execution roles (al-ai-roles.tf, al-core-roles.tf), written out as text rather than pointing
  # at the roles: each role points at this boundary, so pointing back would make a loop Terraform can't order.
  al_ai_execution_role   = "arn:aws:iam::${local.account_id}:role/agentic-lender-app-al-ai-execution"
  al_core_execution_role = "arn:aws:iam::${local.account_id}:role/agentic-lender-app-al-core-execution"

  # Where the secrets live (al-ai-secrets.tf, al-core-secrets.tf). The * at the end matters: AWS adds
  # 6 random characters to every secret's ARN. The Region is * too (see the secret statements below).
  secrets_arn = "arn:aws:secretsmanager:*:${local.account_id}:secret:agentic-lender"

  # Everything that reads, changes, deletes, opens up or copies a secret. DescribeSecret isn't here:
  # it shows a secret's name and details, never its value.
  secret_actions = [
    "secretsmanager:GetSecretValue", "secretsmanager:PutSecretValue", "secretsmanager:UpdateSecret",
    "secretsmanager:UpdateSecretVersionStage", "secretsmanager:DeleteSecret", "secretsmanager:RestoreSecret",
    "secretsmanager:PutResourcePolicy", "secretsmanager:DeleteResourcePolicy", "secretsmanager:RotateSecret",
    "secretsmanager:ReplicateSecretToRegions", "secretsmanager:RemoveRegionsFromReplication",
    "secretsmanager:StopReplicationToReplica",
  ]
}

data "aws_iam_policy_document" "guardrails" {
  # A boundary only takes away. Start from "everything", then the Deny statements below cut it down.
  statement {
    sid       = "EverythingExceptWhatIsDeniedBelow"
    effect    = "Allow"
    actions   = ["*"]
    resources = ["*"]
  }

  # Roles and policies: the deploy role can't create or change any. A role's trust (who may use it)
  # can't be checked by a boundary, so a role made from inside could trust an outsider and become a
  # back door. App roles (e.g. an ECS task role) are made in foundations instead, by Nic, and the deploy
  # role may only hand them to a service (PassRole, below). Service-linked roles, which AWS makes itself
  # the first time ECS or a load balancer is used, are still allowed.
  statement {
    sid    = "RolesAndPoliciesAreMadeInFoundations"
    effect = "Deny"
    actions = [
      "iam:CreateRole", "iam:DeleteRole", "iam:UpdateRole", "iam:UpdateRoleDescription", "iam:UpdateAssumeRolePolicy",
      "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:AttachRolePolicy", "iam:DetachRolePolicy",
      "iam:PutRolePermissionsBoundary", "iam:DeleteRolePermissionsBoundary", "iam:TagRole", "iam:UntagRole",
      "iam:CreatePolicy", "iam:CreatePolicyVersion", "iam:DeletePolicy", "iam:DeletePolicyVersion",
      "iam:SetDefaultPolicyVersion", "iam:TagPolicy", "iam:UntagPolicy",
      "iam:CreateInstanceProfile", "iam:DeleteInstanceProfile", "iam:AddRoleToInstanceProfile", "iam:RemoveRoleFromInstanceProfile",
    ]
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

  # People: IAM users and groups (like Nic's own login) can't be changed from inside at all.
  statement {
    sid    = "UsersAndGroupsCantBeChanged"
    effect = "Deny"
    actions = [
      "iam:AttachUserPolicy", "iam:DetachUserPolicy", "iam:PutUserPolicy", "iam:DeleteUserPolicy",
      "iam:PutUserPermissionsBoundary", "iam:DeleteUserPermissionsBoundary", "iam:AddUserToGroup",
      "iam:RemoveUserFromGroup", "iam:DeleteUser", "iam:UpdateUser", "iam:CreateGroup", "iam:DeleteGroup",
      "iam:AttachGroupPolicy", "iam:DetachGroupPolicy", "iam:PutGroupPolicy", "iam:DeleteGroupPolicy",
      "iam:UpdateGroup", "iam:DeactivateMFADevice", "iam:DeleteVirtualMFADevice",
    ]
    resources = ["*"]
  }

  # No stepping into another role. (GitHub's own sign-in is AssumeRoleWithWebIdentity, which this
  # doesn't cover, and ECS uses roles on its own behalf, not through this role.)
  statement {
    sid       = "NoAssumingOtherRoles"
    effect    = "Deny"
    actions   = ["sts:AssumeRole"]
    resources = ["*"]
  }

  # Lambda: a function runs as its own role, so changing or calling someone else's function would
  # borrow that role's powers. Only app functions (whose roles carry this boundary) may be touched.
  statement {
    sid           = "OnlyAppFunctions"
    effect        = "Deny"
    actions       = ["lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration", "lambda:InvokeFunction", "lambda:CreateFunction", "lambda:AddPermission"]
    not_resources = [local.app_functions]
  }

  # Services that run things as their OWN role, which would side-step this ceiling: CloudFormation
  # stacks and CodeBuild projects keep their role, and SSM Run Command runs as the machine's role.
  # We use none of them, so they're shut off.
  statement {
    sid       = "NoServicesThatRunAsTheirOwnRole"
    effect    = "Deny"
    actions   = ["cloudformation:*", "codebuild:*", "ssm:SendCommand", "ssm:StartAutomationExecution"]
    resources = ["*"]
  }

  # The image registries (ecr.tf): the deploy role pushes images to them, but can't delete them or their images,
  # open them up, or turn off the scan, the immutable tags or the clean-up rule.
  statement {
    sid    = "CannotReconfigureTheImageRegistries"
    effect = "Deny"
    actions = [
      "ecr:DeleteRepository", "ecr:BatchDeleteImage", "ecr:SetRepositoryPolicy", "ecr:DeleteRepositoryPolicy",
      "ecr:PutImageTagMutability", "ecr:PutImageScanningConfiguration",
      "ecr:PutLifecyclePolicy", "ecr:DeleteLifecyclePolicy",
    ]
    resources = [for repo in aws_ecr_repository.service : repo.arn]
  }

  # The secrets (al-ai-secrets.tf, al-core-secrets.tf): each service's secrets may be read only by that
  # service's execution role, when ECS starts a task. The deploy role, the task roles and any other app
  # role can't read, overwrite, delete or open up any of them. They may still look at a secret's name and
  # details (DescribeSecret), which shows no value. Copying a secret to another Region is denied, so a
  # copy elsewhere can't be read either. Nic's login and Terraform aren't under this boundary, so he can
  # still fill and manage them.
  # What this can't stop: the deploy role deploys al-ai and al-core, so it could start a task that prints
  # the keys ECS hands it. Anyone who can deploy the app is trusted with its keys; this blocks every direct way.
  #
  # Three statements, each "deny, unless it's the owner": al-ai's secrets unless al-ai's execution role,
  # al-core's unless al-core's, and anything else under agentic-lender/ (a future secret) unless one of
  # the two. ArnNotEquals with two values means "not equal to either", so the last one blocks everyone else.
  statement {
    sid       = "OnlyAlAiExecutionRoleReadsAlAiSecrets"
    effect    = "Deny"
    actions   = local.secret_actions
    resources = ["${local.secrets_arn}/al-ai/*"]

    condition {
      test     = "ArnNotEquals"
      variable = "aws:PrincipalArn"
      values   = [local.al_ai_execution_role]
    }
  }

  statement {
    sid       = "OnlyAlCoreExecutionRoleReadsAlCoreSecrets"
    effect    = "Deny"
    actions   = local.secret_actions
    resources = ["${local.secrets_arn}/al-core/*"]

    condition {
      test     = "ArnNotEquals"
      variable = "aws:PrincipalArn"
      values   = [local.al_core_execution_role]
    }
  }

  statement {
    sid       = "NoOtherRoleReadsAnySecret"
    effect    = "Deny"
    actions   = local.secret_actions
    resources = ["${local.secrets_arn}/*"]

    condition {
      test     = "ArnNotEquals"
      variable = "aws:PrincipalArn"
      values   = [local.al_ai_execution_role, local.al_core_execution_role]
    }
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

  # ...and foundations' own state (and its lock) is Nic's alone: the deploy role only runs deploy/app,
  # so it may write app/ and nothing under foundations/.
  statement {
    sid       = "FoundationsStateIsReadOnly"
    effect    = "Deny"
    actions   = ["s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.state.arn}/foundations/*"]
  }
}

resource "aws_iam_policy" "guardrails" {
  name        = "agentic-lender-guardrails"
  description = "Permissions boundary for the GitHub deploy role and every role it creates."
  policy      = data.aws_iam_policy_document.guardrails.json
}
