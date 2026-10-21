# Plans the root with mock providers: no AWS credentials, no state, no network.
mock_provider "aws" {}

# Mocks fill data sources with random strings, which break lookups that need real shapes.
override_data {
  target = data.aws_ssm_parameter.al2023_ami
  values = {
    insecure_value = "ami-0123456789abcdef0"
  }
}

override_data {
  target = data.aws_caller_identity.current
  values = {
    account_id = "123456789012"
  }
}

override_data {
  target = data.aws_kms_alias.ssm
  values = {
    target_key_arn = "arn:aws:kms:us-east-1:123456789012:key/00000000-0000-0000-0000-000000000000"
  }
}

override_data {
  target = data.aws_ec2_instance_type_offerings.available
  values = {
    locations = ["use1-az1", "use1-az2"]
  }
}

override_data {
  target = data.aws_iam_policy_document.ec2_assume
  values = {
    json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
  }
}

override_data {
  target = data.aws_iam_policy_document.app_runtime
  values = {
    json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
  }
}

override_data {
  target = data.aws_iam_policy_document.deploy_assume
  values = {
    json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
  }
}

override_data {
  target = data.aws_iam_policy_document.deploy
  values = {
    json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
  }
}

# The real default is the transferred address, whose import block mock providers can't
# plan. Runs start without it; the Elastic IP runs set their own ID and override the import.
variables {
  elastic_ip_allocation_id = null
}

run "app_security_group_allows_only_web_ports_in" {
  command = plan

  assert {
    condition = toset([
      for rule in aws_vpc_security_group_ingress_rule.public :
      "${rule.ip_protocol}/${rule.from_port}"
    ]) == toset(["tcp/80", "tcp/443", "udp/443"])
    error_message = "The app security group must allow only 80/tcp, 443/tcp and 443/udp in."
  }

  assert {
    condition     = alltrue([for rule in aws_vpc_security_group_ingress_rule.public : rule.from_port == rule.to_port])
    error_message = "Every app ingress rule must cover a single port."
  }
}

run "instance_requires_imdsv2_with_hop_limit_one" {
  command = plan

  assert {
    condition     = aws_instance.app.metadata_options[0].http_tokens == "required"
    error_message = "The instance must require IMDSv2 tokens."
  }

  assert {
    condition     = aws_instance.app.metadata_options[0].http_put_response_hop_limit == 1
    error_message = "The instance metadata hop limit must be 1 so containers cannot reach it."
  }
}

run "deploy_role_trust_is_pinned_to_the_main_branch" {
  command = plan

  assert {
    condition = toset(one([
      for condition in data.aws_iam_policy_document.deploy_assume.statement[0].condition :
      condition.values if endswith(condition.variable, ":sub")
    ])) == toset(["repo:${var.github_repo}:ref:refs/heads/main"])
    error_message = "The deploy role must trust only repo:<github_repo>:ref:refs/heads/main."
  }
}

run "every_ssm_parameter_sits_under_the_prod_prefix" {
  command = plan

  # A domain, so the conditional SITE_ADDRESS exists and is checked too.
  variables {
    domain = "tutorlink.example.com"
  }

  assert {
    condition     = length(aws_ssm_parameter.site_address) == 1
    error_message = "SITE_ADDRESS must exist for the prefix check to cover it."
  }

  assert {
    condition = alltrue([
      for name in [
        aws_ssm_parameter.secret_key.name,
        aws_ssm_parameter.database_url.name,
        aws_ssm_parameter.site_address[0].name,
        aws_ssm_parameter.twilio_account_sid.name,
        aws_ssm_parameter.twilio_auth_token.name,
        aws_ssm_parameter.anthropic_api_key.name,
        aws_ssm_parameter.twilio_whatsapp_number.name,
        aws_ssm_parameter.smtp_host.name,
        aws_ssm_parameter.smtp_port.name,
        aws_ssm_parameter.smtp_username.name,
        aws_ssm_parameter.smtp_password.name,
        aws_ssm_parameter.mail_from.name,
      ] : startswith(name, "/tutorlink/prod/")
    ])
    error_message = "Every SSM parameter must sit under /tutorlink/prod/."
  }
}

run "database_url_and_secret_key_are_write_only_secure_strings" {
  command = plan

  assert {
    condition = alltrue([
      for parameter in [aws_ssm_parameter.database_url, aws_ssm_parameter.secret_key] :
      parameter.type == "SecureString" && parameter.value_wo_version == 1
    ])
    error_message = "DATABASE_URL and SECRET_KEY must be SecureStrings with a write-only value at version 1."
  }
}

run "app_runs_in_its_own_vpc_with_one_public_subnet_in_use1_az1" {
  command = plan

  assert {
    condition     = aws_vpc.app.cidr_block == "10.20.0.0/16"
    error_message = "The VPC must use 10.20.0.0/16, the range Neves-Labs-Infra reserves for tutorlink-prod."
  }

  assert {
    condition     = aws_vpc.app.enable_dns_support && aws_vpc.app.enable_dns_hostnames
    error_message = "The VPC must have DNS support and DNS hostnames on."
  }

  assert {
    condition     = aws_subnet.app.cidr_block == "10.20.0.0/24"
    error_message = "The app subnet must be 10.20.0.0/24, the CIDR Neves-Labs-Infra opens 5432 to."
  }

  assert {
    condition     = aws_subnet.app.availability_zone_id == "use1-az1"
    error_message = "The app subnet must sit in availability zone ID use1-az1, next to neves-labs-pg."
  }

  assert {
    condition     = aws_subnet.app.map_public_ip_on_launch
    error_message = "The app subnet must give instances a public IP, since there is no NAT gateway."
  }
}

run "app_requests_a_peering_to_the_shared_neves_labs_vpc" {
  command = plan

  assert {
    condition     = aws_vpc_peering_connection.shared.peer_owner_id == "277396470866"
    error_message = "The peering must target the Neves-Labs account, 277396470866."
  }

  assert {
    condition     = aws_vpc_peering_connection.shared.peer_vpc_id == "vpc-07716890a00dbcb5b"
    error_message = "The peering must target the shared VPC, vpc-07716890a00dbcb5b."
  }

  assert {
    condition     = !aws_vpc_peering_connection.shared.auto_accept
    error_message = "The peering must not auto-accept; Neves-Labs-Infra network/ accepts it."
  }
}

run "app_subnet_routes_the_internet_to_the_gateway_and_the_shared_vpc_to_the_peering" {
  command = plan

  # Known IDs, so the routes can be compared to them at plan time.
  override_resource {
    target          = aws_internet_gateway.app
    override_during = plan
    values = {
      id = "igw-0123456789abcdef0"
    }
  }

  override_resource {
    target          = aws_vpc_peering_connection.shared
    override_during = plan
    values = {
      id = "pcx-0123456789abcdef0"
    }
  }

  override_resource {
    target          = aws_route_table.app
    override_during = plan
    values = {
      id = "rtb-0123456789abcdef0"
    }
  }

  override_resource {
    target          = aws_subnet.app
    override_during = plan
    values = {
      id = "subnet-0123456789abcdef0"
    }
  }

  assert {
    condition     = aws_route.internet.destination_cidr_block == "0.0.0.0/0" && aws_route.internet.gateway_id == aws_internet_gateway.app.id
    error_message = "0.0.0.0/0 must route to the internet gateway."
  }

  assert {
    condition     = aws_route.shared_vpc.destination_cidr_block == "10.10.0.0/16" && aws_route.shared_vpc.vpc_peering_connection_id == aws_vpc_peering_connection.shared.id
    error_message = "10.10.0.0/16 must route to the peering connection."
  }

  assert {
    condition = alltrue([
      for route in [aws_route.internet, aws_route.shared_vpc] : route.route_table_id == aws_route_table.app.id
    ])
    error_message = "Both routes must sit in the app route table."
  }

  assert {
    condition     = aws_route_table_association.app.subnet_id == aws_subnet.app.id && aws_route_table_association.app.route_table_id == aws_route_table.app.id
    error_message = "The app route table must be associated with the app subnet."
  }
}

run "instance_data_volume_and_security_group_sit_in_the_app_network" {
  command = plan

  override_resource {
    target          = aws_vpc.app
    override_during = plan
    values = {
      id = "vpc-0123456789abcdef0"
    }
  }

  override_resource {
    target          = aws_subnet.app
    override_during = plan
    values = {
      id                = "subnet-0123456789abcdef0"
      availability_zone = "us-east-1c"
    }
  }

  assert {
    condition     = aws_instance.app.subnet_id == "subnet-0123456789abcdef0"
    error_message = "The instance must launch in the app subnet."
  }

  assert {
    condition     = aws_ebs_volume.data.availability_zone == "us-east-1c"
    error_message = "The data volume must sit in the app subnet's availability zone."
  }

  assert {
    condition     = aws_security_group.app.vpc_id == "vpc-0123456789abcdef0"
    error_message = "The app security group must belong to the app VPC."
  }
}

run "plan_fails_when_the_instance_type_is_not_offered_in_use1_az1" {
  command = plan

  override_data {
    target = data.aws_ec2_instance_type_offerings.available
    values = {
      locations = ["use1-az2", "use1-az4"]
    }
  }

  expect_failures = [aws_instance.app]
}

run "peering_connection_id_is_an_output_for_neves_labs_infra" {
  command = plan

  override_resource {
    target          = aws_vpc_peering_connection.shared
    override_during = plan
    values = {
      id = "pcx-0123456789abcdef0"
    }
  }

  assert {
    condition     = output.peering_connection_id == "pcx-0123456789abcdef0"
    error_message = "peering_connection_id must output the peering connection's ID."
  }
}

run "without_an_allocation_id_there_is_no_elastic_ip_association_or_site_address" {
  command = plan

  assert {
    condition     = length(aws_eip.app) == 0 && length(aws_eip_association.app) == 0
    error_message = "With elastic_ip_allocation_id null there must be no Elastic IP and no association."
  }

  assert {
    condition     = length(aws_ssm_parameter.site_address) == 0
    error_message = "With no Elastic IP and no domain there must be no SITE_ADDRESS parameter."
  }

  assert {
    condition     = output.public_ip == null && output.site_address == null && output.site_url == null
    error_message = "public_ip, site_address and site_url must be null with no Elastic IP and no domain."
  }
}

run "with_an_allocation_id_the_elastic_ip_is_adopted_and_serves_the_sslip_io_name" {
  command = plan

  variables {
    elastic_ip_allocation_id = "eipalloc-0123456789abcdef0"
  }

  override_resource {
    target          = aws_eip.app
    override_during = plan
    values = {
      id        = "eipalloc-0123456789abcdef0"
      public_ip = "203.0.113.10"
    }
  }

  override_resource {
    target          = aws_instance.app
    override_during = plan
    values = {
      id = "i-0123456789abcdef0"
    }
  }

  assert {
    condition     = length(aws_eip.app) == 1
    error_message = "With elastic_ip_allocation_id set there must be exactly one Elastic IP."
  }

  assert {
    condition     = length(aws_eip_association.app) == 1 && aws_eip_association.app[0].instance_id == "i-0123456789abcdef0"
    error_message = "The Elastic IP must be associated with the app instance."
  }

  assert {
    condition     = aws_ssm_parameter.site_address[0].value == "203-0-113-10.sslip.io"
    error_message = "SITE_ADDRESS must be the Elastic IP with dashes, under sslip.io."
  }

  assert {
    condition     = output.public_ip == "203.0.113.10" && output.site_url == "https://203-0-113-10.sslip.io"
    error_message = "public_ip and site_url must come from the adopted Elastic IP."
  }
}

run "a_domain_becomes_the_site_address" {
  command = plan

  variables {
    domain = "tutorlink.example.com"
  }

  assert {
    condition     = aws_ssm_parameter.site_address[0].value == "tutorlink.example.com"
    error_message = "SITE_ADDRESS must be the domain when one is set."
  }
}

run "an_allocation_id_that_is_not_eipalloc_hex_fails_validation" {
  command = plan

  variables {
    elastic_ip_allocation_id = "eipalloc-0123XYZ"
  }

  expect_failures = [var.elastic_ip_allocation_id]
}
