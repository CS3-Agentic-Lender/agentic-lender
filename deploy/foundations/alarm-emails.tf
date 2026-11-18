# alarm-emails.tf: the email list the CloudWatch alarms in deploy/app send to (AL-226 criterion 5).
#
# SNS (Simple Notification Service) is used here as nothing more than a mailing list: an alarm
# "publishes" to the topic and SNS emails everyone subscribed to it.
#
# Why it lives in foundations and not next to the alarms in deploy/app: every email address has to
# click a "Confirm subscription" link before SNS will send it anything. If the topic were in app/,
# every `./deploy/al down` and `up` would delete and remake it, and everyone would have to confirm
# again. Here it's made once and outlives every down/up. deploy/app finds it by name.
#
# The addresses aren't in the code (the repo is public). Put them in alarm-emails.auto.tfvars in this
# folder, which is gitignored and read automatically:
#   alarm_emails = ["someone@example.com", "someone-else@example.com"]
#
# Costs nothing: SNS email is free for the first 1,000 emails a month.

resource "aws_sns_topic" "alarms" {
  name = "agentic-lender-alarms"
}

# One subscription per address. Each stays "pending confirmation" until its owner clicks the link.
resource "aws_sns_topic_subscription" "alarm_email" {
  for_each = toset(var.alarm_emails)

  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = each.value
}
