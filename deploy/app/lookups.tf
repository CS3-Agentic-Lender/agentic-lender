# lookups.tf: finds the things deploy/foundations made, so this folder can use them.
#
# foundations made the DNS zone, the api certificate, the alarm email list, the image registry and al-ai's
# secrets, roles and log group once, by hand, and they outlive every `./deploy/al down`. This folder just looks them up by name each run. That works the
# same on Floci and AWS, and doesn't tie this folder to where foundations keeps its state.
#
# Costs nothing: lookups create no AWS resources.

# The agentic-lender.com zone (foundations/dns.tf). The api record goes in it (load-balancer.tf).
data "aws_route53_zone" "main" {
  name = var.domain
}

# The certificate for api.agentic-lender.com (foundations/certificate.tf). Only an issued one will
# do, so a run before ACM has finished checking the domain stops here with a clear error.
data "aws_acm_certificate" "api" {
  domain      = "api.${var.domain}"
  statuses    = ["ISSUED"]
  most_recent = true
}

# The alarm email list (foundations/alarm-emails.tf). Every alarm in alarms.tf sends to it.
data "aws_sns_topic" "alarms" {
  name = "agentic-lender-alarms"
}

# ---- what the al-ai service needs (ecs.tf) -------------------------------------------------------

# Where GitHub Actions pushes the al-ai images (foundations/ecr.tf).
data "aws_ecr_repository" "al_ai" {
  name = "agentic-lender/al-ai"
}

# al-ai's two secrets (foundations/al-ai-secrets.tf). Looking one up reads its name and ARN, never its value.
data "aws_secretsmanager_secret" "al_ai_api_keys" {
  name = "agentic-lender/al-ai/api-keys"
}

data "aws_secretsmanager_secret" "al_ai_firebase_service_account" {
  name = "agentic-lender/al-ai/firebase-service-account"
}

# The two roles an al-ai task runs with (foundations/al-ai-roles.tf).
data "aws_iam_role" "al_ai_execution" {
  name = "agentic-lender-app-al-ai-execution"
}

data "aws_iam_role" "al_ai_task" {
  name = "agentic-lender-app-al-ai-task"
}

# Where al-ai's output goes, kept 14 days (foundations/al-ai-secrets.tf).
data "aws_cloudwatch_log_group" "al_ai" {
  name = "/agentic-lender/al-ai"
}
