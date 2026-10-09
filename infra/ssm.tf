locals {
  parameter_prefix = "/tutorlink/prod"
  postgres_name    = "tutorlink"

  # Contract with deploy/remote-deploy.sh, which treats this value as "not set".
  unset_placeholder = "unset"

  # Without a real domain, sslip.io resolves <a-b-c-d>.sslip.io to the Elastic IP.
  site_address = var.domain != null ? var.domain : "${replace(aws_eip.app.public_ip, ".", "-")}.sslip.io"
}

resource "random_password" "secret_key" {
  length  = 64
  special = false
}

# No special characters: the password is embedded in DATABASE_URL.
resource "random_password" "postgres" {
  length  = 32
  special = false
}

resource "aws_ssm_parameter" "secret_key" {
  name  = "${local.parameter_prefix}/SECRET_KEY"
  type  = "SecureString"
  value = random_password.secret_key.result
}

resource "aws_ssm_parameter" "postgres_password" {
  name  = "${local.parameter_prefix}/POSTGRES_PASSWORD"
  type  = "SecureString"
  value = random_password.postgres.result
}

resource "aws_ssm_parameter" "postgres_user" {
  name  = "${local.parameter_prefix}/POSTGRES_USER"
  type  = "String"
  value = local.postgres_name
}

resource "aws_ssm_parameter" "postgres_db" {
  name  = "${local.parameter_prefix}/POSTGRES_DB"
  type  = "String"
  value = local.postgres_name
}

# sslmode=require reaches psycopg through the URL, and RDS refuses non-TLS connections anyway.
resource "aws_ssm_parameter" "database_url" {
  name  = "${local.parameter_prefix}/DATABASE_URL"
  type  = "SecureString"
  value = "postgresql+psycopg://${local.db_username}:${random_password.db.result}@${aws_db_instance.app.address}:${local.db_port}/${local.db_name}?sslmode=require"
}

resource "aws_ssm_parameter" "site_address" {
  name  = "${local.parameter_prefix}/SITE_ADDRESS"
  type  = "String"
  value = local.site_address
}

# Bot configuration. The value is write-only (value_wo): it never enters state, so real secrets stay
# out of Terraform and Franklin owns them. Terraform only creates each parameter with the placeholder
# and never rewrites it unless value_wo_version changes. Set the real value with:
#   aws ssm put-parameter --name <name> --type <type> --value <value> --overwrite
resource "aws_ssm_parameter" "twilio_account_sid" {
  name             = "${local.parameter_prefix}/TWILIO_ACCOUNT_SID"
  type             = "SecureString"
  value_wo         = local.unset_placeholder
  value_wo_version = 1
}

resource "aws_ssm_parameter" "twilio_auth_token" {
  name             = "${local.parameter_prefix}/TWILIO_AUTH_TOKEN"
  type             = "SecureString"
  value_wo         = local.unset_placeholder
  value_wo_version = 1
}

resource "aws_ssm_parameter" "anthropic_api_key" {
  name             = "${local.parameter_prefix}/ANTHROPIC_API_KEY"
  type             = "SecureString"
  value_wo         = local.unset_placeholder
  value_wo_version = 1
}

resource "aws_ssm_parameter" "twilio_whatsapp_number" {
  name             = "${local.parameter_prefix}/TWILIO_WHATSAPP_NUMBER"
  type             = "String"
  value_wo         = local.unset_placeholder
  value_wo_version = 1
}

# Outbound mail (invites, password resets), same write-only placeholder pattern as the bot's. Ship
# with a real mailbox's SMTP (a Gmail/Workspace app password); once #34 picks the domain, switch
# to SES over SMTP with domain DKIM by changing these parameters only. The five are all-or-nothing
# in deploy/remote-deploy.sh; PUBLIC_BASE_URL is derived there from SITE_ADDRESS, not stored.
resource "aws_ssm_parameter" "smtp_host" {
  name             = "${local.parameter_prefix}/SMTP_HOST"
  type             = "String"
  value_wo         = local.unset_placeholder
  value_wo_version = 1
}

resource "aws_ssm_parameter" "smtp_port" {
  name             = "${local.parameter_prefix}/SMTP_PORT"
  type             = "String"
  value_wo         = local.unset_placeholder
  value_wo_version = 1
}

resource "aws_ssm_parameter" "smtp_username" {
  name             = "${local.parameter_prefix}/SMTP_USERNAME"
  type             = "String"
  value_wo         = local.unset_placeholder
  value_wo_version = 1
}

resource "aws_ssm_parameter" "smtp_password" {
  name             = "${local.parameter_prefix}/SMTP_PASSWORD"
  type             = "SecureString"
  value_wo         = local.unset_placeholder
  value_wo_version = 1
}

resource "aws_ssm_parameter" "mail_from" {
  name             = "${local.parameter_prefix}/MAIL_FROM"
  type             = "String"
  value_wo         = local.unset_placeholder
  value_wo_version = 1
}
