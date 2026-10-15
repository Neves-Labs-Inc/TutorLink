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
  description = "Size of the persistent data volume mounted at /srv/tutorlink (Caddy certificates and the deploy files)."
  type        = number
  default     = 5
}

variable "domain" {
  description = "Public hostname for the site. When null, the site uses <elastic-ip-with-dashes>.sslip.io."
  type        = string
  default     = null
}

variable "elastic_ip_allocation_id" {
  description = <<-EOT
    Allocation ID of the Elastic IP after its transfer into tutorlink-prod. Leave null until the transfer
    is accepted (apply 1), then set it for apply 2, which imports the address. See Neves-Labs-Infra
    database/RUNBOOK.md. Never set it back to null to roll back: use `terraform state rm`.
  EOT
  type        = string
  default     = null

  validation {
    condition     = var.elastic_ip_allocation_id == null || can(regex("^eipalloc-[0-9a-f]+$", var.elastic_ip_allocation_id))
    error_message = "elastic_ip_allocation_id must be null or look like eipalloc-<hex>."
  }
}

variable "github_repo" {
  description = <<-EOT
    Repository part of the OIDC subject the deploy role trusts. The repo uses GitHub's immutable
    subject format, <owner>@<owner-id>/<repo>@<repo-id>. The names are part of it, so renaming the
    owner or repo changes the subject (the org rename from Siraneves did). Read it with
    `gh api repos/Neves-Labs-Inc/TutorLink/actions/oidc/customization/sub` (sub_claim_prefix, minus "repo:").
  EOT
  type        = string
  default     = "Neves-Labs-Inc@313945357/TutorLink@1325618027"
}

variable "github_deploy_ref" {
  description = "Git ref the deploy role trusts; only workflow runs on this ref can deploy."
  type        = string
  default     = "refs/heads/main"
}
