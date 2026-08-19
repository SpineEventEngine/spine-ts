variable "project_id" {
  description = "Google Cloud project that owns the Compute Engine resources."
  type        = string

  validation {
    condition     = trimspace(var.project_id) != ""
    error_message = "Project ID must not be empty."
  }
}

variable "region" {
  description = "Region that hosts every managed instance group."
  type        = string

  validation {
    condition     = trimspace(var.region) != ""
    error_message = "Region must not be empty."
  }
}

variable "application_zones" {
  description = "At least two zones in the region used to distribute application nodes."
  type        = list(string)

  validation {
    condition     = length(var.application_zones) >= 2 && alltrue([for zone in var.application_zones : trimspace(zone) != ""])
    error_message = "Application zones must contain at least two non-empty zones."
  }
}

variable "singleton_zone" {
  description = "Zone in the region used by the one-Gateway and one-delivery-server groups."
  type        = string

  validation {
    condition     = trimspace(var.singleton_zone) != ""
    error_message = "Singleton zone must not be empty."
  }
}

variable "network" {
  description = "Existing private VPC network self link or name."
  type        = string

  validation {
    condition     = trimspace(var.network) != ""
    error_message = "Network must not be empty."
  }
}

variable "subnetwork" {
  description = "Existing regional private subnetwork self link or name."
  type        = string

  validation {
    condition     = trimspace(var.subnetwork) != ""
    error_message = "Subnetwork must not be empty."
  }
}

variable "machine_type" {
  description = "Machine type used by the application, Gateway, and delivery server."
  type        = string
  default     = "e2-standard-2"

  validation {
    condition     = trimspace(var.machine_type) != ""
    error_message = "Machine type must not be empty."
  }
}

variable "service_account_email" {
  description = "Existing least-privilege VM service-account email."
  type        = string

  validation {
    condition     = trimspace(var.service_account_email) != ""
    error_message = "Service-account email must not be empty."
  }
}

variable "application_image" {
  description = "Immutable Artifact Registry container image digest for the application-node process."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]+-docker\\.pkg\\.dev/.+@sha256:[0-9a-fA-F]{64}$", var.application_image))
    error_message = "Application image must use an Artifact Registry host and end with an immutable SHA-256 digest."
  }
}

variable "gateway_image" {
  description = "Immutable Artifact Registry container image digest for the standalone Gateway process."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]+-docker\\.pkg\\.dev/.+@sha256:[0-9a-fA-F]{64}$", var.gateway_image))
    error_message = "Gateway image must use an Artifact Registry host and end with an immutable SHA-256 digest."
  }
}

variable "delivery_image" {
  description = "Immutable Artifact Registry container image digest for the in-memory simple delivery server."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]+-docker\\.pkg\\.dev/.+@sha256:[0-9a-fA-F]{64}$", var.delivery_image))
    error_message = "Delivery image must use an Artifact Registry host and end with an immutable SHA-256 digest."
  }
}

variable "application_replicas" {
  description = "Manual application-node capacity when optional autoscaling is disabled."
  type        = number
  default     = 2

  validation {
    condition     = var.application_replicas >= 0 && floor(var.application_replicas) == var.application_replicas
    error_message = "Application replicas must be a non-negative integer."
  }
}

variable "application_process_count" {
  description = "Number of complete application replicas started in each application VM."
  type        = number

  validation {
    condition     = var.application_process_count >= 1 && floor(var.application_process_count) == var.application_process_count
    error_message = "Application process count must be a positive integer."
  }
}

variable "delivery_shard_count" {
  description = "Delivery shard count passed explicitly to each application image's context assembly."
  type        = number

  validation {
    condition     = var.delivery_shard_count >= 1 && floor(var.delivery_shard_count) == var.delivery_shard_count
    error_message = "Delivery shard count must be a positive integer."
  }
}

variable "application_port" {
  description = "Private native gRPC listener port of each application node."
  type        = number
  default     = 8080

  validation {
    condition     = var.application_port >= 1 && var.application_port <= 65535 && floor(var.application_port) == var.application_port
    error_message = "Application port must be an integer from 1 through 65535."
  }
}

variable "gateway_port" {
  description = "Private Gateway listener port for an operator-managed edge."
  type        = number
  default     = 8081

  validation {
    condition     = var.gateway_port >= 1 && var.gateway_port <= 65535 && floor(var.gateway_port) == var.gateway_port
    error_message = "Gateway port must be an integer from 1 through 65535."
  }
}

variable "delivery_port" {
  description = "Private gRPC listener port of the simple delivery server."
  type        = number
  default     = 8484

  validation {
    condition     = var.delivery_port >= 1 && var.delivery_port <= 65535 && floor(var.delivery_port) == var.delivery_port
    error_message = "Delivery port must be an integer from 1 through 65535."
  }
}

variable "application_startup_delay_sec" {
  description = "Autohealing delay that gives application startup and registry registration time to finish."
  type        = number
  default     = 120

  validation {
    condition     = var.application_startup_delay_sec >= 60 && floor(var.application_startup_delay_sec) == var.application_startup_delay_sec
    error_message = "Application startup delay must be an integer of at least 60 seconds."
  }
}

variable "registry_namespace" {
  description = "Operator-chosen durable registry namespace shared by application nodes and the Gateway."
  type        = string
  default     = "production-application-nodes"

  validation {
    condition     = trimspace(var.registry_namespace) != ""
    error_message = "Registry namespace must not be empty."
  }
}

variable "registry_storage_reference" {
  description = "An application-defined identifier for the durable storage configuration used by the registry."
  type        = string

  validation {
    condition     = trimspace(var.registry_storage_reference) != ""
    error_message = "Registry storage reference must not be empty."
  }
}

variable "application_secret_reference" {
  description = "External identifier that the application image resolves for its own secrets; never a secret value."
  type        = string
  default     = ""
}

variable "gateway_secret_reference" {
  description = "External identifier that the Gateway image resolves for its own secrets; never a secret value."
  type        = string
  default     = ""
}

variable "private_source_ranges" {
  description = "Private CIDR ranges allowed to reach Spine listeners; configure for the operator's VPC topology."
  type        = list(string)
  default     = ["10.0.0.0/8"]

  validation {
    condition     = length(var.private_source_ranges) > 0
    error_message = "At least one private source range is required."
  }
}

variable "health_check_source_ranges" {
  description = "Google health-check source ranges allowed to probe private listeners."
  type        = list(string)
  default     = ["35.191.0.0/16", "130.211.0.0/22"]
}

variable "autoscaling_enabled" {
  description = "Lets Compute Engine, rather than Terraform, control application-node capacity."
  type        = bool
  default     = false
}

variable "autoscaling_signal" {
  description = "Autoscaling signal: cpu utilization or a custom Monitoring metric."
  type        = string
  default     = "cpu"

  validation {
    condition     = contains(["cpu", "monitoring"], var.autoscaling_signal)
    error_message = "Autoscaling signal must be cpu or monitoring."
  }
}

variable "autoscaling_metric_scope" {
  description = "Whether a custom Monitoring metric is per_instance or whole_group."
  type        = string
  default     = "per_instance"

  validation {
    condition     = contains(["per_instance", "whole_group"], var.autoscaling_metric_scope)
    error_message = "Autoscaling metric scope must be per_instance or whole_group."
  }
}

variable "autoscaling_metric" {
  description = "Cloud Monitoring metric name when autoscaling signal is monitoring."
  type        = string
  default     = ""
}

variable "autoscaling_metric_filter" {
  description = "Cloud Monitoring filter that selects the intended metric resource and series, including resource.type."
  type        = string
  default     = ""
}

variable "autoscaling_metric_target_type" {
  description = "Monitoring metric target kind, such as GAUGE or DELTA_PER_SECOND."
  type        = string
  default     = "GAUGE"

  validation {
    condition     = contains(["GAUGE", "DELTA_PER_SECOND", "DELTA_PER_MINUTE"], var.autoscaling_metric_target_type)
    error_message = "Monitoring metric target type must be GAUGE, DELTA_PER_SECOND, or DELTA_PER_MINUTE."
  }
}

variable "autoscaling_target" {
  description = "Target utilization for CPU or target value for the selected Monitoring metric."
  type        = number
  default     = 0.7

  validation {
    condition     = var.autoscaling_target > 0
    error_message = "Autoscaling target must be greater than zero."
  }
}

variable "autoscaling_min_replicas" {
  description = "Minimum application-node capacity when optional autoscaling is enabled."
  type        = number
  default     = 1

  validation {
    condition     = var.autoscaling_min_replicas >= 0 && floor(var.autoscaling_min_replicas) == var.autoscaling_min_replicas
    error_message = "Autoscaling minimum replicas must be a non-negative integer."
  }
}

variable "autoscaling_max_replicas" {
  description = "Maximum application-node capacity when optional autoscaling is enabled."
  type        = number
  default     = 8

  validation {
    condition     = var.autoscaling_max_replicas >= 1 && floor(var.autoscaling_max_replicas) == var.autoscaling_max_replicas
    error_message = "Autoscaling maximum replicas must be a positive integer."
  }
}
