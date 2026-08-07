variable "kubeconfig_path" {
  description = "Path to the operator's kubeconfig file for the existing GKE cluster."
  type        = string
  default     = "~/.kube/config"
}

variable "kubeconfig_context" {
  description = "Kubeconfig context for the target GKE cluster."
  type        = string
}

variable "namespace" {
  description = "Existing Kubernetes namespace that receives the private topology."
  type        = string
  default     = "spine-app"
}

variable "service_account_name" {
  description = "Existing Kubernetes ServiceAccount used by every workload in this template."
  type        = string
  default     = "default"
}

variable "application_image" {
  description = "Immutable image reference for the application-node process."
  type        = string
}

variable "gateway_image" {
  description = "Immutable image reference for the standalone Gateway process."
  type        = string
}

variable "delivery_image" {
  description = "Immutable image reference for the simple in-memory delivery server."
  type        = string
}

variable "application_replicas" {
  description = "Number of identical application nodes when optional autoscaling is disabled."
  type        = number
  default     = 2

  validation {
    condition     = var.application_replicas >= 0
    error_message = "Application replicas must be zero or greater."
  }
}

variable "application_port" {
  description = "Private native gRPC port exposed by each application node."
  type        = number
  default     = 8080
}

variable "gateway_port" {
  description = "Private browser Gateway port exposed to an operator-managed edge."
  type        = number
  default     = 8081
}

variable "delivery_port" {
  description = "Private gRPC port exposed by the simple delivery server."
  type        = number
  default     = 8484
}

variable "application_secret_name" {
  description = "Name of an existing Secret containing application-selected configuration."
  type        = string
}

variable "gateway_secret_name" {
  description = "Name of an existing Secret containing Gateway session and identity configuration."
  type        = string
}

variable "autoscaling_enabled" {
  description = "Creates an optional external-metric HPA when true; disabled by default."
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
}

variable "autoscaling_max_replicas" {
  description = "Maximum application-node replicas selected by the operator for the optional HPA."
  type        = number
  default     = 8
}
