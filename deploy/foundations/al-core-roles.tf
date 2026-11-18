# al-core-roles.tf: the two IAM roles an al-core task runs with (AL-326 criterion 2).
#
# ECS uses two roles per task, for two different jobs:
#   - the execution role is used by ECS itself, not by al-core's code: to start the task it pulls the
#     image from ECR and reads the secrets (al-core-secrets.tf) into environment variables, and while the
#     task runs it forwards the container's output to the log group. So "read its own secrets and write
#     logs" is this role's job.
#   - the task role is used by the code INSIDE the container: al-core's own AWS calls. It makes none
#     (Firestore, Stripe and the testnet aren't AWS), so this role has no permissions at all.
# The container never gets the execution role, so the code can't read other secrets or pull other images.
#
# Both are made here, not in deploy/app, because the deploy role can't create roles (guardrails.tf).
# Their names start agentic-lender-app- so the deploy role may hand them to ECS (PassRole), and both
# carry the guardrails boundary. Both trust only ECS tasks in this account (ecs-trust.tf).
#
# Costs nothing: IAM is free.

# ---- The execution role: used by ECS to start the task ----

resource "aws_iam_role" "al_core_execution" {
  name                 = "agentic-lender-app-al-core-execution"
  description          = "Used by ECS to start al-core tasks: pull its image, read its secrets, write its logs."
  assume_role_policy   = data.aws_iam_policy_document.ecs_tasks_trust.json
  permissions_boundary = aws_iam_policy.guardrails.arn
}

data "aws_iam_policy_document" "al_core_execution" {
  # Signing in to ECR. AWS only offers this on "*"; it lets nobody pull anything on its own.
  statement {
    sid       = "SignInToEcr"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  # Pulling the image, from the al-core registry only.
  statement {
    sid       = "PullTheAlCoreImage"
    actions   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
    resources = [aws_ecr_repository.service["al-core"].arn]
  }

  # Reading al-core's two secrets, and no others. The secrets use AWS's own key, so no KMS permission is needed.
  statement {
    sid     = "ReadTheAlCoreSecrets"
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      aws_secretsmanager_secret.al_core_keys.arn,
      aws_secretsmanager_secret.al_core_firebase_service_account.arn,
    ]
  }

  # Writing the container's output, into al-core's log group only.
  statement {
    sid       = "WriteTheAlCoreLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.al_core.arn}:log-stream:*"]
  }
}

resource "aws_iam_role_policy" "al_core_execution" {
  name   = "start-al-core-tasks"
  role   = aws_iam_role.al_core_execution.id
  policy = data.aws_iam_policy_document.al_core_execution.json
}

# ---- The task role: used by al-core's code while it runs ----

# No policy on purpose: al-core's code makes no AWS calls today, so the role may do nothing. It exists
# so the task definition names a role of ours with the boundary on it, rather than none. If al-core ever
# needs an AWS service, its permission is added here, as a policy like al-ai's task role has, and only
# for that one thing.
resource "aws_iam_role" "al_core_task" {
  name                 = "agentic-lender-app-al-core-task"
  description          = "Used by al-core's code. al-core makes no AWS calls, so it may do nothing."
  assume_role_policy   = data.aws_iam_policy_document.ecs_tasks_trust.json
  permissions_boundary = aws_iam_policy.guardrails.arn
}
