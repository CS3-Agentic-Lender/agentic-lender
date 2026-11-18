# lookups.tf: finds the things deploy/foundations made, so this folder can use them.
#
# foundations made the DNS zone, the api certificate and the alarm email list once, by hand, and they
# outlive every `./deploy/al down`. This folder just looks them up by name each run. That works the
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
