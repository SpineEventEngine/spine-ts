locals {
  application_image_host = split("/", var.application_image)[0]
  delivery_image_host    = split("/", var.delivery_image)[0]
  gateway_image_host     = split("/", var.gateway_image)[0]
  runtime_ports          = [var.application_port, var.gateway_port, var.delivery_port]
  runtime_tags           = ["spine-runtime"]
}

resource "google_compute_health_check" "application" {
  name                = "spine-application"
  check_interval_sec  = 10
  timeout_sec         = 5
  healthy_threshold   = 2
  unhealthy_threshold = 3

  tcp_health_check {
    port = var.application_port
  }
}

resource "google_compute_health_check" "gateway" {
  name                = "spine-gateway"
  check_interval_sec  = 10
  timeout_sec         = 5
  healthy_threshold   = 2
  unhealthy_threshold = 3

  tcp_health_check {
    port = var.gateway_port
  }
}

resource "google_compute_health_check" "delivery" {
  name                = "spine-delivery"
  check_interval_sec  = 10
  timeout_sec         = 5
  healthy_threshold   = 2
  unhealthy_threshold = 3

  tcp_health_check {
    port = var.delivery_port
  }
}

resource "google_compute_firewall" "private_runtime" {
  name          = "spine-private-runtime"
  network       = var.network
  direction     = "INGRESS"
  source_ranges = distinct(concat(var.private_source_ranges, var.health_check_source_ranges))
  target_tags   = local.runtime_tags

  allow {
    protocol = "tcp"
    ports    = [for port in local.runtime_ports : tostring(port)]
  }
}

resource "google_compute_address" "gateway" {
  name         = "spine-gateway"
  region       = var.region
  address_type = "INTERNAL"
  purpose      = "GCE_ENDPOINT"
  subnetwork   = var.subnetwork
}

resource "google_compute_address" "delivery" {
  name         = "spine-delivery"
  region       = var.region
  address_type = "INTERNAL"
  purpose      = "GCE_ENDPOINT"
  subnetwork   = var.subnetwork
}

resource "google_compute_instance_template" "application" {
  name_prefix  = "spine-application-"
  machine_type = var.machine_type
  tags         = local.runtime_tags

  disk {
    source_image = "projects/cos-cloud/global/images/family/cos-stable"
    auto_delete  = true
    boot         = true
  }

  network_interface {
    network    = var.network
    subnetwork = var.subnetwork
  }

  service_account {
    email  = var.service_account_email
    scopes = ["cloud-platform"]
  }

  metadata_startup_script = <<-EOT
    #!/usr/bin/env bash
    set -eu
    export HOME=/var/lib/spine-docker
    export DOCKER_CONFIG="$HOME/.docker"
    mkdir -p "$DOCKER_CONFIG"
    docker-credential-gcr configure-docker --registries=${local.application_image_host}
    docker --config "$DOCKER_CONFIG" run --rm --network host \
      -e HOST=0.0.0.0 \
      -e PORT=${var.application_port} \
      -e APPLICATION_PROCESS_COUNT=${var.application_process_count} \
      -e DELIVERY_SERVER_URL=http://${google_compute_forwarding_rule.delivery.ip_address}:${var.delivery_port} \
      -e DELIVERY_SHARD_COUNT=${var.delivery_shard_count} \
      -e REGISTRY_NAMESPACE=${var.registry_namespace} \
      -e REGISTRY_STORAGE_REFERENCE=${var.registry_storage_reference} \
      -e APPLICATION_SECRET_REFERENCE=${var.application_secret_reference} \
      ${var.application_image}
  EOT

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_compute_instance_template" "gateway" {
  name_prefix  = "spine-gateway-"
  machine_type = var.machine_type
  tags         = local.runtime_tags

  disk {
    source_image = "projects/cos-cloud/global/images/family/cos-stable"
    auto_delete  = true
    boot         = true
  }

  network_interface {
    network    = var.network
    subnetwork = var.subnetwork
  }

  service_account {
    email  = var.service_account_email
    scopes = ["cloud-platform"]
  }

  metadata_startup_script = <<-EOT
    #!/usr/bin/env bash
    set -eu
    export HOME=/var/lib/spine-docker
    export DOCKER_CONFIG="$HOME/.docker"
    mkdir -p "$DOCKER_CONFIG"
    docker-credential-gcr configure-docker --registries=${local.gateway_image_host}
    docker --config "$DOCKER_CONFIG" run --rm --network host \
      -e HOST=0.0.0.0 \
      -e PORT=${var.gateway_port} \
      -e REGISTRY_NAMESPACE=${var.registry_namespace} \
      -e REGISTRY_STORAGE_REFERENCE=${var.registry_storage_reference} \
      -e GATEWAY_SECRET_REFERENCE=${var.gateway_secret_reference} \
      ${var.gateway_image}
  EOT

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_compute_instance_template" "delivery" {
  name_prefix  = "spine-delivery-"
  machine_type = var.machine_type
  tags         = local.runtime_tags

  disk {
    source_image = "projects/cos-cloud/global/images/family/cos-stable"
    auto_delete  = true
    boot         = true
  }

  network_interface {
    network    = var.network
    subnetwork = var.subnetwork
  }

  service_account {
    email  = var.service_account_email
    scopes = ["cloud-platform"]
  }

  metadata_startup_script = <<-EOT
    #!/usr/bin/env bash
    set -eu
    export HOME=/var/lib/spine-docker
    export DOCKER_CONFIG="$HOME/.docker"
    mkdir -p "$DOCKER_CONFIG"
    docker-credential-gcr configure-docker --registries=${local.delivery_image_host}
    docker --config "$DOCKER_CONFIG" run --rm --network host \
      -e HOST=0.0.0.0 \
      -e PORT=${var.delivery_port} \
      ${var.delivery_image}
  EOT

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_compute_region_instance_group_manager" "application" {
  name                      = "spine-application"
  region                    = var.region
  base_instance_name        = "spine-application"
  distribution_policy_zones = var.application_zones
  target_size               = var.autoscaling_enabled ? null : var.application_replicas

  version {
    instance_template = google_compute_instance_template.application.self_link_unique
  }

  named_port {
    name = "grpc"
    port = var.application_port
  }

  auto_healing_policies {
    health_check      = google_compute_health_check.application.self_link
    initial_delay_sec = var.application_startup_delay_sec
  }

  update_policy {
    type                  = "PROACTIVE"
    minimal_action        = "REPLACE"
    replacement_method    = "SUBSTITUTE"
    max_surge_fixed       = length(var.application_zones)
    max_unavailable_fixed = 0
  }

  lifecycle {
    precondition {
      condition     = var.autoscaling_min_replicas <= var.autoscaling_max_replicas
      error_message = "Autoscaling minimum replicas must not exceed the maximum."
    }

    precondition {
      condition     = !var.autoscaling_enabled || var.autoscaling_signal == "cpu" || trimspace(var.autoscaling_metric) != ""
      error_message = "Monitoring autoscaling requires a metric name."
    }

    precondition {
      condition     = !var.autoscaling_enabled || var.autoscaling_signal != "monitoring" || var.autoscaling_min_replicas >= 1 || var.autoscaling_metric_scope == "whole_group"
      error_message = "Monitoring minimum replicas of zero requires a whole_group Monitoring metric."
    }

    precondition {
      condition     = !var.autoscaling_enabled || var.autoscaling_signal != "cpu" || var.autoscaling_min_replicas >= 1
      error_message = "CPU autoscaling requires at least one application node."
    }

    precondition {
      condition = !var.autoscaling_enabled || var.autoscaling_signal != "monitoring" || (
        var.autoscaling_metric_scope == "per_instance" &&
        can(regex("resource\\.type\\s*=\\s*\"gce_instance\"", var.autoscaling_metric_filter))
        ) || (
        var.autoscaling_metric_scope == "whole_group" &&
        can(regex("resource\\.type\\s*=", var.autoscaling_metric_filter)) &&
        !can(regex("resource\\.type\\s*=\\s*\"gce_instance\"", var.autoscaling_metric_filter))
      )
      error_message = "per_instance Monitoring metrics require resource.type = \"gce_instance\"; whole_group metrics require a resource.type other than \"gce_instance\"."
    }
  }
}

resource "google_compute_region_autoscaler" "application" {
  count  = var.autoscaling_enabled ? 1 : 0
  name   = "spine-application"
  region = var.region
  target = google_compute_region_instance_group_manager.application.id

  autoscaling_policy {
    min_replicas = var.autoscaling_min_replicas
    max_replicas = var.autoscaling_max_replicas

    dynamic "cpu_utilization" {
      for_each = var.autoscaling_signal == "cpu" ? [true] : []
      content {
        target = var.autoscaling_target
      }
    }

    dynamic "metric" {
      for_each = var.autoscaling_signal == "cpu" ? [] : [true]
      content {
        name   = var.autoscaling_metric
        filter = var.autoscaling_metric_filter
        type   = var.autoscaling_metric_target_type
        target = var.autoscaling_target
      }
    }
  }
}

resource "google_compute_region_instance_group_manager" "gateway" {
  name                      = "spine-gateway"
  region                    = var.region
  base_instance_name        = "spine-gateway"
  distribution_policy_zones = [var.singleton_zone]
  target_size               = 1

  version {
    instance_template = google_compute_instance_template.gateway.self_link_unique
  }

  named_port {
    name = "gateway"
    port = var.gateway_port
  }

  auto_healing_policies {
    health_check      = google_compute_health_check.gateway.self_link
    initial_delay_sec = var.application_startup_delay_sec
  }

  update_policy {
    type                  = "PROACTIVE"
    minimal_action        = "REPLACE"
    replacement_method    = "SUBSTITUTE"
    max_surge_fixed       = 0
    max_unavailable_fixed = 1
  }
}

resource "google_compute_region_instance_group_manager" "delivery" {
  name                      = "spine-delivery"
  region                    = var.region
  base_instance_name        = "spine-delivery"
  distribution_policy_zones = [var.singleton_zone]
  target_size               = 1

  version {
    instance_template = google_compute_instance_template.delivery.self_link_unique
  }

  named_port {
    name = "grpc"
    port = var.delivery_port
  }

  auto_healing_policies {
    health_check      = google_compute_health_check.delivery.self_link
    initial_delay_sec = var.application_startup_delay_sec
  }

  update_policy {
    type                  = "PROACTIVE"
    minimal_action        = "REPLACE"
    replacement_method    = "SUBSTITUTE"
    max_surge_fixed       = 0
    max_unavailable_fixed = 1
  }
}

resource "google_compute_region_backend_service" "gateway" {
  name                  = "spine-gateway"
  region                = var.region
  protocol              = "TCP"
  load_balancing_scheme = "INTERNAL"
  health_checks         = [google_compute_health_check.gateway.id]

  backend {
    group = google_compute_region_instance_group_manager.gateway.instance_group
  }
}

resource "google_compute_region_backend_service" "delivery" {
  name                  = "spine-delivery"
  region                = var.region
  protocol              = "TCP"
  load_balancing_scheme = "INTERNAL"
  health_checks         = [google_compute_health_check.delivery.id]

  backend {
    group = google_compute_region_instance_group_manager.delivery.instance_group
  }
}

resource "google_compute_forwarding_rule" "gateway" {
  name                  = "spine-gateway"
  region                = var.region
  load_balancing_scheme = "INTERNAL"
  backend_service       = google_compute_region_backend_service.gateway.id
  network               = var.network
  subnetwork            = var.subnetwork
  ip_address            = google_compute_address.gateway.id
  ports                 = [tostring(var.gateway_port)]
}

resource "google_compute_forwarding_rule" "delivery" {
  name                  = "spine-delivery"
  region                = var.region
  load_balancing_scheme = "INTERNAL"
  backend_service       = google_compute_region_backend_service.delivery.id
  network               = var.network
  subnetwork            = var.subnetwork
  ip_address            = google_compute_address.delivery.id
  ports                 = [tostring(var.delivery_port)]
}

output "gateway_private_address" {
  description = "Stable private address for an operator-managed TLS and authentication edge."
  value       = google_compute_forwarding_rule.gateway.ip_address
}
