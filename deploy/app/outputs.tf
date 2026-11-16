# outputs.tf: what deploy/app reports after an apply. `./deploy/al status` prints these.
#
# Costs nothing.

output "image_tag" {
  description = "The commit id that is deployed."
  value       = aws_ssm_parameter.release.insecure_value
}
