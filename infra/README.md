# TutorLink production infrastructure

Everything TutorLink needs to run on one EC2 instance in `us-east-1`: the default VPC's subnet in
one AZ, a security group (80/443 TCP and 443 UDP in, no SSH), an Amazon Linux 2023 instance with
Docker and the Compose plugin, a persistent encrypted data volume mounted at `/srv/tutorlink`, an
Elastic IP, a private encrypted Amazon RDS PostgreSQL 17 instance (`db.t4g.micro`, single-AZ in
the instance's AZ, TLS required, 7-day backups, deletion protection) behind a `tutorlink-db`
security group that allows only 5432/TCP from the app security group, the `tutorlink-api` and
`tutorlink-web` ECR repositories, app secrets in SSM Parameter Store under `/tutorlink/prod/`
(including the database's full connection string as the `DATABASE_URL` SecureString), and a
GitHub OIDC role the deploy workflow assumes. Every
resource is tagged `Project=tutorlink`, `Environment=prod`, `ManagedBy=terraform`.

State lives in the S3 bucket created by [`bootstrap/`](bootstrap/README.md); apply that first.

## Usage

It uses the default AWS credential chain, so `AWS_PROFILE` works if set. Check your credentials
with `aws sts get-caller-identity` first.

```sh
terraform init
terraform plan
terraform apply
```

After the first apply the instance installs Docker, formats and mounts the data volume (only if
it has no filesystem yet), and waits for its first deploy.

Changing the user_data script replaces the instance. Terraform stops the old instance before it
detaches the data volume, then attaches the volume to the new instance and re-associates the
Elastic IP, so the data and the site address stay the same. Run the deploy workflow again
afterwards, because the new instance starts with no containers.

The data volume has `prevent_destroy`: it holds the only copy of the database (there are no
backups yet), so Terraform refuses any plan that would delete it.

## Variables

| Name | Default | Purpose |
| --- | --- | --- |
| `region` | `us-east-1` | Region for everything. |
| `instance_type` | `t3.micro` | EC2 instance type. |
| `data_volume_size_gb` | `5` | Size of the data volume. Can be grown later (apply, then `sudo xfs_growfs /srv/tutorlink`), never shrunk. |
| `db_instance_class` | `db.t4g.micro` | RDS instance class. |
| `db_allocated_storage_gb` | `20` | RDS gp3 storage in GB. Can be grown later, never shrunk. |
| `domain` | `null` | Real hostname; when null the site uses `<ip-with-dashes>.sslip.io`. |
| `github_repo` | `Siraneves@313945357/TutorLink@1325618027` | Repository allowed to assume the deploy role, in GitHub's immutable `owner@id/repo@id` subject format. |
| `github_deploy_ref` | `refs/heads/main` | Git ref whose workflow runs may deploy. |

## Outputs

| Output | Used for |
| --- | --- |
| `public_ip` | The Elastic IP; the DNS A record target when you use a real domain. |
| `site_address` | Hostname Caddy serves and requests a certificate for. |
| `site_url` | GitHub variable `SITE_URL`; the deploy polls `<site_url>/health/ready`. |
| `instance_id` | Target for SSM shell sessions. Not a GitHub variable: the deploy workflow finds the running instance tagged `Project=tutorlink`, `Environment=prod`. |
| `db_address` | Private hostname of the RDS database. The full connection string is the `DATABASE_URL` parameter. |
| `ecr_api_repo_url` | GitHub variable `ECR_API_REPO`. |
| `ecr_web_repo_url` | GitHub variable `ECR_WEB_REPO`. |
| `deploy_role_arn` | GitHub variable `AWS_DEPLOY_ROLE_ARN`. |
| `region` | GitHub variable `AWS_REGION`. |

## Who can deploy

The deploy role trusts only workflow runs on `main` of `Siraneves/TutorLink`, with the OIDC
subject `repo:Siraneves@313945357/TutorLink@1325618027:ref:refs/heads/main`; a run from any other
branch can't assume it. The repository uses GitHub's immutable subject format (owner and repo
names with their numeric IDs), so a renamed or recreated repo doesn't inherit the trust. Check
the prefix with:

```sh
gh api repos/Siraneves/TutorLink/actions/oidc/customization/sub
```

If `sub_claim_prefix` ever changes, set `github_repo` to it without the leading `repo:`.
It trusts a branch rather than a GitHub environment because environments aren't available for
private repositories on the org's GitHub Free plan.

## Opening a shell

There is no SSH. Use SSM Session Manager (needs the
[Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)):

```sh
aws ssm start-session --target "$(terraform output -raw instance_id)"
```

The app lives in `/srv/tutorlink/app/` on the instance.

## Switching to a real domain

1. Set `domain`, e.g. in a `terraform.tfvars` (gitignored): `domain = "app.example.com"`.
2. Add a DNS A record for that hostname pointing at `terraform output -raw public_ip`.
3. `terraform apply` (updates the `SITE_ADDRESS` parameter and the `site_url` output).
4. Update the `SITE_URL` GitHub variable and run the deploy workflow again, so Caddy picks up the
   new hostname and requests its certificate.
