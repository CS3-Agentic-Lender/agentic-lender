# load-balancer.tf: the one front door for both services (AL-226 criterion 2).
#
# This is the laptop gateway (gateway/nginx.conf) rebuilt with AWS parts:
#
#                     ┌────────────── listener :443 ──────────────┐
#   https://api... ──▶│ /ai/*    → target group ai   (port 5001)  │──▶ al-ai tasks
#                     │ /core/*  → target group core (port 5002)  │──▶ al-core tasks
#                     │ anything else → 404                        │
#                     └────────────────────────────────────────────┘
#   http://api...  ──▶ listener :80 ──▶ "301, use https://" (never forwards anything)
#
# The path is passed through unchanged, and both services already serve everything under /ai and
# /core (APIRouter(prefix=...)), so no code change is needed in either.
#
# The target groups are empty until the ECS tickets register tasks in them, so until then /ai/* and
# /core/* answer 503. That's expected: it shows HTTPS and routing work with nothing behind them yet.
#
# Costs about EUR 18 a month for the load balancer and EUR 7 for its two public IPv4 addresses.
# Target groups, listeners, rules and the alias record are free.

resource "aws_lb" "api" {
  name               = "agentic-lender-api"
  load_balancer_type = "application"
  internal           = false
  security_groups    = [aws_security_group.alb.id]
  subnets            = [for subnet in aws_subnet.public : subnet.id]

  # Throw away requests with malformed headers instead of passing them on to the services.
  drop_invalid_header_fields = true
}

# ---- listeners: the ports the load balancer answers on -------------------------------------------

# Port 80 only ever redirects. Someone typing the address without https:// lands in the right place
# instead of a timeout, and nothing is ever served over plain HTTP.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.api.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      protocol    = "HTTPS"
      port        = "443"
      status_code = "HTTP_301" # permanent, so browsers remember to go straight to HTTPS
    }
  }
}

# Port 443 unlocks HTTPS with the foundations certificate, then the rules below pick a service.
# The TLS policy allows only TLS 1.3 and 1.2: every phone and browser of the last ~8 years speaks
# 1.2, and the older versions AWS's default still allows have known weaknesses.
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.api.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = data.aws_acm_certificate.api.arn

  # Nothing matched /ai/* or /core/*.
  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "application/json"
      message_body = "{\"detail\":\"Not Found\"}" # the same body FastAPI gives for an unknown route
      status_code  = "404"
    }
  }
}

# ---- target groups: where each kind of request goes, and how to tell a task is healthy ----------

locals {
  services = {
    ai   = { port = 5001, path = "/ai" }
    core = { port = 5002, path = "/core" }
  }
}

resource "aws_lb_target_group" "service" {
  for_each = local.services

  name        = "agentic-lender-${each.key}"
  port        = each.value.port
  protocol    = "HTTP" # HTTPS ends at the load balancer; inside the VPC it's plain HTTP
  vpc_id      = aws_vpc.main.id
  target_type = "ip" # each Fargate task gets its own address, which ECS registers here

  # When ECS swaps in a new version, give requests already in flight 30 seconds to finish
  # (the default is 300, which would make every deploy five minutes slower).
  deregistration_delay = 30

  # How the load balancer (and ECS) knows a task is working. Both services have GET <prefix>/health.
  # The health alarms in alarms.tf read the result of these checks.
  health_check {
    path                = "${each.value.path}/health"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2 # 2 passes in a row (30 seconds) to count as healthy
    unhealthy_threshold = 3 # 3 failures in a row (45 seconds) to count as unhealthy
  }
}

# ---- rules on the HTTPS listener: read the path, pick a service -----------------------------------

resource "aws_lb_listener_rule" "service" {
  for_each = local.services

  listener_arn = aws_lb_listener.https.arn
  priority     = each.key == "ai" ? 10 : 20

  condition {
    path_pattern {
      values = ["${each.value.path}/*"]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.service[each.key].arn
  }
}

# ---- DNS: api.agentic-lender.com → the load balancer ---------------------------------------------

# An "alias" record points a name at an AWS resource rather than at a fixed address, so it follows
# the load balancer if AWS moves it. Alias lookups to a load balancer are free.
resource "aws_route53_record" "api" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "api.${var.domain}"
  type    = "A"

  alias {
    name                   = aws_lb.api.dns_name
    zone_id                = aws_lb.api.zone_id
    evaluate_target_health = false
  }
}
