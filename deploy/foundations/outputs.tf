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
