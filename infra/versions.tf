terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Backend blocks can't interpolate, so the bootstrap's bucket name is a literal.
  backend "s3" {
    bucket       = "tutorlink-tfstate-211125623243"
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

  default_tags {
    tags = local.common_tags
  }
}

data "aws_caller_identity" "current" {}
