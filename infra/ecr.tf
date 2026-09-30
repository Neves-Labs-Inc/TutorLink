locals {
  ecr_repositories = toset(["api", "web"])
  ecr_images_kept  = 10
}

resource "aws_ecr_repository" "app" {
  for_each = local.ecr_repositories

  name                 = "tutorlink-${each.key}"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "app" {
  for_each = aws_ecr_repository.app

  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last ${local.ecr_images_kept} images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = local.ecr_images_kept
      }
      action = { type = "expire" }
    }]
  })
}
