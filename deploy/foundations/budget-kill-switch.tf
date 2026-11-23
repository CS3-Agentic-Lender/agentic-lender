# budget-kill-switch.tf: when the month's actual spend reaches the budget, lock the deploy role.
#
# The budget itself, agentic-lender-monthly (USD 50, with its alert emails), was made by hand in the
# Billing console and isn't in Terraform. This file only adds an action to it, found by name.
#
# When AWS Budgets sees ACTUAL spend reach 100% of the budget, it attaches the deny-everything policy
# below to the GitHub deploy role, on its own (approval_model AUTOMATIC: a kill switch that waits for
# someone to click Approve isn't one). From then on a GitHub deploy can't start, change or push
# anything. The deploy role can't take the policy off again: its boundary (guardrails.tf) denies
# iam:DetachRolePolicy and all of budgets:*.
#
# What this does NOT stop: anything already running. The Fargate tasks, the load balancer, the WAF
# and the public IPs keep billing by the hour until someone removes them. Run `./deploy/al down`
# (signed in as yourself, not the deploy role) when the alert arrives. Billing data also arrives hours
# late, so spend can pass the budget before this fires. It slows a runaway, it is not a hard cap.
#
# To unlock after it fired: in the Billing console, Budgets, agentic-lender-monthly, Actions, choose
# "Reverse" (or detach agentic-lender-budget-deny-all from the deploy role in IAM).
#
# Only on the real account: the budget doesn't exist on Floci.
#
# Costs nothing: IAM is free, and so are the first two budgets that have actions.

# Deny everything. Attached only by the budget action, never by Terraform.
resource "aws_iam_policy" "budget_deny_all" {
  name        = "agentic-lender-budget-deny-all"
  description = "Attached to the GitHub deploy role by the budget action when actual spend reaches the monthly budget."
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Sid = "BudgetReached", Effect = "Deny", Action = "*", Resource = "*" }]
  })
}

# The role AWS Budgets acts as. Only Budgets, on behalf of this account, may use it, and it may only
# attach (or, to reverse, detach) that one policy on the deploy role.
resource "aws_iam_role" "budget_action" {
  name = "agentic-lender-budget-action"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "budgets.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = { StringEquals = { "aws:SourceAccount" = local.account_id } }
    }]
  })
}

resource "aws_iam_role_policy" "budget_action" {
  name = "attach-deny-all-to-deploy-role"
  role = aws_iam_role.budget_action.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = ["iam:AttachRolePolicy", "iam:DetachRolePolicy"]
      Resource  = aws_iam_role.github_deploy.arn
      Condition = { ArnEquals = { "iam:PolicyARN" = aws_iam_policy.budget_deny_all.arn } }
    }]
  })
}

resource "aws_budgets_budget_action" "stop_deploys" {
  count = local.floci ? 0 : 1

  account_id         = local.account_id
  budget_name        = "agentic-lender-monthly"
  action_type        = "APPLY_IAM_POLICY"
  approval_model     = "AUTOMATIC"
  notification_type  = "ACTUAL"
  execution_role_arn = aws_iam_role.budget_action.arn

  action_threshold {
    action_threshold_type  = "PERCENTAGE"
    action_threshold_value = 100
  }

  definition {
    iam_action_definition {
      policy_arn = aws_iam_policy.budget_deny_all.arn
      roles      = [aws_iam_role.github_deploy.name]
    }
  }

  # Budgets emails these people when the action runs. AWS allows 1 to 11.
  dynamic "subscriber" {
    for_each = toset(var.alarm_emails)
    content {
      subscription_type = "EMAIL"
      address           = subscriber.value
    }
  }

  lifecycle {
    precondition {
      condition     = length(var.alarm_emails) > 0
      error_message = "The budget action needs at least one address in alarm_emails (alarm-emails.auto.tfvars)."
    }
  }

  depends_on = [aws_iam_role_policy.budget_action]
}
