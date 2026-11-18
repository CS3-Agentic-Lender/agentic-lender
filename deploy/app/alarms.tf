# alarms.tf: someone gets an email when things break (AL-226 criterion 5).
#
# A CloudWatch alarm watches one number and, when it crosses a line, sends a message to the alarm
# email list (foundations/alarm-emails.tf). It emails again when the number is back to normal.
#
#   alarm                    watches                                fires when
#   ai-no-healthy-task       healthy al-ai tasks                    below 1 for 3 minutes
#   core-no-healthy-task     healthy al-core tasks                  below 1 for 3 minutes
#   alb-5xx                  5xx errors, load balancer + services   5 or more in 5 minutes
#
# Why "healthy below 1" and not "unhealthy above 0": each service runs one task. When that task dies,
# the target group has 0 healthy AND 0 unhealthy tasks, so "unhealthy above 0" would stay silent in
# exactly the worst case.
#
# The budget part of criterion 5 is NOT here, on purpose. The budget alerts from AL-224 already cover
# it, and they have to keep running when this folder is torn down by `./deploy/al down`, which is just
# when you'd still want them. The deploy role is also barred from AWS Budgets (foundations/guardrails.tf).
#
# Until the ECS tickets put tasks behind the load balancer, both health alarms sit in ALARM and email
# once. That's expected, and it proves the wiring works.
#
# Costs about EUR 0.40 a month: USD 0.10 per number an alarm watches. The two health alarms watch one
# each and the 5xx alarm watches two.

# ---- no healthy task, one alarm per service ------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "no_healthy_task" {
  for_each = aws_lb_target_group.service

  alarm_name        = "agentic-lender-${each.key}-no-healthy-task"
  alarm_description = "No healthy al-${each.key} task behind the load balancer for 3 minutes, so /${each.key}/* is down."

  namespace   = "AWS/ApplicationELB"
  metric_name = "HealthyHostCount"
  dimensions = {
    TargetGroup  = each.value.arn_suffix
    LoadBalancer = aws_lb.api.arn_suffix
  }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 3
  comparison_operator = "LessThanThreshold"
  threshold           = 1

  # No data at all (e.g. a service that never started) counts as down too.
  treat_missing_data = "breaching"

  alarm_actions = [data.aws_sns_topic.alarms.arn]
  ok_actions    = [data.aws_sns_topic.alarms.arn]
}

# ---- 5xx errors ----------------------------------------------------------------------------------

# Two kinds of 5xx added together:
#   ELB_5XX:    the load balancer couldn't get an answer from a task (502, 503, 504)
#   Target_5XX: a service answered with an error, e.g. it crashed on a request (500)
resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name        = "agentic-lender-alb-5xx"
  alarm_description = "5 or more 5xx errors in 5 minutes, from the load balancer or from al-ai / al-core."

  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 5
  evaluation_periods  = 1

  # No requests means no errors, so missing data isn't a problem here.
  treat_missing_data = "notBreaching"

  metric_query {
    id          = "total"
    expression  = "FILL(elb, 0) + FILL(target, 0)" # FILL: a 5 minutes with none of one kind counts as 0
    label       = "5xx errors, load balancer + services"
    return_data = true
  }

  metric_query {
    id = "elb"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "HTTPCode_ELB_5XX_Count"
      dimensions  = { LoadBalancer = aws_lb.api.arn_suffix }
      stat        = "Sum"
      period      = 300
    }
  }

  metric_query {
    id = "target"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "HTTPCode_Target_5XX_Count"
      dimensions  = { LoadBalancer = aws_lb.api.arn_suffix }
      stat        = "Sum"
      period      = 300
    }
  }

  alarm_actions = [data.aws_sns_topic.alarms.arn]
  ok_actions    = [data.aws_sns_topic.alarms.arn]
}
