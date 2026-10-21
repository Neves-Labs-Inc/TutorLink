locals {
  parameter_prefix = "/tutorlink/prod"

  # Contract with deploy/remote-deploy.sh, which treats this value as "not set".
  unset_placeholder = "unset"

  # Without a real domain, sslip.io resolves <a-b-c-d>.sslip.io to the Elastic IP. Null before
  # apply 2 adopts the address.
  sslip_address = one([for address in aws_eip.app : "${replace(address.public_ip, ".", "-")}.sslip.io"])
  site_address  = var.domain != null ? var.domain : local.sslip_address
}

# Franklin sets these two by hand, so neither value is ever in state. DATABASE_URL is the
# connection string from neves-labs-pg; SECRET_KEY is the existing key copied over so nobody is
# logged out. The deploy script refuses to deploy while either still holds the placeholder. Set
# each with `aws ssm put-parameter --cli-input-json file://<private file>`, never `--value` (see
# infra/README.md, Parameters).
resource "aws_ssm_parameter" "secret_key" {
  name             = "${local.parameter_prefix}/SECRET_KEY"
  type             = "SecureString"
  value_wo         = local.unset_placeholder
  value_wo_version = 1
}

resource "aws_ssm_parameter" "database_url" {
  name             = "${local.parameter_prefix}/DATABASE_URL"
  type             = "SecureString"
  value_wo         = local.unset_placeholder
  value_wo_version = 1
}

# Absent until there's an address to serve, so a deploy before apply 2 finds no SITE_ADDRESS.
resource "aws_ssm_parameter" "site_address" {
  count = local.site_address == null ? 0 : 1

  name  = "${local.parameter_prefix}/SITE_ADDRESS"
  type  = "String"
  value = local.site_address
}

# Bot configuration. The value is write-only (value_wo): it never enters state, so real secrets stay
# out of Terraform and Franklin owns them. Terraform only creates each parameter with the placeholder
# and never rewrites it unless value_wo_version changes. Set the real value as for the two above.
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
