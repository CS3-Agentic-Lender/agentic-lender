# deploy/

Everything that puts AL on AWS, written in Terraform. The design and the costs are in
[`docs/deployment.md`](../docs/deployment.md).

## The two folders

| Folder | What's in it | Run by | Removed by `down`? |
|---|---|---|---|
| `foundations/` | One-time pieces: the state bucket, the GitHub deploy role, the DNS zone, the HTTPS certificate | Nic, by hand with `terraform` | Never. They cost about USD 0.50 a month and are slow to set up again |
| `app/` | Everything billed by the hour: load balancer, WAF, ECS services (added by later tickets) | `./deploy/al` | Yes |

Each `.tf` file holds one idea and starts with a comment saying what it creates, why, and what it costs.

```
deploy/
├── al                    the four commands (below)
├── backend-aws.hcl       where the state lives on the real account
├── backend-floci.hcl     ...and on Floci
├── foundations/
│   ├── versions.tf             Terraform and AWS provider versions
│   ├── variables.tf            the settings: target, aws_profile, region, github_repo, domain
│   ├── providers.tf            real AWS or Floci
│   ├── state-bucket.tf         where Terraform keeps its memory
│   ├── backend.tf              ...and the lock on it
│   ├── github-deploy-role.tf   GitHub Actions on main may deploy, nothing else
│   ├── guardrails.tf           the ceiling on what that role (and roles it makes) can do
│   ├── dns.tf                  the agentic-lender.com zone
│   ├── certificate.tf          the certificate for api.agentic-lender.com
│   └── outputs.tf              name servers, role ARN, bucket, certificate
└── app/
    ├── versions.tf, variables.tf, providers.tf, backend.tf, outputs.tf
    └── release.tf              which build is deployed
```

## The four commands

```sh
./deploy/al deploy <commit>   # switch to a new build (the commit id GitHub Actions tagged the images with)
./deploy/al status            # what's deployed, and whether AWS still matches the code; changes nothing
./deploy/al down              # remove everything billed by the hour; asks twice
./deploy/al up                # bring it all back with the last build
```

Each one lists what it will change in plain words and asks first. It applies exactly the plan you
saw. Add `--floci` to any of them to practise on Floci.

## Practising on Floci

Floci is the AWS emulator on the PC. Nothing is billed and nothing reaches real AWS. The steps match
the real account's first run below, so practising them is a rehearsal.

```sh
ssh -f -N pc-aws                                              # open the tunnel (wakes the PC)
cd deploy/foundations
export TF_DATA_DIR=.terraform-floci                           # keeps Floci's files apart from the real account's
printf 'terraform {\n  backend "local" { path = "floci.tfstate" }\n}\n' > first_run_override.tf   # the bucket doesn't exist yet
terraform init && terraform apply -var target=floci
rm first_run_override.tf
terraform init -migrate-state -backend-config=../backend-floci.hcl     # move the state into the bucket
cd ../.. && ./deploy/al deploy 3166a3b --floci
```

The Floci console is at <http://localhost:4566/_floci/ui>.

## First time on the real account

Do these steps once, in order. Budget alerts (AL-224) must exist before step 2. You need Terraform
1.15 or later and AWS CLI 2.32 or later, for `aws login`.

1. **Sign in.** Run these in every terminal you use for this:
   ```sh
   aws login --profile agentic-lender
   export AWS_PROFILE=agentic-lender
   export TF_DATA_DIR=.terraform-aws   # keeps the real account's files apart from any Floci practice
   aws sts get-caller-identity
   ```
2. **Everything except the certificate check, with the state on the laptop at first.** The bucket
   doesn't exist yet, so a temporary override file tells Terraform to keep the state locally for this
   run. Terraform reads any file ending in `_override.tf` last, and its settings win. `-target` only
   builds what it names plus what those depend on, so the list names the last piece of each part. That
   way the bucket gets its encryption and public block, and the role gets its policies and boundary.
   In `deploy/foundations`:
   ```sh
   printf 'terraform {\n  backend "local" { path = "aws.tfstate" }\n}\n' > first_run_override.tf
   terraform init
   terraform apply \
     -target=aws_s3_bucket_policy.state -target=aws_s3_bucket_versioning.state \
     -target=aws_s3_bucket_server_side_encryption_configuration.state \
     -target=aws_s3_bucket_lifecycle_configuration.state \
     -target=aws_iam_role_policy_attachment.github_deploy_admin \
     -target=aws_route53_record.api_certificate_validation
   ```
   This also creates the certificate request and its validation record. Only the wait for ACM is
   left for step 4.
3. **Point the domain at the zone.** Run `terraform output name_servers`. In Nic's personal AWS
   account go to Route 53, then Registered domains, then agentic-lender.com, then Edit name servers.
   Paste the four, save, and check with `dig NS agentic-lender.com +short` until they show.
4. **Finish, including the certificate.** `terraform apply`. It waits until ACM sees the validation
   record, which is up to 45 minutes. After that, `terraform plan` should show no changes.
5. **Move the state into the bucket.** Read the bucket's name first: once the override is deleted,
   Terraform won't answer `terraform output` until the move is done. Then delete the override, move
   the state (answer `yes` when it asks to copy it) and check that `terraform plan` still shows no
   changes:
   ```sh
   BUCKET="$(terraform output -raw state_bucket)"
   rm first_run_override.tf
   terraform init -migrate-state -backend-config=../backend-aws.hcl -backend-config="bucket=$BUCKET"
   terraform plan
   rm aws.tfstate aws.tfstate.backup   # the laptop copy, now out of date
   ```
6. **Tidy up.** In the personal account, delete the old hosted zone that registration created. It's
   unused once step 3 is live, and it costs USD 0.50 a month. Route 53 only deletes a zone that holds
   just its NS and SOA records, so remove any others first.

## Roles the app needs

The deploy role works under a permissions boundary (`foundations/guardrails.tf`) and can't create or
change any IAM role or policy: a role made from inside could trust an outsider and become a way in.
So a role the app needs, such as an ECS task role, goes in `foundations/` and Nic applies it. It must:

- be named `agentic-lender-app-...`, the only names the deploy role may hand to a service (PassRole)
- set `permissions_boundary` to the `guardrails_boundary_arn` output

`deploy/app` then refers to it by name. The boundary also shuts off CloudFormation, CodeBuild and SSM
Run Command, and the deploy role can't write anything under `foundations/` in the state bucket.

Both folders refuse to run against any account but the team's (`team_account_id`), and so does `al`.
