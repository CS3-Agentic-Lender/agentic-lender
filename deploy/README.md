# deploy/

Everything that puts AL on AWS, written in Terraform. The design and the costs are in
[`docs/deployment.md`](../docs/deployment.md).

## The two folders

| Folder | What's in it | Run by | Removed by `down`? |
|---|---|---|---|
| `foundations/` | One-time pieces: the state bucket, the GitHub deploy and images roles, the DNS zone, the HTTPS certificate, the alarm email list, the image registries, al-ai's and al-core's secrets, log groups and roles, the portal on Amplify and its upload role | Nic, by hand with `terraform` | Never. They cost about USD 4.50 a month and are slow to set up again |
| `app/` | Everything billed by the hour: network, load balancer, WAF, alarms, the ECS cluster and the al-ai and al-core services | `./deploy/al` | Yes |

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
│   ├── github-images-role.tf   GitHub Actions on main may push images, nothing else
│   ├── guardrails.tf           the ceiling on what that role (and roles it makes) can do
│   ├── dns.tf                  the agentic-lender.com zone
│   ├── certificate.tf          the certificate for api.agentic-lender.com
│   ├── alarm-emails.tf         who the alarms email
│   ├── ecr.tf                  the image registries for al-ai and al-core
│   ├── ecs-trust.tf            who may use the ECS roles: only ECS tasks in this account
│   ├── al-ai-secrets.tf        al-ai's two secrets (made empty) and its log group
│   ├── al-ai-roles.tf          the roles an al-ai task runs with: ECS's execution role and al-ai's task role
│   ├── al-core-secrets.tf      al-core's three secrets (made empty) and its log group
│   ├── al-core-roles.tf        the roles an al-core task runs with: ECS's execution role and al-core's task role
│   ├── portal.tf               the portal at agentic-lender.com on Amplify: rewrites, security headers, domain
│   ├── github-portal-role.tf   GitHub Actions on main may upload the portal, nothing else
│   └── outputs.tf              name servers, role ARNs, bucket, certificate, alarm topic, image registries, both services' secrets and log groups, the portal's app id and address
└── app/
    ├── versions.tf, variables.tf, providers.tf, backend.tf, outputs.tf
    ├── release.tf              which build is deployed
    ├── lookups.tf              finds what foundations made: zone, certificate, alarm list, each service's registry, secrets, roles, log group
    ├── network.tf              the VPC and two public subnets
    ├── security-groups.tf      the load balancer may talk to the tasks, nothing else may
    ├── load-balancer.tf        HTTPS front door, /ai/* and /core/* rules, api.agentic-lender.com
    ├── waf.tf                  rate limits and AWS's common-attack rules
    ├── alarms.tf               emails when a service is down or 5xx errors pile up
    └── ecs.tf                  the ECS cluster and both services: al-ai behind /ai/*, al-core behind /core/*
```

## The four commands

```sh
./deploy/al deploy <commit>   # switch to a new build (the commit id GitHub Actions tagged the images with)
./deploy/al status            # what's deployed, and whether AWS still matches the code; changes nothing
./deploy/al down              # remove everything billed by the hour; asks twice
./deploy/al up                # bring it all back with the last build
```

Each one lists what it will change in plain words and asks first. When anything is changed or
replaced, it also prints Terraform's diff with the old and new value of every attribute (secrets stay
hidden), so a build switch can't hide a changed port, CIDR, role or WAF rule. A plan that only creates
(`up`, a first deploy) or only removes (`down`) shows just the list. It applies exactly the plan you
saw. Add `--floci` to any of them to practise on Floci.

## Deploying al-ai

`./deploy/al deploy <commit>` builds or updates everything in `app/` with that build. For al-ai that
means a new task definition for the image `agentic-lender/al-ai:<commit>`, and the ECS service swapping
the running task for one from it:

1. ECS starts the new task next to the old one, in a public subnet, as the two roles from
   `foundations/al-ai-roles.tf`. Its four API keys and its Firebase service account come from
   Secrets Manager; `al-ai/entrypoint.sh` writes the service account to a file at start-up.
2. The task goes into the `ai` target group. Once `/ai/health` answers 200 (one pass is enough for a
   new task), the load balancer sends it `/ai/*` and the old task stops. A failed check in the first 2 minutes doesn't
   count, while the model loads.
3. If the new task keeps failing, the deployment circuit breaker rolls the service back to the last
   build that worked, by itself. `terraform apply` doesn't wait for any of this, so check (below).

`<commit>` must be a commit on `main` whose images the Images workflow has pushed (below). Use the
**full** commit id: that's the tag CI pushes, and ECR has no short-id tags. Both secrets must be filled
first ([Filling the al-ai secrets](#filling-the-al-ai-secrets)), or the task can't start.

Check it, a few minutes after the apply:

```sh
curl -i https://api.agentic-lender.com/ai/health   # 200 {"status":"ok"}, with an x-request-id header
open https://api.agentic-lender.com/ai/docs        # the API docs, in a browser, over HTTPS
```

Every request writes one JSON line to the `/agentic-lender/al-ai` log group (kept 14 days): its
request id, method, path, status, time taken and, on a crash, the error's class name. Only that line:
the agents' own INFO lines hold user ids and figures, so they stay out (`al-ai/app/request_log.py`),
and uvicorn adds its own stack trace when something crashes. To find a call, search the log group for the `x-request-id` from its response or error body
(Console: CloudWatch, then Log groups). A service that won't start shows why under ECS, then the
`agentic-lender` cluster, then the `al-ai` service, then Events.

**Run `./deploy/al down` when you've finished testing.** The task, the load balancer and the WAF are
billed by the hour: about EUR 17 a month for the al-ai task and EUR 3.50 for its public IP, on top of
the EUR 32 or so for the load balancer and WAF. `./deploy/al up` brings the same build back.

## Images

The deploy images are built by GitHub Actions (`.github/workflows/images.yml`), never by a laptop:

- **On a PR** that changes `al-ai/` or `al-core/`, it builds both images for ARM64 and pushes nothing.
  A Dockerfile that won't build on ARM fails the PR.
- **On every merge to `main`**, it builds both again and pushes them to ECR as
  `agentic-lender/al-ai:<commit>` and `agentic-lender/al-core:<commit>`, using the full commit id.
  That commit id is what `./deploy/al deploy` takes.

The workflow signs in as `agentic-lender-github-images` (`foundations/github-images-role.tf`), not the
deploy role. It trusts the same thing (a job on `main`) but may only push to the two registries, so a
build step can't reach anything else in the account.

ECR scans each image when it arrives (Console: ECR, then the repository, then the image). Tags can't
be overwritten, and each image is deleted 90 days after it was pushed, however many merges follow it.
So `./deploy/al up` can bring back the last build for up to 90 days after its merge: a build pushed
after 6 Oct 2026 is still there for the demo on 4 Jan 2027. Older than that, deploy a recent commit.

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

## The portal

The broker and underwriter portal (`al-web`) is served at <https://agentic-lender.com> by AWS
Amplify Hosting. `www.agentic-lender.com` redirects there. It lives in `foundations/`, because it
isn't billed by the hour, so `down` leaves it up.

- `foundations/portal.tf` makes the Amplify app, its one branch (`main`), the domain with a
  certificate Amplify issues and renews, the security headers, and the rewrite that sends every path
  that isn't a file to `/index.html`, so reloading a deep link works. Our zone is in this account, so
  Amplify writes its own Route 53 records.
- `foundations/github-portal-role.tf` makes `agentic-lender-github-portal`, the role the workflow
  uploads with. It trusts only `main` and can only deploy to this app.
- `.github/workflows/portal.yml` builds `al-web` on every PR that changes it, and uploads nothing. On
  a merge to `main` that changes `al-web/`, or when run by hand, it builds it again, uploads it and
  waits until Amplify says it's live. Amplify itself never builds anything and holds no GitHub token.

Floci has no Amplify, so on `-var target=floci` none of this is made.

The build gets only public settings. `VITE_API_BASE_URL`, `VITE_FIREBASE_PROJECT_ID` and
`VITE_FIREBASE_AUTH_DOMAIN` are written in the workflow. The Firebase web API key and app ID are
public too (they ship in the JavaScript), but they're kept in repository variables so the secret
scanner doesn't flag the key on every commit. Never put a key, service account or wallet value in a
`VITE_*` variable: everything in one ends up in the page.

### First time

Do these once, in order, signed in as in step 1 of "First time on the real account" below.

1. **Apply foundations.** In `deploy/foundations`, `terraform apply`. The plan adds the Amplify app,
   branch and domain, and the portal role and its policy. The apply waits until Amplify has found its
   proof record in our zone.
2. **Wait for the certificate.** Amplify issues it after the apply, usually within minutes (up to 24
   hours, AWS says). Repeat this until it prints `AVAILABLE`:
   ```sh
   aws amplify get-domain-association --app-id "$(terraform output -raw portal_app_id)" \
     --domain-name agentic-lender.com --query 'domainAssociation.domainStatus' --output text
   ```
3. **Set the two Firebase repository variables.** In the Firebase console, open the
   `agentic-lender-a0f1c` project, then Project settings, then General, then Your apps. Pick the web
   app (add one with the `</>` button if there's none) and copy `apiKey` and `appId` from its config:
   ```sh
   gh variable set VITE_FIREBASE_API_KEY --body '<apiKey>'
   gh variable set VITE_FIREBASE_APP_ID --body '<appId>'
   ```
   The build stops with an error if either is missing, rather than shipping a blank page.
4. **Upload it.** Merging the PR that adds the workflow runs it. Otherwise, or to upload again:
   `gh workflow run portal.yml --ref main`, then `gh run watch`.
5. **Allow sign-in from the domain.** In the Firebase console: Authentication, then Settings, then
   Authorized domains, then Add domain: `agentic-lender.com`. Firebase Auth refuses sign-ins from a
   domain that isn't on the list.
6. **Let the portal call the API.** al-ai and al-core accept browser calls only from
   `https://agentic-lender.com` (`CORS_ALLOWED_ORIGINS` in `app/ecs.tf`). That setting reaches the
   running tasks on the next `./deploy/al deploy <commit>`.
7. **Check it.** Open <https://agentic-lender.com>, sign in as a broker and an underwriter, open an
   application and reload the page. Then:
   ```sh
   curl -sI https://agentic-lender.com | grep -iE 'strict-transport|content-security|x-content-type|referrer'
   curl -sI https://www.agentic-lender.com | grep -iE '^(HTTP|location)'   # 301 to https://agentic-lender.com
   ```
   If a page breaks, the browser console names any request the Content-Security-Policy blocked. The
   policy is `portal_csp` in `foundations/portal.tf`; a change there needs `terraform apply` and then
   a new upload.

Before the domain works, `terraform output portal_default_url` gives Amplify's own address. Sign-in
there also needs that host on Firebase's authorized domains list.

## Practising on Floci

Floci is the AWS emulator on the PC. Nothing is billed and nothing reaches real AWS. The steps match
the real account's first run below, so practising them is a rehearsal.

```sh
ssh -f -N pc-aws                                              # open the tunnel (wakes the PC)
cd deploy/foundations
export TF_DATA_DIR=.terraform-floci                           # keeps Floci's files apart from the real account's
printf 'terraform {\n  backend "local" { path = "floci.tfstate" }\n}\n' > first_run_override.tf   # the bucket doesn't exist yet
terraform init && terraform apply -var target=floci -var 'alarm_emails=["you@example.com"]'   # Floci sends no email
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

The list is required: `terraform plan` and `apply` in `deploy/foundations` stop with an error when
the file is missing or empty, because an empty list would delete every subscription. A fresh checkout
doesn't have the file, so recreate it with every team address before the first plan.

Each address gets a "Confirm subscription" email from AWS and receives nothing until it's clicked.
Because the list is in foundations, `down` and `up` never make anyone confirm again. `app/` needs the
list to exist, so apply foundations first.

The budget alerts are separate (AL-224) and keep running while `app/` is down. The budget's kill
switch (`foundations/budget-kill-switch.tf`) emails the same list when it locks the deploy role at
100% of actual spend. It stops new deploys only: run `./deploy/al down` to stop what is already billing.

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
  --secret-string file://$HOME/al-ai-api-keys.json --query VersionId --output text &&
aws secretsmanager put-secret-value --secret-id agentic-lender/al-ai/firebase-service-account \
  --secret-string file://$HOME/al-ai-service-account.json --query VersionId --output text &&
rm ~/al-ai-api-keys.json ~/al-ai-service-account.json       # only once both uploads worked
```

To change a key later, run the same command with the new file. A task reads its secrets when it
starts, so redeploy for the change to reach al-ai.

## Filling the al-core secrets

`foundations/al-core-secrets.tf` makes al-core's three secrets empty, the same way. Fill them by hand,
signed in as yourself, with every file **outside the repo**. al-core reads every value as an
environment variable with the same name.

| Secret | Holds | Filled |
|---|---|---|
| `agentic-lender/al-core/keys` | `{"BORROWER_REF_SALT":"","STRIPE_SECRET_KEY":"","STRIPE_WEBHOOK_SECRET":""}` | now |
| `agentic-lender/al-core/chain-keys` | `{"CHAIN_MINTER_PRIVATE_KEY":"","CHAIN_REGISTRAR_PRIVATE_KEY":""}` | after the public-testnet deploy |
| `agentic-lender/al-core/firebase-service-account` | the service account JSON file from Firebase | now |

Filling a secret replaces its whole JSON, which is why the wallet keys have a secret of their own:
filling them later never touches the salt or the Stripe keys.

Nic makes the salt. Solomon sends the Stripe and wallet values as Bitwarden Sends, never in Slack or
Jira. This writes the keys file without showing anything: it makes a random salt, asks for the two
Stripe values with the typing hidden (paste each from the Send), and creates the file readable only
by you. It refuses to overwrite a file that's already there.

```sh
python3 -I -c '
import getpass, json, os, secrets, warnings
warnings.simplefilter("error", getpass.GetPassWarning)   # no terminal: stop rather than show the typing
keys = {"BORROWER_REF_SALT": secrets.token_hex(32)}
for name in ("STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"):
    keys[name] = getpass.getpass(name + ": ")
fd = os.open(os.path.expanduser("~/al-core-keys.json"), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
os.write(fd, json.dumps(keys).encode())
os.close(fd)'
```

The Firebase key is al-core's own, not a copy of al-ai's: in the Firebase console go to Project
settings, then Service accounts, then Generate new private key, the same page al-ai's came from. So
either key can be revoked without breaking the other service. ECS hands it to the container as
`FIREBASE_SERVICE_ACCOUNT_JSON`.

```sh
mv ~/Downloads/<the-downloaded-key>.json ~/al-core-service-account.json   # outside the repo
chmod 600 ~/al-core-service-account.json                                   # readable only by you
```

Then upload both. Each `&&` means the next step runs only if the one before worked, so if an upload
fails the files stay put (the salt exists nowhere else yet) and you can run it again.

```sh
aws secretsmanager put-secret-value --secret-id agentic-lender/al-core/keys \
  --secret-string file://$HOME/al-core-keys.json --query VersionId --output text &&
aws secretsmanager put-secret-value --secret-id agentic-lender/al-core/firebase-service-account \
  --secret-string file://$HOME/al-core-service-account.json --query VersionId --output text &&
rm ~/al-core-keys.json ~/al-core-service-account.json       # only once both uploads worked
```

`--query VersionId --output text` prints only the new version's id, so nothing about the secret
lands on screen.

When the wallet keys arrive after the testnet deploy, the same way for `chain-keys`:

```sh
python3 -I -c '
import getpass, json, os, warnings
warnings.simplefilter("error", getpass.GetPassWarning)   # no terminal: stop rather than show the typing
keys = {name: getpass.getpass(name + ": ") for name in ("CHAIN_MINTER_PRIVATE_KEY", "CHAIN_REGISTRAR_PRIVATE_KEY")}
fd = os.open(os.path.expanduser("~/al-core-chain-keys.json"), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
os.write(fd, json.dumps(keys).encode())
os.close(fd)'
aws secretsmanager put-secret-value --secret-id agentic-lender/al-core/chain-keys \
  --secret-string file://$HOME/al-core-chain-keys.json --query VersionId --output text &&
rm ~/al-core-chain-keys.json                                 # only once the upload worked
```

Redeploy after any fill so al-core reads the new values. Changing a wallet key or the Firebase key
later is the same command again. Keep the salt as it is: a new one would give the same borrower a
different reference on new loan notes. So a Stripe key that changes later is edited on its own in
the console (Secrets Manager, the `keys` secret, Retrieve secret value, Edit), which leaves the salt
alone; a new file from the one-liner would make a new salt.

## Who can read the secrets

Only Nic's own login can fill or change a secret: the guardrails boundary stops the deploy role and
every app role from reading, changing, copying to another Region or deleting any `agentic-lender/*`
secret. The one exception is reading: al-ai's execution role may read al-ai's secrets, and al-core's
execution role al-core's. Neither may read the other's, and no other role may read any.

One limit, accepted on purpose: the deploy role deploys both services, so it could start a task that
prints the keys ECS hands it, or one that runs as an execution role. The boundary blocks every direct
way to the keys; anyone who can deploy the app (a run on `main`) is still trusted with them.

## Roles the app needs

The deploy role works under a permissions boundary (`foundations/guardrails.tf`) and can't create or
change any IAM role or policy: a role made from inside could trust an outsider and become a way in.
So a role the app needs goes in `foundations/` and Nic applies it. It must:

- be named `agentic-lender-app-...`, the only names the deploy role may hand to a service (PassRole)
- set `permissions_boundary` to the `guardrails_boundary_arn` output

`deploy/app` then refers to it by name.

Each service has two, in `foundations/al-ai-roles.tf` and `foundations/al-core-roles.tf`:

| Role | Used by | May do |
|---|---|---|
| `agentic-lender-app-al-ai-execution` | ECS, to start a task and forward its logs | sign in to ECR and pull the al-ai image, read al-ai's two secrets, write to the `/agentic-lender/al-ai` log group |
| `agentic-lender-app-al-ai-task` | al-ai's code, while it runs | call Qwen3 32B (`qwen.qwen3-32b-v1:0`) on Bedrock in eu-west-1, nothing else |
| `agentic-lender-app-al-core-execution` | ECS, to start a task and forward its logs | sign in to ECR and pull the al-core image, read al-core's three secrets, write to the `/agentic-lender/al-core` log group |
| `agentic-lender-app-al-core-task` | al-core's code, while it runs | nothing: al-core makes no AWS calls. A permission it needs later is added in `al-core-roles.tf` |

So reading the secrets and writing logs is the execution role's job, done by ECS rather than by
the service's code; al-ai's code can only reach Bedrock, and al-core's can reach nothing on AWS. All
four trust only ECS tasks in this account (`foundations/ecs-trust.tf`). Their ARNs are the
`al_ai_execution_role_arn`, `al_ai_task_role_arn`, `al_core_execution_role_arn` and
`al_core_task_role_arn` outputs.

The boundary also shuts off CloudFormation, CodeBuild and SSM
Run Command, and the deploy role can't write anything under `foundations/` in the state bucket.

Both folders refuse to run against any account but the team's (`team_account_id`), and so does `al`.
