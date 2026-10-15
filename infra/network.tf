locals {
  # Neves-Labs-Infra network/ reserves this range for tutorlink-prod and opens 5432 to the app subnet only.
  vpc_cidr        = "10.20.0.0/16"
  app_subnet_cidr = "10.20.0.0/24"

  # Pinned by ID, not name: zone names map to different physical zones in each account, and
  # use1-az1 is where neves-labs-pg runs.
  availability_zone_id = "use1-az1"
}

resource "aws_vpc" "app" {
  cidr_block           = local.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "tutorlink"
  }
}

# Public, with no NAT gateway: the host reaches the internet through its own public IP.
resource "aws_subnet" "app" {
  vpc_id                  = aws_vpc.app.id
  cidr_block              = local.app_subnet_cidr
  availability_zone_id    = local.availability_zone_id
  map_public_ip_on_launch = true

  tags = {
    Name = "tutorlink-public-${local.availability_zone_id}"
  }
}

resource "aws_internet_gateway" "app" {
  vpc_id = aws_vpc.app.id

  tags = {
    Name = "tutorlink"
  }
}

locals {
  # The shared Neves-Labs VPC, where neves-labs-pg runs.
  shared_vpc = {
    owner_id = "277396470866"
    id       = "vpc-07716890a00dbcb5b"
    cidr     = "10.10.0.0/16"
  }
}

# Requester side only: the accepter lives in Neves-Labs-Infra network/ (client_peerings). Until it
# accepts, the route below is a blackhole, so one apply here is enough. No peer_region: same region.
resource "aws_vpc_peering_connection" "shared" {
  vpc_id        = aws_vpc.app.id
  peer_owner_id = local.shared_vpc.owner_id
  peer_vpc_id   = local.shared_vpc.id
  auto_accept   = false

  tags = {
    Name = "tutorlink-to-neves-labs-shared"
  }
}

resource "aws_route_table" "app" {
  vpc_id = aws_vpc.app.id

  tags = {
    Name = "tutorlink-public"
  }
}

resource "aws_route" "internet" {
  route_table_id         = aws_route_table.app.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.app.id
}

resource "aws_route" "shared_vpc" {
  route_table_id            = aws_route_table.app.id
  destination_cidr_block    = local.shared_vpc.cidr
  vpc_peering_connection_id = aws_vpc_peering_connection.shared.id
}

resource "aws_route_table_association" "app" {
  subnet_id      = aws_subnet.app.id
  route_table_id = aws_route_table.app.id
}

# Where the instance type is offered, by zone ID; aws_instance.app checks use1-az1 is among them.
data "aws_ec2_instance_type_offerings" "available" {
  location_type = "availability-zone-id"

  filter {
    name   = "instance-type"
    values = [var.instance_type]
  }
}

resource "aws_security_group" "app" {
  name        = "tutorlink-app"
  description = "TutorLink host: public HTTP/HTTPS/HTTP3 in, everything out. No SSH; shell access is through SSM."
  vpc_id      = aws_vpc.app.id
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
