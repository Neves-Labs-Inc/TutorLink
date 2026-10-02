variable "region" {
  description = "AWS region for every resource in this root."
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  description = "EC2 instance type for the single application host."
  type        = string
  default     = "t3.micro"
}

variable "data_volume_size_gb" {
  description = "Size of the persistent data volume mounted at /srv/tutorlink (Postgres data, Caddy certificates, deploy files)."
  type        = number
  default     = 5
}

variable "db_instance_class" {
  description = "RDS instance class for the PostgreSQL database."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage_gb" {
  description = "Allocated gp3 storage for the RDS database, in GB. Can be grown later, never shrunk."
  type        = number
  default     = 20
}

variable "domain" {
  description = "Public hostname for the site. When null, the site uses <elastic-ip-with-dashes>.sslip.io."
  type        = string
  default     = null
}

variable "github_repo" {
  description = <<-EOT
    Repository part of the OIDC subject the deploy role trusts. The repo uses GitHub's immutable
    subject format, <owner>@<owner-id>/<repo>@<repo-id>, which also survives a rename or a
    recreated repo of the same name. Read it with
    `gh api repos/Siraneves/TutorLink/actions/oidc/customization/sub` (sub_claim_prefix, minus "repo:").
  EOT
  type        = string
  default     = "Siraneves@313945357/TutorLink@1325618027"
}

variable "github_deploy_ref" {
  description = "Git ref the deploy role trusts; only workflow runs on this ref can deploy."
  type        = string
  default     = "refs/heads/main"
}
