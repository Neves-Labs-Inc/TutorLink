terraform {
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Backend blocks can't interpolate, so the bootstrap's bucket name (in tutorlink-prod) is a literal.
  backend "s3" {
    bucket       = "tutorlink-tfstate-046451670022"
    key          = "prod/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}

locals {
  common_tags = {
    Project     = "tutorlink"
    Environment = "prod"
    ManagedBy   = "terraform"
  }
}

# No profile here: the default credential chain applies, so AWS_PROFILE works.
provider "aws" {
  region = var.region
  # tutorlink-prod only, so an apply with the wrong AWS_PROFILE fails instead of building elsewhere.
  allowed_account_ids = ["046451670022"]

  default_tags {
    tags = local.common_tags
  }
}

data "aws_caller_identity" "current" {}
