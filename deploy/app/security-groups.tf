# security-groups.tf: who may talk to whom (AL-226 criterion 4).
#
# A security group is a guest list on a resource: what may connect in, and where it may connect out.
# Anything not on the list is silently dropped.
#
#   internet ──:80/:443──▶ [ alb ] ──:5001-5002──▶ [ tasks ] ──:443──▶ Gemini, Groq, Bedrock, Firebase...
#   internet ─────────────────────:5001───────────▶ [ tasks ]   dropped: not from the alb group
#
# The tasks group lets in only things wearing the alb group's badge, not an address. So even though
# the tasks have public IPs in the test run (network.tf), someone who finds one and calls port 5001
# directly gets nothing back.
#
# This ticket makes the tasks group; the ECS tickets attach it to the al-ai and al-core services.
# Each rule is its own resource, the current AWS provider style. It also stops two groups that point
# at each other from getting stuck when one is replaced.
#
# Costs nothing: security groups are free.

locals {
  # al-ai listens on 5001 and al-core on 5002, the same ports as on the laptop (docker-compose.yml).
  task_ports = { from = 5001, to = 5002 }
}

# ---- the load balancer's group -------------------------------------------------------------------

resource "aws_security_group" "alb" {
  name        = "agentic-lender-alb"
  description = "The load balancer: HTTP and HTTPS in from anywhere, out only to the tasks."
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTP from anywhere, only so it can be redirected to HTTPS"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTPS from anywhere"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "alb_to_tasks" {
  security_group_id            = aws_security_group.alb.id
  description                  = "Forward requests and health checks to the tasks"
  referenced_security_group_id = aws_security_group.tasks.id
  ip_protocol                  = "tcp"
  from_port                    = local.task_ports.from
  to_port                      = local.task_ports.to
}

# ---- the tasks' group ----------------------------------------------------------------------------

resource "aws_security_group" "tasks" {
  name        = "agentic-lender-tasks"
  description = "The al-ai and al-core tasks: in only from the load balancer, HTTPS out to the APIs they call."
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "tasks_from_alb" {
  security_group_id            = aws_security_group.tasks.id
  description                  = "Only the load balancer may connect"
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = local.task_ports.from
  to_port                      = local.task_ports.to
}

# The tasks call Gemini, Groq, Serper, the ECB, Bedrock, Firebase and the testnet, and pull their
# images from ECR, all over HTTPS. So out is HTTPS (port 443) to anywhere and nothing else. Name
# lookups (DNS) go to the VPC's own resolver, which security groups don't filter.
resource "aws_vpc_security_group_egress_rule" "tasks_to_internet" {
  security_group_id = aws_security_group.tasks.id
  description       = "HTTPS out to the APIs the services call"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}
