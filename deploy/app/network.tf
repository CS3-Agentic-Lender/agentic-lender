# network.tf: our own private network in AWS (AL-226 criterion 1).
#
# A VPC is a private network that only our resources live in. Inside it, a subnet is a slice of its
# addresses in one availability zone (one of AWS's separate data-centre buildings in the region).
#
#   VPC 10.0.0.0/16
#   ├── 10.0.1.0/24   public a   (eu-west-1a)   built here
#   ├── 10.0.2.0/24   public b   (eu-west-1b)   built here
#   ├── 10.0.11.0/24  private a  left free for demo week (docs/deployment.md), not built
#   └── 10.0.12.0/24  private b  left free for demo week, not built
#
# Why two zones: an Application Load Balancer won't be created with fewer than two subnets in two
# different zones, and if one building has a problem the other keeps serving.
#
# Why public subnets: tasks in private subnets need a NAT gateway (about EUR 30 a month) to reach
# Gemini, Groq and the rest. For the test run the tasks sit in these public subnets instead, and the
# tasks security group (security-groups.tf) still refuses every connection that isn't from the
# load balancer. Leaving the private ranges free means demo week can add them without renumbering.
#
# Costs nothing: VPCs, subnets, internet gateways and route tables are free.

locals {
  public_subnets = {
    a = "10.0.1.0/24"
    b = "10.0.2.0/24"
  }
}

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true # so tasks can look up AWS service addresses by name

  tags = { Name = "agentic-lender" }
}

resource "aws_subnet" "public" {
  for_each = local.public_subnets

  vpc_id            = aws_vpc.main.id
  cidr_block        = each.value
  availability_zone = "${var.region}${each.key}" # eu-west-1a, eu-west-1b

  tags = { Name = "agentic-lender-public-${each.key}" }
}

# The VPC's door to the internet. Without it nothing inside can be reached, or reach out.
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = { Name = "agentic-lender" }
}

# The signpost: "anything not inside the VPC goes out through the internet gateway".
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "agentic-lender-public" }
}

# Hang that signpost in both public subnets.
resource "aws_route_table_association" "public" {
  for_each = aws_subnet.public

  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}
