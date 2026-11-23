# outputs.tf: values this folder prints after an apply (`terraform output`), for people and for deploy/app.
#
# Costs nothing.

output "state_bucket" {
  description = "Bucket holding Terraform state. Used by backend.tf in both folders."
  value       = aws_s3_bucket.state.bucket
}

output "github_deploy_role_arn" {
  description = "Paste into the GitHub Actions workflow as role-to-assume."
  value       = aws_iam_role.github_deploy.arn
}

output "name_servers" {
  description = "Paste these four into the domain's name servers in the personal AWS account, once."
  value       = aws_route53_zone.main.name_servers
}

output "zone_id" {
  description = "The hosted zone's ID, used by deploy/app to add the api record."
  value       = aws_route53_zone.main.zone_id
}

output "api_certificate_arn" {
  description = "The validated certificate for api.agentic-lender.com, used by the load balancer in deploy/app."
  value       = aws_acm_certificate_validation.api.certificate_arn
}

output "guardrails_boundary_arn" {
  description = "deploy/app sets this as permissions_boundary on every IAM role it creates (named agentic-lender-app-*)."
  value       = aws_iam_policy.guardrails.arn
}

output "alarm_topic_arn" {
  description = "The SNS topic the alarms in deploy/app email through. deploy/app finds it by name."
  value       = aws_sns_topic.alarms.arn
}

output "image_repositories" {
  description = "Where each service's images are pushed and pulled, e.g. <account>.dkr.ecr.eu-west-1.amazonaws.com/agentic-lender/al-ai."
  value       = { for name, repo in aws_ecr_repository.service : name => repo.repository_url }
}

output "al_ai_execution_role_arn" {
  description = "The role ECS uses to start al-ai tasks (pull the image, read the secrets, write logs). The task definition's execution_role_arn."
  value       = aws_iam_role.al_ai_execution.arn
}

output "al_ai_task_role_arn" {
  description = "The role al-ai's code runs as (Qwen3 32B on Bedrock only). The task definition's task_role_arn."
  value       = aws_iam_role.al_ai_task.arn
}

output "al_ai_api_keys_secret_arn" {
  description = "The secret holding al-ai's Groq, Gemini, Mistral and Serper keys as JSON. The task definition pulls each key with <arn>:<KEY_NAME>::."
  value       = aws_secretsmanager_secret.al_ai_api_keys.arn
}

output "al_ai_firebase_secret_arn" {
  description = "The secret holding al-ai's Firebase service account JSON."
  value       = aws_secretsmanager_secret.al_ai_firebase_service_account.arn
}

output "al_ai_log_group" {
  description = "The CloudWatch log group al-ai's tasks write to, kept 14 days."
  value       = aws_cloudwatch_log_group.al_ai.name
}

output "al_core_execution_role_arn" {
  description = "The role ECS uses to start al-core tasks (pull the image, read the secrets, write logs). The task definition's execution_role_arn."
  value       = aws_iam_role.al_core_execution.arn
}

output "al_core_task_role_arn" {
  description = "The role al-core's code runs as (no permissions: al-core makes no AWS calls). The task definition's task_role_arn."
  value       = aws_iam_role.al_core_task.arn
}

output "al_core_keys_secret_arn" {
  description = "The secret holding al-core's salt and Stripe keys as JSON. The task definition pulls each key with <arn>:<KEY_NAME>::."
  value       = aws_secretsmanager_secret.al_core_keys.arn
}

output "al_core_chain_keys_secret_arn" {
  description = "The secret holding al-core's two testnet wallet keys as JSON. The task definition pulls each key with <arn>:<KEY_NAME>::."
  value       = aws_secretsmanager_secret.al_core_chain_keys.arn
}

output "al_core_firebase_secret_arn" {
  description = "The secret holding al-core's Firebase service account JSON, handed to the container as FIREBASE_SERVICE_ACCOUNT_JSON."
  value       = aws_secretsmanager_secret.al_core_firebase_service_account.arn
}

output "al_core_log_group" {
  description = "The CloudWatch log group al-core's tasks write to, kept 14 days."
  value       = aws_cloudwatch_log_group.al_core.name
}

output "portal_app_id" {
  description = "The portal's Amplify app id, for the console and the CLI. The Portal workflow finds it by the app's name. null on Floci."
  value       = one(aws_amplify_app.portal[*].id)
}

output "portal_default_url" {
  description = "Amplify's own address for the portal, which works before agentic-lender.com does. null on Floci."
  value       = one([for app in aws_amplify_app.portal : "https://main.${app.default_domain}"])
}

output "github_portal_role_arn" {
  description = "The role the Portal workflow uploads with. Its name is fixed, so the workflow writes it out. null on Floci."
  value       = one(aws_iam_role.github_portal[*].arn)
}
