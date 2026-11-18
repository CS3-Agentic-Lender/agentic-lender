# outputs.tf: what deploy/app reports after an apply. `./deploy/al status` prints these.
#
# Costs nothing.

output "image_tag" {
  description = "The commit id that is deployed."
  value       = aws_ssm_parameter.release.insecure_value
}

output "api_url" {
  description = "The address both services answer on: /ai/* for al-ai, /core/* for al-core."
  value       = "https://${aws_route53_record.api.fqdn}"
}

output "load_balancer_dns_name" {
  description = "The load balancer's own AWS address, for testing before DNS has spread."
  value       = aws_lb.api.dns_name
}

output "public_subnet_ids" {
  description = "The two public subnets. The ECS services place their tasks here."
  value       = [for subnet in aws_subnet.public : subnet.id]
}

output "tasks_security_group_id" {
  description = "The security group every al-ai and al-core task wears: in only from the load balancer."
  value       = aws_security_group.tasks.id
}

output "target_group_arns" {
  description = "Where ECS registers each service's tasks: ai (port 5001) and core (port 5002)."
  value       = { for name, group in aws_lb_target_group.service : name => group.arn }
}

output "ecs_cluster_name" {
  description = "The ECS cluster both services run in."
  value       = aws_ecs_cluster.main.name
}

output "al_ai_service_name" {
  description = "The ECS service that keeps one al-ai task running behind /ai/*."
  value       = aws_ecs_service.al_ai.name
}
