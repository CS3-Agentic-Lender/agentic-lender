# al-ai-roles.tf: the two IAM roles an al-ai task runs with (AL-229 criterion 2).
#
# ECS uses two roles per task, for two different jobs:
#   - the execution role is used by ECS itself, not by al-ai's code: to start the task it pulls the image
#     from ECR and reads the secrets (al-ai-secrets.tf) into environment variables, and while the task
#     runs it forwards the container's output to the log group. So "read its own secrets and write
#     logs" is this role's job.
#   - the task role is used by the code INSIDE the container: al-ai's own AWS calls. Its only one is
#     Bedrock, for the affordability agent's Qwen3 32B, so that is all this role may do.
# The container never gets the execution role, so the code can't read other secrets or pull other images.
#
# Both are made here, not in deploy/app, because the deploy role can't create roles (guardrails.tf).
# Their names start agentic-lender-app- so the deploy role may hand them to ECS (PassRole), and both
# carry the guardrails boundary.
#
# Both trust only ECS tasks in this account (ecs-trust.tf, shared with al-core-roles.tf).
#
# Costs nothing: IAM is free. (Bedrock calls are billed per token, which is pennies at our volume.)

# ---- The execution role: used by ECS to start the task ----

resource "aws_iam_role" "al_ai_execution" {
  name                 = "agentic-lender-app-al-ai-execution"
  description          = "Used by ECS to start al-ai tasks: pull its image, read its secrets, write its logs."
  assume_role_policy   = data.aws_iam_policy_document.ecs_tasks_trust.json
  permissions_boundary = aws_iam_policy.guardrails.arn
}

data "aws_iam_policy_document" "al_ai_execution" {
  # Signing in to ECR. AWS only offers this on "*"; it lets nobody pull anything on its own.
  statement {
    sid       = "SignInToEcr"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  # Pulling the image, from the al-ai registry only.
  statement {
    sid       = "PullTheAlAiImage"
    actions   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
    resources = [aws_ecr_repository.service["al-ai"].arn]
  }

  # Reading al-ai's two secrets, and no others. The secrets use AWS's own key, so no KMS permission is needed.
  statement {
    sid     = "ReadTheAlAiSecrets"
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      aws_secretsmanager_secret.al_ai_api_keys.arn,
      aws_secretsmanager_secret.al_ai_firebase_service_account.arn,
    ]
  }

  # Writing the container's output, into al-ai's log group only.
  statement {
    sid       = "WriteTheAlAiLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.al_ai.arn}:log-stream:*"]
  }
}

resource "aws_iam_role_policy" "al_ai_execution" {
  name   = "start-al-ai-tasks"
  role   = aws_iam_role.al_ai_execution.id
  policy = data.aws_iam_policy_document.al_ai_execution.json
}

# ---- The task role: used by al-ai's code while it runs ----

resource "aws_iam_role" "al_ai_task" {
  name                 = "agentic-lender-app-al-ai-task"
  description          = "Used by al-ai's code: call Qwen3 32B on Bedrock in eu-west-1. Nothing else."
  assume_role_policy   = data.aws_iam_policy_document.ecs_tasks_trust.json
  permissions_boundary = aws_iam_policy.guardrails.arn
}

data "aws_iam_policy_document" "al_ai_task" {
  # One model, in our Region. al-ai calls Bedrock's Converse API, which AWS checks as bedrock:InvokeModel.
  # The model id matches al-ai/app/llm/agents.aws.json. Foundation model ARNs have no account number.
  statement {
    sid       = "InvokeQwen3Only"
    actions   = ["bedrock:InvokeModel"]
    resources = ["arn:aws:bedrock:${var.region}::foundation-model/qwen.qwen3-32b-v1:0"]
  }
}

resource "aws_iam_role_policy" "al_ai_task" {
  name   = "call-qwen3-on-bedrock"
  role   = aws_iam_role.al_ai_task.id
  policy = data.aws_iam_policy_document.al_ai_task.json
}
