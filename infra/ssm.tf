locals {
  parameter_prefix = "/tutorlink/prod"
  postgres_name    = "tutorlink"

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

resource "aws_ssm_parameter" "site_address" {
  name  = "${local.parameter_prefix}/SITE_ADDRESS"
  type  = "String"
  value = local.site_address
}
