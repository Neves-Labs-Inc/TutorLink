locals {
  # The runtime contract in docker-compose.prod.yml: DATA_DIR on the host.
  data_dir = "/srv/tutorlink"

  # Pinned so every boot installs the same plugin; bump both together.
  compose_version = "v5.5.1"
  compose_sha256  = "db1889184726840f75c4f9c001048430d4f25b3be3cb084d3ddd762bc0aed576"

  # Room for a few generations of the api and web images before `docker image prune` runs.
  root_volume_size_gb = 20
}

data "aws_ssm_parameter" "al2023_ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

resource "aws_instance" "app" {
  ami                    = data.aws_ssm_parameter.al2023_ami.insecure_value
  instance_type          = var.instance_type
  subnet_id              = data.aws_subnet.app.id
  vpc_security_group_ids = [aws_security_group.app.id]
  iam_instance_profile   = aws_iam_instance_profile.app.name

  user_data = templatefile("${path.module}/templates/user_data.sh.tftpl", {
    data_dir        = local.data_dir
    volume_id       = aws_ebs_volume.data.id
    compose_version = local.compose_version
    compose_sha256  = local.compose_sha256
  })
  # user_data only runs on first boot, so a change replaces the instance. The data volume is
  # detached safely (stop_instance_before_detaching) and the EIP re-associated, so the site
  # address stays the same.
  user_data_replace_on_change = true

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
    # Hop limit 1 keeps containers from reaching IMDS and borrowing the instance role.
    http_put_response_hop_limit = 1
  }

  # default_tags doesn't reach the root volume; volume_tags would fight the data volume's tags.
  root_block_device {
    volume_type = "gp3"
    volume_size = local.root_volume_size_gb
    encrypted   = true
    tags        = local.common_tags
  }

  lifecycle {
    # A new AMI is picked up by replacing the instance on purpose, not on every plan.
    ignore_changes = [ami]
  }
}

# default_tags doesn't reach the ENI the instance creates for itself.
resource "aws_ec2_tag" "primary_eni" {
  for_each = local.common_tags

  resource_id = aws_instance.app.primary_network_interface_id
  key         = each.key
  value       = each.value
}

resource "aws_ebs_volume" "data" {
  availability_zone = local.availability_zone
  size              = var.data_volume_size_gb
  type              = "gp3"
  encrypted         = true

  lifecycle {
    # No backups exist yet; this volume is the only copy of the database.
    prevent_destroy = true
  }
}

resource "aws_volume_attachment" "data" {
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.data.id
  instance_id = aws_instance.app.id

  # On replacement, stop the old instance (clean Postgres and xfs shutdown) before detaching.
  stop_instance_before_detaching = true
}

resource "aws_eip" "app" {
  domain = "vpc"
}

resource "aws_eip_association" "app" {
  allocation_id = aws_eip.app.id
  instance_id   = aws_instance.app.id
}
