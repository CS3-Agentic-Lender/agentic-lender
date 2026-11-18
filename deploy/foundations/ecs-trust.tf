# ecs-trust.tf: who may use the ECS task roles (al-ai-roles.tf and al-core-roles.tf).
#
# Every ECS role (execution role and task role, for both services) trusts the same thing, so the trust
# policy is written once here and each role points at it.
#
# Costs nothing: IAM is free.

# WHO may use the roles: only the ECS tasks service, and only for tasks in this account. The account
# check stops another AWS customer's ECS from being tricked into using our roles (the "confused deputy").
data "aws_iam_policy_document" "ecs_tasks_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}
