variable "kubeconfig_path" {
  description = "Path to the operator's kubeconfig file for the existing GKE cluster."
  type        = string
  default     = "~/.kube/config"
}

variable "kubeconfig_context" {
  description = "Kubeconfig context for the target GKE cluster."
  type        = string

  validation {
    condition     = trimspace(var.kubeconfig_context) != ""
    error_message = "Kubeconfig context must not be empty."
  }
}

variable "namespace" {
  description = "Existing Kubernetes namespace that receives the private topology."
  type        = string
  default     = "spine-app"

  validation {
    condition     = trimspace(var.namespace) != ""
    error_message = "Namespace must not be empty."
  }
}

variable "service_account_name" {
  description = "Existing Kubernetes ServiceAccount used by every workload in this template."
  type        = string
  default     = "default"

  validation {
    condition     = trimspace(var.service_account_name) != ""
    error_message = "ServiceAccount name must not be empty."
  }
}

variable "application_image" {
  description = "Immutable image reference for the application-node process."
  type        = string

  validation {
    condition     = trimspace(var.application_image) != ""
    error_message = "Application image must not be empty."
  }
}

variable "gateway_image" {
  description = "Immutable image reference for the standalone Gateway process."
  type        = string

  validation {
    condition     = trimspace(var.gateway_image) != ""
    error_message = "Gateway image must not be empty."
  }
}

variable "delivery_image" {
  description = "Immutable image reference for the simple in-memory delivery server."
  type        = string

  validation {
    condition     = trimspace(var.delivery_image) != ""
    error_message = "Delivery image must not be empty."
  }
}

variable "application_replicas" {
  description = "Number of identical application nodes when optional autoscaling is disabled."
  type        = number
  default     = 2

  validation {
    condition     = var.application_replicas >= 0 && floor(var.application_replicas) == var.application_replicas
    error_message = "Application replicas must be zero or greater."
  }
}

variable "application_process_count" {
  description = "Number of complete application replicas started in each application Pod."
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
  description = "Private native gRPC port exposed by each application node."
  type        = number
  default     = 8080

  validation {
    condition     = var.application_port >= 1 && var.application_port <= 65535 && floor(var.application_port) == var.application_port
    error_message = "Application port must be an integer from 1 through 65535."
  }
}

variable "gateway_port" {
  description = "Private browser Gateway port exposed to an operator-managed edge."
  type        = number
  default     = 8081

  validation {
    condition     = var.gateway_port >= 1 && var.gateway_port <= 65535 && floor(var.gateway_port) == var.gateway_port
    error_message = "Gateway port must be an integer from 1 through 65535."
  }
}

variable "delivery_port" {
  description = "Private gRPC port exposed by the simple delivery server."
  type        = number
  default     = 8484

  validation {
    condition     = var.delivery_port >= 1 && var.delivery_port <= 65535 && floor(var.delivery_port) == var.delivery_port
    error_message = "Delivery port must be an integer from 1 through 65535."
  }
}

variable "application_secret_name" {
  description = "Name of an existing Secret containing application-selected configuration."
  type        = string

  validation {
    condition     = trimspace(var.application_secret_name) != ""
    error_message = "Application Secret name must not be empty."
  }
}

variable "gateway_secret_name" {
  description = "Name of an existing Secret containing Gateway session and identity configuration."
  type        = string

  validation {
    condition     = trimspace(var.gateway_secret_name) != ""
    error_message = "Gateway Secret name must not be empty."
  }
}

variable "autoscaling_enabled" {
  description = "Creates the module's optional external-metric HPA when true; never combine it with KEDA."
  type        = bool
  default     = false
}

variable "autoscaling_metric" {
  description = "External metric name selected by the operator when autoscaling is enabled."
  type        = string
  default     = "requests_per_second"
}

variable "autoscaling_target" {
  description = "Target average external-metric value selected by the operator."
  type        = string
  default     = "10"
}

variable "autoscaling_min_replicas" {
  description = "Minimum application-node replicas selected by the operator for the optional HPA."
  type        = number
  default     = 1

  validation {
    condition     = var.autoscaling_min_replicas >= 1 && floor(var.autoscaling_min_replicas) == var.autoscaling_min_replicas
    error_message = "Autoscaling minimum replicas must be a positive integer."
  }
}

variable "autoscaling_max_replicas" {
  description = "Maximum application-node replicas selected by the operator for the optional HPA."
  type        = number
  default     = 8

  validation {
    condition     = var.autoscaling_max_replicas >= 1 && floor(var.autoscaling_max_replicas) == var.autoscaling_max_replicas
    error_message = "Autoscaling maximum replicas must be a positive integer."
  }
}
