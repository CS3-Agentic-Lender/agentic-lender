# deploy/

Everything that puts AL on AWS, written in Terraform. The design and the costs are in
[`docs/deployment.md`](../docs/deployment.md).

## The two folders

| Folder | What's in it | Run by | Removed by `down`? |
|---|---|---|---|
| `foundations/` | One-time pieces: the state bucket, the GitHub deploy role, the DNS zone, the HTTPS certificate, the alarm email list, the image registries, al-ai's secrets, log group and roles | Nic, by hand with `terraform` | Never. They cost about USD 3 a month and are slow to set up again |
| `app/` | Everything billed by the hour: network, load balancer, WAF, alarms, ECS services (added by later tickets) | `./deploy/al` | Yes |

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
│   ├── alarm-emails.tf         who the alarms email
│   ├── ecr.tf                  the image registries for al-ai and al-core
│   ├── al-ai-secrets.tf        al-ai's two secrets (made empty) and its log group
│   ├── al-ai-roles.tf          the roles an al-ai task runs with: ECS's execution role and al-ai's task role
│   └── outputs.tf              name servers, role ARNs, bucket, certificate, alarm topic, image registries, al-ai secrets and log group
└── app/
    ├── versions.tf, variables.tf, providers.tf, backend.tf, outputs.tf
    ├── release.tf              which build is deployed
    ├── lookups.tf              finds the zone, certificate and alarm list foundations made
    ├── network.tf              the VPC and two public subnets
    ├── security-groups.tf      the load balancer may talk to the tasks, nothing else may
    ├── load-balancer.tf        HTTPS front door, /ai/* and /core/* rules, api.agentic-lender.com
    ├── waf.tf                  rate limits and AWS's common-attack rules
    └── alarms.tf               emails when a service is down or 5xx errors pile up
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

## Images

The deploy images are built by GitHub Actions (`.github/workflows/images.yml`), never by a laptop:

- **On a PR** that changes `al-ai/` or `al-core/`, it builds both images for ARM64 and pushes nothing.
  A Dockerfile that won't build on ARM fails the PR.
- **On every merge to `main`**, it builds both again and pushes them to ECR as
  `agentic-lender/al-ai:<commit>` and `agentic-lender/al-core:<commit>`, using the full commit id.
  That commit id is what `./deploy/al deploy` takes.

ECR scans each image when it arrives (Console: ECR, then the repository, then the image). Tags can't
be overwritten, and each repository keeps its 30 newest images (about a week of merges).
An image older than that is deleted, so redeploy a recent commit rather than an old one.

### Backup: pushing from Nic's Mac

Only if the workflow is broken and a build has to go out. The Mac is ARM, so it builds the same
ARM64 image natively. Run it from a clean checkout of the `main` commit you want, so the tag tells
the truth, and use the full commit id like CI does:

```sh
aws login --profile agentic-lender && export AWS_PROFILE=agentic-lender
REGISTRY=176550299403.dkr.ecr.eu-west-1.amazonaws.com
TAG="$(git rev-parse HEAD)"
git status --porcelain   # must print nothing: the image has to match the commit
aws ecr get-login-password --region eu-west-1 | docker login --username AWS --password-stdin "$REGISTRY"
for svc in al-ai al-core; do
  docker buildx build --platform linux/arm64 --provenance=false --push \
    -t "${REGISTRY}/agentic-lender/${svc}:${TAG}" "$svc"   # braces: in zsh, $svc:l would mean "lowercase"
done
```

If CI already pushed that commit, ECR refuses the push (`tag already exists`), which is what you want.

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

Floci has one quirk here: it reports the two security group rules that point at another group as
`000000000000/sg-...` instead of `sg-...`, so `al status --floci` shows them as drift after an apply.
Real AWS doesn't do this, so that drift on Floci can be ignored.

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

## Who gets the alarm emails

The alarms in `app/alarms.tf` email everyone on the list in `foundations/alarm-emails.tf`. The
addresses stay out of the public repo: put them in `foundations/alarm-emails.auto.tfvars`, which is
gitignored and read automatically, then `terraform apply` in `deploy/foundations`.

```hcl
alarm_emails = ["someone@example.com", "someone-else@example.com"]
```

Each address gets a "Confirm subscription" email from AWS and receives nothing until it's clicked.
Because the list is in foundations, `down` and `up` never make anyone confirm again. `app/` needs the
list to exist, so apply foundations first.

The budget alerts are separate (AL-224) and keep running while `app/` is down.

## Filling the al-ai secrets

`foundations/al-ai-secrets.tf` makes al-ai's two secrets empty, so no key ever passes through Terraform
or its state (which the deploy role can read). Fill them once by hand, signed in as yourself, after
the apply that creates them. Write each value to a file **outside the repo** first, so it can't be
committed and doesn't end up in your shell history.

The API keys, as one JSON object with exactly these four names (al-ai reads them as environment
variables with the same names):

```json
{"GROQ_API_KEY":"","GEMINI_API_KEY":"","MISTRAL_API_KEY":"","SERPER_API_KEY":""}
```

```sh
aws secretsmanager put-secret-value --secret-id agentic-lender/al-ai/api-keys \
  --secret-string file://$HOME/al-ai-api-keys.json
aws secretsmanager put-secret-value --secret-id agentic-lender/al-ai/firebase-service-account \
  --secret-string file://$HOME/al-ai-service-account.json   # the JSON file downloaded from Firebase
rm ~/al-ai-api-keys.json ~/al-ai-service-account.json       # Secrets Manager has them now
```

To change a key later, run the same command with the new file. A task reads its secrets when it
starts, so redeploy for the change to reach al-ai. Only Nic's own login can do this: the guardrails
boundary stops the deploy role and every app role from reading or changing any `agentic-lender/*`
secret, except al-ai's execution role reading them.

## Roles the app needs

The deploy role works under a permissions boundary (`foundations/guardrails.tf`) and can't create or
change any IAM role or policy: a role made from inside could trust an outsider and become a way in.
So a role the app needs goes in `foundations/` and Nic applies it. It must:

- be named `agentic-lender-app-...`, the only names the deploy role may hand to a service (PassRole)
- set `permissions_boundary` to the `guardrails_boundary_arn` output

`deploy/app` then refers to it by name.

al-ai has two, in `foundations/al-ai-roles.tf`:

| Role | Used by | May do |
|---|---|---|
| `agentic-lender-app-al-ai-execution` | ECS, while starting a task | sign in to ECR and pull the al-ai image, read al-ai's two secrets, write to the `/agentic-lender/al-ai` log group |
| `agentic-lender-app-al-ai-task` | al-ai's code, while it runs | call Qwen3 32B (`qwen.qwen3-32b-v1:0`) on Bedrock in eu-west-1, nothing else |

So reading the secrets and writing logs is the execution role's job, done before the code starts;
the code itself can only reach Bedrock. Both trust only ECS tasks in this account. Their ARNs are
the `al_ai_execution_role_arn` and `al_ai_task_role_arn` outputs.

The boundary also shuts off CloudFormation, CodeBuild and SSM
Run Command, and the deploy role can't write anything under `foundations/` in the state bucket.

Both folders refuse to run against any account but the team's (`team_account_id`), and so does `al`.
