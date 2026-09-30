output "public_ip" {
  description = "Elastic IP of the host; point a domain's DNS A record here."
  value       = aws_eip.app.public_ip
}

output "site_address" {
  description = "Hostname Caddy serves and gets a certificate for (the domain, or the sslip.io name)."
  value       = local.site_address
}

output "site_url" {
  description = "Public URL of the site (GitHub variable SITE_URL)."
  value       = "https://${local.site_address}"
}

output "instance_id" {
  description = "EC2 instance ID, for SSM sessions and deploy commands (GitHub variable EC2_INSTANCE_ID)."
  value       = aws_instance.app.id
}

output "ecr_api_repo_url" {
  description = "ECR repository URL for the API image (GitHub variable ECR_API_REPO)."
  value       = aws_ecr_repository.app["api"].repository_url
}

output "ecr_web_repo_url" {
  description = "ECR repository URL for the web image (GitHub variable ECR_WEB_REPO)."
  value       = aws_ecr_repository.app["web"].repository_url
}

output "deploy_role_arn" {
  description = "IAM role the GitHub deploy workflow assumes through OIDC (GitHub variable AWS_DEPLOY_ROLE_ARN)."
  value       = aws_iam_role.deploy.arn
}

output "region" {
  description = "AWS region everything lives in (GitHub variable AWS_REGION)."
  value       = var.region
}
