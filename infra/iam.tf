locals {
  account_id    = data.aws_caller_identity.current.account_id
  parameter_arn = "arn:aws:ssm:${var.region}:${local.account_id}:parameter${local.parameter_prefix}*"
  ecr_repo_arns = [for repo in aws_ecr_repository.app : repo.arn]

  ecr_pull_actions = [
    "ecr:BatchCheckLayerAvailability",
    "ecr:BatchGetImage",
    "ecr:GetDownloadUrlForLayer",
  ]
  ecr_push_actions = [
    "ecr:CompleteLayerUpload",
    "ecr:InitiateLayerUpload",
    "ecr:PutImage",
    "ecr:UploadLayerPart",
  ]
}

data "aws_kms_alias" "ssm" {
  name = "alias/aws/ssm"
}

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "app" {
  name               = "tutorlink-app-instance"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_role_policy_attachment" "app_ssm_core" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "app_runtime" {
  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid       = "EcrPull"
    actions   = local.ecr_pull_actions
    resources = local.ecr_repo_arns
  }

  statement {
    sid       = "ReadAppParameters"
    actions   = ["ssm:GetParametersByPath", "ssm:GetParameter*"]
    resources = [local.parameter_arn]
  }

  statement {
    sid       = "DecryptAppParameters"
    actions   = ["kms:Decrypt"]
    resources = [data.aws_kms_alias.ssm.target_key_arn]
  }
}

resource "aws_iam_policy" "app_runtime" {
  name   = "tutorlink-app-runtime"
  policy = data.aws_iam_policy_document.app_runtime.json
}

resource "aws_iam_role_policy_attachment" "app_runtime" {
  role       = aws_iam_role.app.name
  policy_arn = aws_iam_policy.app_runtime.arn
}

resource "aws_iam_instance_profile" "app" {
  name = "tutorlink-app-instance"
  role = aws_iam_role.app.name
}
