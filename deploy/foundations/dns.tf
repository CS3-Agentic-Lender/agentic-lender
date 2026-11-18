# dns.tf: the address book for agentic-lender.com (AL-225 criterion 3).
#
# A domain has two separate parts:
#   - the registration: who owns the name. It stays in Nic's personal AWS account and renews there.
#   - the hosted zone:  the records saying where each name points, e.g. api -> the load balancer.
#                       It lives HERE, in the team account, so Terraform can add records itself.
#
# They're joined by four name servers. After the first apply, `terraform output name_servers`
# prints them; paste them once into the personal account (Route 53 -> Registered domains ->
# agentic-lender.com -> Edit name servers). Then the internet asks this zone for our records.
# Usually live within an hour, at most two days.
#
# Costs USD 0.50 a month for the zone.

resource "aws_route53_zone" "main" {
  name    = var.domain
  comment = "agentic-lender.com, records managed by Terraform (deploy/)"

  lifecycle {
    # Deleting the zone and making a new one gives four NEW name servers, so the personal account
    # would point at nothing until someone pasted them in again. Never delete it by accident.
    prevent_destroy = true
  }
}
