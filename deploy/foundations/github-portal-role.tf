# github-portal-role.tf: lets GitHub Actions upload the portal to Amplify, and nothing else (AL-328).
#
# The Portal workflow (.github/workflows/portal.yml) builds al-web on every merge to main and uploads
# the zip to the Amplify app in portal.tf. Signed in as this role it can find that app by name, start
# a deployment on its main branch and watch it finish. It can't change the app, its domain or its headers, and it
# can't touch anything else in the account.
#
# It trusts exactly who the deploy role trusts (github-deploy-role.tf): a GitHub job from this repo's
# main branch. It reuses that trust policy, so tightening one tightens both.
#
# Not made on Floci, like the app it deploys to (portal.tf).
#
# Costs nothing: IAM is free.

resource "aws_iam_role" "github_portal" {
  count = local.portal_count

  name                 = "agentic-lender-github-portal"
  description          = "Used by GitHub Actions on main to upload the portal to its Amplify app. Nothing else."
  assume_role_policy   = data.aws_iam_policy_document.github_trust.json
  max_session_duration = 3600 # the temporary keys last at most 1 hour
}

data "aws_iam_policy_document" "github_portal" {
  count = local.portal_count

  # Finding the app's id from its name, so the workflow needs no id pasted in and still works if the app
  # is ever made again. AWS only accepts "*" for ListApps; it shows apps' names and ids, not their files.
  statement {
    sid       = "FindTheAppByName"
    actions   = ["amplify:ListApps"]
    resources = ["*"]
  }

  # A "deploy without Git" upload: CreateDeployment hands back an upload address, StartDeployment
  # publishes the zip, ListJobs shows what is already running. All three name the branch.
  statement {
    sid     = "DeployToTheMainBranch"
    actions = ["amplify:CreateDeployment", "amplify:StartDeployment", "amplify:ListJobs"]
    # AWS checks CreateDeployment against the branch's deployments (…/branches/main/deployments/*), not the branch itself:
    # the first upload was refused with exactly that resource. Both forms stay inside this one branch.
    resources = [aws_amplify_branch.main[0].arn, "${aws_amplify_branch.main[0].arn}/deployments/*"]
  }

  # Polling the deployment until it succeeds or fails. AWS names a job by its branch plus its number.
  statement {
    sid       = "WatchItsJobs"
    actions   = ["amplify:GetJob"]
    resources = ["${aws_amplify_branch.main[0].arn}/jobs/*"]
  }
}

resource "aws_iam_role_policy" "github_portal" {
  count = local.portal_count

  name   = "deploy-portal"
  role   = aws_iam_role.github_portal[0].id
  policy = data.aws_iam_policy_document.github_portal[0].json
}
