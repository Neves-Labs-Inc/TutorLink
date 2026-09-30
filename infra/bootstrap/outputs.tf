output "state_bucket" {
  description = "Name of the S3 bucket that holds the main infrastructure's remote state."
  value       = aws_s3_bucket.state.bucket
}
