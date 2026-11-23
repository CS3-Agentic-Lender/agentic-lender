# portal.tf: serves the broker and underwriter portal (al-web) at https://agentic-lender.com (AL-328).
#
# AWS Amplify Hosting keeps the built site and serves it through its own CloudFront, with an HTTPS
# certificate it issues and renews itself. The app has no Git connection ("deploy without Git"):
# Amplify never builds anything and holds no GitHub token. The Portal workflow
# (.github/workflows/portal.yml) builds al-web on GitHub and uploads the zip, signed in as the role in
# github-portal-role.tf.
#
# The domain: our zone (dns.tf) is in this account, so Amplify writes its own Route 53 records into it:
# the certificate's proof record and the agentic-lender.com and www records that point at its
# CloudFront ("If you host your domain with Route 53, verification is done automatically on your
# behalf", Amplify User Guide, Understanding DNS terminology and concepts). So no aws_route53_record
# here. The apply waits until Amplify has seen its proof record; issuing the certificate and going
# live can take longer after that (up to 24 hours, the guide says, usually minutes).
#
# Floci has no Amplify, so on the Floci target nothing in this file (or github-portal-role.tf) is made.
#
# Not billed by the hour, so `down` leaves it alone. Amplify charges USD 0.023 per GB stored a month and
# USD 0.15 per GB served (AWS Amplify pricing page), and per build minute, which we never use because
# GitHub builds the site. One build is about 1 MB, so demo traffic costs pennies a month.

locals {
  # 1 on the real account, 0 on Floci.
  portal_count = local.floci ? 0 : 1

  # Where Firebase Auth's hidden helper frame lives: the hosted project's authDomain (docs/infrastructure.md).
  firebase_auth_domain = "agentic-lender-a0f1c.firebaseapp.com"

  # Content-Security-Policy: what the page may load, and from where. Everything else is refused.
  # Taken from what the production build actually loads (grep of al-web/dist):
  portal_csp = join("; ", [
    "default-src 'self'",
    # Our bundle, plus Google's loader Firebase Auth uses for its helper frame.
    "script-src 'self' https://apis.google.com",
    # Our stylesheet and the Google Fonts stylesheet it imports (al-web/src/styles.css).
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    # Our API, Firebase Auth (sign-in and token refresh) and Firestore.
    "connect-src 'self' https://api.${var.domain} https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com",
    "frame-src https://${local.firebase_auth_domain}",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'", # no other site may show the portal in a frame (clickjacking)
  ])
}

resource "aws_amplify_app" "portal" {
  count = local.portal_count

  name        = "agentic-lender-portal"
  description = "The broker and underwriter portal (al-web). Uploaded by GitHub Actions, never built here."
  platform    = "WEB" # a static site: no server-side rendering

  enable_branch_auto_build    = false
  enable_auto_branch_creation = false

  # Rules run top to bottom; the first that matches wins.
  # 1. www.agentic-lender.com sends the browser on to agentic-lender.com.
  custom_rule {
    source = "https://www.${var.domain}"
    target = "https://${var.domain}"
    status = "301"
  }

  # 2. Any path that isn't a file (no extension we serve) gets index.html with a 200, so React Router
  #    can draw it. Reloading /underwriter/applications/<id> works instead of a 404.
  #    The pattern is the one the Amplify User Guide gives for single-page apps.
  custom_rule {
    source = "</^[^.]+$|\\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>"
    target = "/index.html"
    status = "200"
  }

  # Security headers on every response. Written in the JSON form Amplify stores and hands back
  # ([{"pattern":..,"headers":[{"key":..,"value":..}]}], pattern first), not its YAML form: given YAML,
  # every plan showed the same headers as a change. jsonencode sorts keys, so "key" comes before "value" as AWS has it.
  custom_headers = "[{\"pattern\":\"**\",\"headers\":${jsonencode([
    { key = "Strict-Transport-Security", value = "max-age=31536000; includeSubDomains" },
    { key = "Content-Security-Policy", value = local.portal_csp },
    { key = "X-Content-Type-Options", value = "nosniff" },
    { key = "Referrer-Policy", value = "strict-origin-when-cross-origin" },
  ])}}]"
}

# The only branch. "main" only names it: it isn't tied to Git, it's where the workflow uploads.
resource "aws_amplify_branch" "main" {
  count = local.portal_count

  app_id      = aws_amplify_app.portal[0].id
  branch_name = "main"
  stage       = "PRODUCTION"

  enable_auto_build           = false
  enable_pull_request_preview = false
}

# agentic-lender.com and www.agentic-lender.com, both on the main branch, with a certificate Amplify
# makes and renews. www only exists to be redirected by the first rule above.
resource "aws_amplify_domain_association" "portal" {
  count = local.portal_count

  app_id      = aws_amplify_app.portal[0].id
  domain_name = var.domain

  certificate_settings {
    type = "AMPLIFY_MANAGED"
  }

  sub_domain {
    branch_name = aws_amplify_branch.main[0].branch_name
    prefix      = ""
  }

  sub_domain {
    branch_name = aws_amplify_branch.main[0].branch_name
    prefix      = "www"
  }

  # Finish the apply only once Amplify has found its proof record in our zone. The zone already answers
  # for the domain (certificate.tf needed the same), so this is minutes, not hours.
  wait_for_verification = true
}
