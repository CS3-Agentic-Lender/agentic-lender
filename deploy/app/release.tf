# release.tf: records which build is deployed.
#
# Until the load balancer and ECS tickets add the real services to this folder, this is the only
# thing in it, so the al script has something real to create, change and remove. It stays useful
# afterwards: `./deploy/al status` reads it to say which commit is live.
#
# Costs nothing: a standard SSM parameter is free.

resource "aws_ssm_parameter" "release" {
  name           = "/agentic-lender/release"
  description    = "The git commit id of the al-ai and al-core images that are deployed."
  type           = "String"
  insecure_value = var.image_tag # a commit id isn't secret, so it can be shown in plans and outputs
}
