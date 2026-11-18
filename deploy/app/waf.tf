# waf.tf: the bouncer on the front door (AL-226 criterion 3, and docs/api-design.md section 6).
#
# A WAF (Web Application Firewall) is a rulebook the load balancer checks every request against
# before doing anything else. It isn't a separate box on the wire: it's clipped onto the load
# balancer, which asks "may this in?" and waits for the answer.
#
#   request ─▶ load balancer ──"may this in?"──▶ rules, in order:
#                                                  1. signup-limit   more than 20 POST /core/me a minute → 429
#                                                  2. per-ip-limit   more than 300 requests in 5 minutes → 429
#                                                  3. aws-common     AWS's list of common attacks        → 403
#                                                  nothing matched → allow
#
# Rules 1 and 2 are the same limits the laptop gateway enforces (gateway/nginx.conf), so AWS and the
# laptop behave alike. Stopping a flood here means it never costs a load balancer hit or an LLM call.
#
# Two things worth knowing:
#   - AWS checks the counts every few seconds, so a burst can slip a little over a limit before the
#     block starts. That's why the ticket says "about" 300.
#   - WAF normally blocks with a bare 403. docs/api-design.md promises clients a 429 with Retry-After,
#     so the rate rules send that instead, with the laptop gateway's plain-text body.
#
# Costs about EUR 7 to 8 a month: USD 5 for the rulebook, USD 1 per rule (the AWS managed rule group
# counts as one rule and has no subscription fee), and USD 0.60 per million requests.

resource "aws_wafv2_web_acl" "api" {
  name  = "agentic-lender-api"
  scope = "REGIONAL" # REGIONAL is the kind that attaches to a load balancer

  default_action {
    allow {} # anything no rule blocks is let in
  }

  # The 429 body, the same one the laptop gateway sends.
  custom_response_body {
    key          = "too_many_requests"
    content_type = "TEXT_PLAIN"
    content      = "Too many requests\n"
  }

  # ---- rule 1: sign-up limit, 20 POST /core/me per minute per IP ----------------------------------
  rule {
    name     = "signup-limit"
    priority = 1

    action {
      block {
        custom_response {
          response_code            = 429
          custom_response_body_key = "too_many_requests"
          response_header {
            name  = "Retry-After"
            value = "60"
          }
        }
      }
    }

    statement {
      rate_based_statement {
        limit                 = 20
        evaluation_window_sec = 60
        aggregate_key_type    = "IP"

        # Only count requests that are POST and to exactly /core/me.
        scope_down_statement {
          and_statement {
            statement {
              byte_match_statement {
                search_string         = "/core/me"
                positional_constraint = "EXACTLY"
                field_to_match {
                  uri_path {}
                }
                text_transformation {
                  priority = 0
                  type     = "NONE"
                }
              }
            }
            statement {
              byte_match_statement {
                search_string         = "POST"
                positional_constraint = "EXACTLY"
                field_to_match {
                  method {}
                }
                text_transformation {
                  priority = 0
                  type     = "NONE"
                }
              }
            }
          }
        }
      }
    }

    visibility_config {
      metric_name                = "signup-limit"
      cloudwatch_metrics_enabled = true
      sampled_requests_enabled   = true
    }
  }

  # ---- rule 2: 300 requests per 5 minutes per IP, any path ----------------------------------------
  rule {
    name     = "per-ip-limit"
    priority = 2

    action {
      block {
        custom_response {
          response_code            = 429
          custom_response_body_key = "too_many_requests"
          response_header {
            name  = "Retry-After"
            value = "60"
          }
        }
      }
    }

    statement {
      rate_based_statement {
        limit                 = 300
        evaluation_window_sec = 300
        aggregate_key_type    = "IP"
      }
    }

    visibility_config {
      metric_name                = "per-ip-limit"
      cloudwatch_metrics_enabled = true
      sampled_requests_enabled   = true
    }
  }

  # ---- rule 3: AWS's managed list of common attacks -----------------------------------------------
  # Kept up to date by AWS: SQL injection, cross-site scripting, bad bots, oversized requests, etc.
  rule {
    name     = "aws-common"
    priority = 3

    override_action {
      none {} # use the actions AWS set inside the group (block), except the override below
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"

        # This check blocks any request body over 8 KB, which could break larger API calls (a long
        # application, a document). "count" logs what it would have blocked without blocking it, so
        # the test run shows whether it would hurt us before it's ever switched on.
        rule_action_override {
          name = "SizeRestrictions_BODY"
          action_to_use {
            count {}
          }
        }
      }
    }

    visibility_config {
      metric_name                = "aws-common"
      cloudwatch_metrics_enabled = true
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    metric_name                = "agentic-lender-api"
    cloudwatch_metrics_enabled = true
    sampled_requests_enabled   = true
  }
}

# Clip the rulebook onto the load balancer.
resource "aws_wafv2_web_acl_association" "api" {
  resource_arn = aws_lb.api.arn
  web_acl_arn  = aws_wafv2_web_acl.api.arn
}
