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

Floci is the AWS emulator on the PC. Nothing is billed and nothing reaches real AWS.

```sh
ssh -f -N pc-aws                                              # open the tunnel (wakes the PC)
cd deploy/foundations
terraform init -backend-config=../backend-floci.hcl
terraform plan -var target=floci                              # then apply
cd ../.. && ./deploy/al deploy 3166a3b --floci
```

The Floci console is at <http://localhost:4566/_floci/ui>.

## First time on the real account

Do these steps once, in order. Budget alerts (AL-224) must exist before step 2.

1. **Sign in.** `aws login --profile agentic-lender`, then `aws sts get-caller-identity --profile agentic-lender`.
2. **Bucket, role and zone, with the state on the laptop at first.** The bucket doesn't exist yet,
   so a temporary override file tells Terraform to keep the state locally for this one run. Terraform
   reads any file ending in `_override.tf` last, and its settings win. In `deploy/foundations`:
   ```sh
   printf 'terraform {\n  backend "local" {}\n}\n' > first_run_override.tf
   terraform init
   terraform apply -target=aws_s3_bucket.state -target=aws_route53_zone.main -target=aws_iam_role.github_deploy
   ```
   The certificate waits until step 3 is done.
3. **Point the domain at the zone.** Run `terraform output name_servers`. In Nic's personal AWS
   account go to Route 53, then Registered domains, then agentic-lender.com, then Edit name servers.
   Paste the four, save, and check with `dig NS agentic-lender.com +short` until they show.
4. **Everything else, including the certificate.** `terraform apply`. It waits until ACM sees the
   validation record, which is up to 45 minutes.
5. **Move the state into the bucket.** Delete the override, then:
   ```sh
   rm first_run_override.tf
   terraform init -migrate-state -backend-config=../backend-aws.hcl \
     -backend-config="bucket=$(terraform output -raw state_bucket)"
   ```
6. **Tidy up.** Delete the old hosted zone that registration created in the personal account. It's
   unused once step 3 is live, and it costs USD 0.50 a month.
