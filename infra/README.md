# TutorLink production infrastructure

Everything TutorLink needs to run on one EC2 instance in `us-east-1`: the default VPC's subnet in
one AZ, a security group (80/443 TCP and 443 UDP in, no SSH), an Amazon Linux 2023 instance with
Docker and the Compose plugin, a persistent encrypted data volume mounted at `/srv/tutorlink`, an
Elastic IP, the `tutorlink-api` and `tutorlink-web` ECR repositories, app secrets in SSM Parameter
Store under `/tutorlink/prod/`, and a GitHub OIDC role the deploy workflow assumes. Every
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
| `domain` | `null` | Real hostname; when null the site uses `<ip-with-dashes>.sslip.io`. |
| `github_repo` | `Siraneves/TutorLink` | Repository allowed to assume the deploy role. |
| `github_deploy_environment` | `production` | GitHub environment allowed to deploy. |

## Outputs

| Output | Used for |
| --- | --- |
| `public_ip` | The Elastic IP; the DNS A record target when you use a real domain. |
| `site_address` | Hostname Caddy serves and requests a certificate for. |
| `site_url` | GitHub variable `SITE_URL`; the deploy polls `<site_url>/health/ready`. |
| `instance_id` | GitHub variable `EC2_INSTANCE_ID`; also the target for SSM shell sessions. |
| `ecr_api_repo_url` | GitHub variable `ECR_API_REPO`. |
| `ecr_web_repo_url` | GitHub variable `ECR_WEB_REPO`. |
| `deploy_role_arn` | GitHub variable `AWS_DEPLOY_ROLE_ARN`. |
| `region` | GitHub variable `AWS_REGION`. |

## GitHub environment

The deploy role trusts only jobs running in the repository's `production` GitHub environment
(OIDC subject `repo:Siraneves/TutorLink:environment:production`). Create that environment under
the repository's Settings > Environments before the first deploy, and restrict it to the `main`
branch (and add required reviewers if you want a manual gate). A job without
`environment: production` can't assume the role.

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
