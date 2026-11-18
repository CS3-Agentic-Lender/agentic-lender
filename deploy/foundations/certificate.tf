# certificate.tf: the HTTPS certificate for api.agentic-lender.com (AL-225 criterion 4).
#
# The load balancer needs a certificate to serve HTTPS. AWS Certificate Manager (ACM) issues one
# for free, but first it checks we really control the domain ("DNS validation"):
#   1. ACM makes up a random record name and value and says: put this in your DNS.
#   2. Terraform adds that record to our zone (dns.tf).
#   3. ACM looks it up on the internet. Found it, so we control the domain: certificate issued.
# The record stays, so ACM renews the certificate by itself every year.
#
# Step 3 only works once the name servers are pasted into the personal account (dns.tf), because
# until then the internet never asks our zone. So on the real account: apply dns.tf, paste the name
# servers, then apply this. If they're missing, the apply waits up to 45 minutes and then fails.
#
# Costs nothing: ACM public certificates are free.

resource "aws_acm_certificate" "api" {
  domain_name       = "api.${var.domain}"
  validation_method = "DNS"

  lifecycle {
    # If the certificate ever has to be replaced, make the new one before deleting the old one,
    # so the load balancer is never left without one.
    create_before_destroy = true
  }
}

# Step 2: the proof record ACM asked for, written into our zone.
resource "aws_route53_record" "api_certificate_validation" {
  # ACM returns the record(s) it wants as a list; this turns it into one record per domain name.
  for_each = {
    for option in aws_acm_certificate.api.domain_validation_options : option.domain_name => option
  }

  zone_id         = aws_route53_zone.main.zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  records         = [each.value.resource_record_value]
  ttl             = 300
  allow_overwrite = true # safe to re-run if the record is already there
}

# Step 3: wait until ACM has seen the record and issued the certificate. Nothing is created here;
# it just makes the apply finish only when the certificate is really usable.
resource "aws_acm_certificate_validation" "api" {
  certificate_arn         = aws_acm_certificate.api.arn
  validation_record_fqdns = [for record in aws_route53_record.api_certificate_validation : record.fqdn]

  timeouts {
    create = "45m"
  }
}
