# TutorLink production infrastructure

Everything TutorLink needs to run on one EC2 instance in `us-east-1`, in the tutorlink-prod account
(046451670022). Both roots (`infra/` and `bootstrap/`) set `allowed_account_ids`, so an apply with
the wrong `AWS_PROFILE` fails instead of building somewhere else.

- **Network:** its own VPC `10.20.0.0/16` with one public subnet `10.20.0.0/24` in availability zone
  ID `use1-az1` (the zone `neves-labs-pg` is in), an internet gateway and a route table. There is no
  NAT gateway: the host reaches the internet through its public address.
- **Peering:** a request to the shared Neves-Labs VPC, with a route for `10.10.0.0/16` through it.
  The database, `neves-labs-pg`, lives in Neves-Labs-Infra. There is no RDS here.
- **Host:** a security group (80/443 TCP and 443 UDP in, no SSH), an Amazon Linux 2023 instance with
  Docker and the Compose plugin, and a persistent encrypted data volume mounted at `/srv/tutorlink`
  (Caddy's certificates and the deploy files).
- **Elastic IP:** the existing address, transferred in during the cutover and adopted through
  `elastic_ip_allocation_id`, so the sslip.io site URL never changes.
- **Secrets:** app settings in SSM Parameter Store under `/tutorlink/prod/`. `DATABASE_URL`,
  `SECRET_KEY` and the bot and mail settings are write-only: Terraform creates each with the
  placeholder `unset` and never holds the real value in state. You set them by hand.
- **Other:** the `tutorlink-api` and `tutorlink-web` ECR repositories and a GitHub OIDC role the
  deploy workflow assumes. Every resource is tagged `Project=tutorlink`, `Environment=prod`,
  `ManagedBy=terraform`.

The cross-account cutover (peering, secrets, Elastic IP transfer, rollback) is in
[`database/RUNBOOK.md`](https://github.com/Neves-Labs-Inc/Neves-Labs-Infra/blob/main/database/RUNBOOK.md)
in Neves-Labs-Infra. This file covers operating the stack.

## Usage

Two accounts and two checkouts are involved, and every command below says which one it uses, the
same way Neves-Labs-Infra's `database/RUNBOOK.md` does:

- **TutorLink commands** run from the TutorLink repo root, in tutorlink-prod, through the
  `tutorlink-prod` profile (set up as in the Neves-Labs-Infra README's `~/.aws/config` section):
  `AWS_PROFILE=tutorlink-prod terraform -chdir=infra ...` and `aws ... --profile tutorlink-prod`.
- **Neves-Labs-Infra commands** (`network/`, `database/`) run from the Neves-Labs-Infra repo root,
  with the management account as the default profile. Those roots assume
  `OrganizationAccountAccessRole` in Neves-Labs (277396470866), which only the management account
  can do, so they are written `env -u AWS_PROFILE terraform -chdir=...`: a leftover
  `AWS_PROFILE=tutorlink-prod` in the shell would make them fail.

Check the profile first; the `Account` must be 046451670022:

```sh
aws sts get-caller-identity --profile tutorlink-prod
```

1. Run [`bootstrap/`](bootstrap/README.md) first, in tutorlink-prod only (it refuses other accounts). It
   creates the state bucket `tutorlink-tfstate-046451670022` and keeps its own state locally:

   ```sh
   AWS_PROFILE=tutorlink-prod terraform -chdir=infra/bootstrap init
   AWS_PROFILE=tutorlink-prod terraform -chdir=infra/bootstrap apply
   ```

2. Initialize `infra/` with `-reconfigure`:

   ```sh
   AWS_PROFILE=tutorlink-prod terraform -chdir=infra init -reconfigure
   ```

   **Never answer "yes" to a migrate prompt, and never run a plain `terraform init` over an old
   `.terraform/` directory.** The backend moved from the management account to the new bucket.
   Migrating would copy the old state, with the old database passwords and the live `SECRET_KEY`,
   into tutorlink-prod. If `infra/.terraform/` exists from before the move, `-reconfigure` is
   enough; deleting the directory first also works. The old state, with those secrets, still sits in
   the management-account bucket until Neves-Labs-Infra#5 cleans it up, so treat access to that bucket
   as access to the database and app secrets.
3. Plan and apply:

   ```sh
   AWS_PROFILE=tutorlink-prod terraform -chdir=infra plan
   AWS_PROFILE=tutorlink-prod terraform -chdir=infra apply
   ```

After the first apply the instance installs Docker, formats and mounts the data volume (only if
it has no filesystem yet), and waits for its first deploy.

Changing the user_data script replaces the instance. Terraform stops the old instance before it
detaches the data volume, then attaches the volume to the new instance and re-associates the
Elastic IP, so the data and the site address stay the same. Run the deploy workflow again
afterwards, because the new instance starts with no containers.

The data volume holds only Caddy's certificates and the deploy files, and the database is on
`neves-labs-pg`. It no longer has `prevent_destroy`, so a plan can replace it. Caddy requests new
certificates after a replacement.

## Peering to the shared network

The apply creates a pending peering request to the shared VPC (`vpc-07716890a00dbcb5b`, owner
277396470866). The route to it stays a blackhole until the request is accepted. To finish:

1. In the TutorLink checkout, copy the connection ID:

   ```sh
   AWS_PROFILE=tutorlink-prod terraform -chdir=infra output -raw peering_connection_id
   ```

2. In the Neves-Labs-Infra checkout, put it in the tutorlink-prod entry of `client_peerings`
   (`network/variables.tf`) as `peering_connection_id`. Then plan and apply `network/` with the
   management account (default profile), as in the Neves-Labs-Infra README's Network section. Read
   the plan before applying:

   ```sh
   env -u AWS_PROFILE terraform -chdir=network init
   env -u AWS_PROFILE terraform -chdir=network plan
   env -u AWS_PROFILE terraform -chdir=network apply
   ```

   That accepts the request, adds the return route and opens 5432 from `10.20.0.0/24`.

An unaccepted request expires after 7 days. Apply `infra/` again in TutorLink to create a new one,
then repeat both steps with the new `peering_connection_id`: `network/` still holds the old, expired
ID until you paste the new one over it.

## Parameters

These parameters are created by Terraform with the placeholder `unset` and are write-only (never in
state): `DATABASE_URL`, `SECRET_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`TWILIO_WHATSAPP_NUMBER`, `ANTHROPIC_API_KEY`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`,
`SMTP_PASSWORD` and `MAIL_FROM`. `SITE_ADDRESS` is a plain parameter that exists only once the
Elastic IP is adopted (or `domain` is set).

`DATABASE_URL` and `SECRET_KEY` are required: a deploy fails, naming the parameter, while either one
(or `SITE_ADDRESS`) is missing or still `unset`. The bot and mail groups are optional but
all-or-nothing within each group.

Never put a value on the command line or type it into a heredoc: shells save both in history. Build
it from Terraform outputs, or read it silently, into a private temporary directory, pass it with
`--cli-input-json`, and delete it. Run this from the Neves-Labs-Infra repo root. The
`terraform output` calls read `database/` with the management account (default profile; the root
assumes `OrganizationAccountAccessRole` in Neves-Labs), so `AWS_PROFILE` is cleared for them. The
`aws ssm` call writes to tutorlink-prod with `--profile tutorlink-prod`:

```sh
umask 077
PARAM_DIR="$(mktemp -d)"
PG_ADDRESS="$(env -u AWS_PROFILE terraform -chdir=database output -raw address)"
env -u AWS_PROFILE terraform -chdir=database output -json client_passwords | jq -r .tutorlink \
  | jq -Rj --arg host "$PG_ADDRESS" '{Name: "/tutorlink/prod/DATABASE_URL", Type: "SecureString",
      Overwrite: true, Value: "postgresql+psycopg://tutorlink:\(.)@\($host):5432/tutorlink?sslmode=require"}' \
  > "$PARAM_DIR/parameter.json"
aws ssm put-parameter --profile tutorlink-prod --cli-input-json "file://$PARAM_DIR/parameter.json" \
  --query Version --output text
rm -rf "$PARAM_DIR"
```

The format is `postgresql+psycopg://tutorlink:<pw>@<neves-labs-pg address>:5432/tutorlink?sslmode=require`.

For a value you only have by hand (bot or mail settings), read it silently so it skips history. Replace
`<NAME>`, and use `"Type": "String"` for `TWILIO_WHATSAPP_NUMBER`, `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USERNAME` and `MAIL_FROM`. It works in bash and zsh, from any directory, and writes to
tutorlink-prod with `--profile tutorlink-prod`:

```sh
umask 077
PARAM_DIR="$(mktemp -d)"
printf 'Value: '; IFS= read -rs value; echo
printf '%s' "$value" | jq -Rj '{Name: "/tutorlink/prod/<NAME>", Type: "SecureString", Overwrite: true, Value: .}' \
  > "$PARAM_DIR/parameter.json"
unset value
aws ssm put-parameter --profile tutorlink-prod --cli-input-json "file://$PARAM_DIR/parameter.json" \
  --query Version --output text
rm -rf "$PARAM_DIR"
```

`SECRET_KEY` is copied from the old account by the loop in Neves-Labs-Infra's `database/RUNBOOK.md`;
don't retype it.

## Elastic IP

The address is transferred in from the management account during the cutover window, so it can't
exist at apply 1. `elastic_ip_allocation_id` makes the two applies plain applies:

1. **Apply 1** (variable null): no Elastic IP, no association, no `SITE_ADDRESS` parameter.
   `public_ip`, `site_address` and `site_url` are null.
2. **Apply 2** (after the transfer is accepted): set `elastic_ip_allocation_id` to the new
   allocation ID, then run `AWS_PROFILE=tutorlink-prod terraform -chdir=infra apply`. An `import`
   block adopts the address, and the association and `SITE_ADDRESS` are created.

The cutover is done, so the variable's default is now the transferred address,
`eipalloc-0f1a4ca7010c7fba3` (52.87.65.127). A plain apply keeps it; there's nothing to pass.

The address has `prevent_destroy`, because a released address can't be recovered and the site URL
is built from it. **Never set the variable back to null to remove it:** the plan fails on purpose,
and a destroy would release the address. To drop it from Terraform (rollback), remove the
association and the address from state instead:

```sh
AWS_PROFILE=tutorlink-prod terraform -chdir=infra state rm 'aws_eip_association.app[0]' 'aws_eip.app[0]'
```

The transfer steps, the order around the deploy and the rollback are in Neves-Labs-Infra's
`database/RUNBOOK.md`.

## Variables

| Name | Default | Purpose |
| --- | --- | --- |
| `region` | `us-east-1` | Region for everything. |
| `instance_type` | `t3.micro` | EC2 instance type. It must be offered in `use1-az1`. |
| `data_volume_size_gb` | `5` | Size of the data volume (Caddy certificates and deploy files). Can be grown later (apply, then `sudo xfs_growfs /srv/tutorlink` in a shell on the instance), never shrunk. |
| `domain` | `null` | Real hostname; when null the site uses `<ip-with-dashes>.sslip.io`. |
| `elastic_ip_allocation_id` | `eipalloc-0f1a4ca7010c7fba3` | Allocation ID of the site's transferred Elastic IP (52.87.65.127). See [Elastic IP](#elastic-ip). |
| `github_repo` | `Neves-Labs-Inc@313945357/TutorLink@1325618027` | Repository allowed to assume the deploy role, in GitHub's immutable `owner@id/repo@id` subject format. |
| `github_deploy_ref` | `refs/heads/main` | Git ref whose workflow runs may deploy. |

## Outputs

| Output | Used for |
| --- | --- |
| `public_ip` | The Elastic IP; the DNS A record target when you use a real domain. Null until the address is adopted (apply 2). |
| `site_address` | Hostname Caddy serves and requests a certificate for. Null until apply 2, unless `domain` is set. |
| `site_url` | GitHub variable `SITE_URL`; the deploy polls `<site_url>/health/ready`. Null until apply 2, unless `domain` is set. |
| `instance_id` | Target for SSM shell sessions. Not a GitHub variable: the deploy workflow finds the running instance tagged `Project=tutorlink`, `Environment=prod`. |
| `peering_connection_id` | The peering request to the shared VPC; goes in Neves-Labs-Infra `network/` `client_peerings`. |
| `ecr_api_repo_url` | GitHub variable `ECR_API_REPO`. |
| `ecr_web_repo_url` | GitHub variable `ECR_WEB_REPO`. |
| `deploy_role_arn` | GitHub variable `AWS_DEPLOY_ROLE_ARN`. |
| `region` | GitHub variable `AWS_REGION`. |

## Who can deploy

The deploy role trusts only workflow runs on `main` of `Neves-Labs-Inc/TutorLink`, with the OIDC
subject `repo:Neves-Labs-Inc@313945357/TutorLink@1325618027:ref:refs/heads/main`; a run from any other
branch can't assume it. The repository uses GitHub's immutable subject format (owner and repo
names with their numeric IDs), so a renamed or recreated repo doesn't inherit the trust. Check
the prefix with:

```sh
gh api repos/Neves-Labs-Inc/TutorLink/actions/oidc/customization/sub
```

If `sub_claim_prefix` ever changes, set `github_repo` to it without the leading `repo:`.
It trusts a branch rather than a GitHub environment because environments aren't available for
private repositories on the org's GitHub Free plan.

## Opening a shell

There is no SSH. Use SSM Session Manager (needs the
[Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)):

```sh
aws ssm start-session --profile tutorlink-prod \
  --target "$(AWS_PROFILE=tutorlink-prod terraform -chdir=infra output -raw instance_id)"
```

The app lives in `/srv/tutorlink/app/` on the instance.

## Switching to a real domain

1. Set `domain`, e.g. in `infra/terraform.tfvars` (gitignored): `domain = "app.example.com"`.
2. Add a DNS A record for that hostname pointing at
   `AWS_PROFILE=tutorlink-prod terraform -chdir=infra output -raw public_ip`.
3. `AWS_PROFILE=tutorlink-prod terraform -chdir=infra apply` (updates the `SITE_ADDRESS` parameter
   and the `site_url` output).
4. Update the `SITE_URL` GitHub variable and run the deploy workflow again, so Caddy picks up the
   new hostname and requests its certificate.
