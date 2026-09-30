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
  default     = 20
}

variable "domain" {
  description = "Public hostname for the site. When null, the site uses <elastic-ip-with-dashes>.sslip.io."
  type        = string
  default     = null
}

variable "github_repo" {
  description = "GitHub repository (owner/name) allowed to assume the deploy role."
  type        = string
  default     = "Siraneves/TutorLink"
}

variable "github_deploy_environment" {
  description = "GitHub environment the deploy role trusts; only jobs running in this environment can deploy."
  type        = string
  default     = "production"
}
