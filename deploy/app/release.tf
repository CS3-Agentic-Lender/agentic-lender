# release.tf: records which build is deployed.
#
# It was the first thing in this folder, so the al script had something real to create, change and
# remove before the load balancer arrived. It stays useful: `./deploy/al status` reads it to say which
# commit is live.
#
# Costs nothing: a standard SSM parameter is free.

# Holds the git commit id of the al-ai and al-core images that are deployed. (No description field:
# Floci drops it when the value changes, which would show up as false drift on every practice run.)
resource "aws_ssm_parameter" "release" {
  name           = "/agentic-lender/release"
  type           = "String"
  insecure_value = var.image_tag # a commit id isn't secret, so it can be shown in plans and outputs
}
