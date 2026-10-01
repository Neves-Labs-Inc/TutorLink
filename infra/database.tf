locals {
  db_name     = "tutorlink"
  db_username = "tutorlink"
  db_port     = 5432
}

# No special characters: the password is embedded in DATABASE_URL without URL-encoding.
resource "random_password" "db" {
  length  = 32
  special = false
}

# RDS requires a subnet group spanning at least two AZs, even for a single-AZ instance.
data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }

  filter {
    name   = "default-for-az"
    values = ["true"]
  }
}

resource "aws_db_subnet_group" "app" {
  name        = "tutorlink"
  description = "TutorLink RDS: the default VPC's default subnets."
  subnet_ids  = data.aws_subnets.default.ids
}

resource "aws_db_parameter_group" "app" {
  name        = "tutorlink-postgres17"
  description = "TutorLink RDS: TLS required on every connection."
  family      = "postgres17"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
}

# No egress rules: the database only answers connections, it never opens any.
resource "aws_security_group" "db" {
  name        = "tutorlink-db"
  description = "TutorLink RDS: Postgres in from the app host only."
  vpc_id      = data.aws_vpc.default.id
}

resource "aws_vpc_security_group_ingress_rule" "db_from_app" {
  security_group_id            = aws_security_group.db.id
  description                  = "postgres-from-app"
  ip_protocol                  = "tcp"
  from_port                    = local.db_port
  to_port                      = local.db_port
  referenced_security_group_id = aws_security_group.app.id
}

# No RDS Proxy: the API holds a session-scoped LISTEN connection for chat, which a proxy breaks.
resource "aws_db_instance" "app" {
  identifier     = "tutorlink"
  engine         = "postgres"
  engine_version = "17"
  instance_class = var.db_instance_class

  allocated_storage = var.db_allocated_storage_gb
  storage_type      = "gp3"
  storage_encrypted = true

  db_name  = local.db_name
  username = local.db_username
  password = random_password.db.result
  port     = local.db_port

  # Single-AZ, next to the app host, so queries don't cross AZs.
  multi_az               = false
  availability_zone      = local.availability_zone
  db_subnet_group_name   = aws_db_subnet_group.app.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  parameter_group_name   = aws_db_parameter_group.app.name

  backup_retention_period = 7
  # Carries default_tags onto automated and final snapshots.
  copy_tags_to_snapshot = true

  # Deleting the database takes two deliberate applies: lift protection, then destroy.
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "tutorlink-final"
}
