data "aws_vpc" "default" {
  default = true
}

# AZs where the instance type is offered, so the chosen subnet can always host the instance.
data "aws_ec2_instance_type_offerings" "available" {
  location_type = "availability-zone"

  filter {
    name   = "instance-type"
    values = [var.instance_type]
  }
}

locals {
  # Sorted so the pick is stable across plans; the instance and data volume share this AZ.
  availability_zone = sort(data.aws_ec2_instance_type_offerings.available.locations)[0]
}

data "aws_subnet" "app" {
  vpc_id            = data.aws_vpc.default.id
  availability_zone = local.availability_zone
  default_for_az    = true
}

resource "aws_security_group" "app" {
  name        = "tutorlink-app"
  description = "TutorLink host: public HTTP/HTTPS/HTTP3 in, everything out. No SSH; shell access is through SSM."
  vpc_id      = data.aws_vpc.default.id
}

locals {
  public_cidrs = {
    ipv4 = { cidr_ipv4 = "0.0.0.0/0", cidr_ipv6 = null }
    ipv6 = { cidr_ipv4 = null, cidr_ipv6 = "::/0" }
  }

  public_ports = {
    http  = { protocol = "tcp", port = 80 }
    https = { protocol = "tcp", port = 443 }
    http3 = { protocol = "udp", port = 443 }
  }

  ingress_rules = merge([
    for port_name, port in local.public_ports : {
      for cidr_name, cidr in local.public_cidrs : "${port_name}-${cidr_name}" => merge(port, cidr)
    }
  ]...)
}

resource "aws_vpc_security_group_ingress_rule" "public" {
  for_each = local.ingress_rules

  security_group_id = aws_security_group.app.id
  description       = each.key
  ip_protocol       = each.value.protocol
  from_port         = each.value.port
  to_port           = each.value.port
  cidr_ipv4         = each.value.cidr_ipv4
  cidr_ipv6         = each.value.cidr_ipv6
}

resource "aws_vpc_security_group_egress_rule" "all" {
  for_each = local.public_cidrs

  security_group_id = aws_security_group.app.id
  description       = "all-${each.key}"
  ip_protocol       = "-1"
  cidr_ipv4         = each.value.cidr_ipv4
  cidr_ipv6         = each.value.cidr_ipv6
}
