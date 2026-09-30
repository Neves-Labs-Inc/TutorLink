# Terraform state bootstrap

Creates the S3 bucket that holds the remote state of the main infrastructure (`infra/`):
`tutorlink-tfstate-<account-id>`, versioned, encrypted (AES256), all public access blocked,
`BucketOwnerEnforced`, and protected by `prevent_destroy`. Everything is tagged
`Project=tutorlink`, `Environment=prod`, `ManagedBy=terraform`.

This root keeps its own state locally (`terraform.tfstate`, gitignored). Run it once:

```sh
terraform init && terraform apply
```

It uses the default AWS credential chain, so `AWS_PROFILE` works if set. The `state_bucket`
output is the bucket name to use in the main root's backend.
