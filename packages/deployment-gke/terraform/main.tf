locals {
  labels = {
    "app.kubernetes.io/part-of" = "spine-application"
  }
}

resource "kubernetes_config_map_v1" "runtime" {
  metadata {
    name      = "spine-runtime"
    namespace = var.namespace
    labels    = local.labels
  }

  data = {
    APPLICATION_PORT          = tostring(var.application_port)
    APPLICATION_PROCESS_COUNT = tostring(var.application_process_count)
    BACKEND_DISCOVERY_PORT    = tostring(var.application_port)
    BACKEND_DISCOVERY_SERVICE = "application.${var.namespace}.svc.cluster.local"
    DELIVERY_SERVER_URL       = "http://delivery.${var.namespace}.svc.cluster.local:${var.delivery_port}"
    DELIVERY_SHARD_COUNT      = tostring(var.delivery_shard_count)
    GATEWAY_PORT              = tostring(var.gateway_port)
    NODE_ENV                  = "production"
  }
}

resource "kubernetes_service_v1" "application" {
  metadata {
    name      = "application"
    namespace = var.namespace
    labels    = local.labels
  }

  spec {
    cluster_ip                  = "None"
    publish_not_ready_addresses = false
    selector                    = merge(local.labels, { "app.kubernetes.io/component" = "application" })

    port {
      name        = "grpc"
      port        = var.application_port
      target_port = "coordinator"
    }
  }
}

resource "kubernetes_service_v1" "gateway" {
  metadata {
    name      = "gateway"
    namespace = var.namespace
    labels    = local.labels
  }

  spec {
    selector = merge(local.labels, { "app.kubernetes.io/component" = "gateway" })

    port {
      name        = "gateway"
      port        = var.gateway_port
      target_port = "gateway"
    }
  }
}

resource "kubernetes_service_v1" "delivery" {
  metadata {
    name      = "delivery"
    namespace = var.namespace
    labels    = local.labels
  }

  spec {
    selector = merge(local.labels, { "app.kubernetes.io/component" = "delivery" })

    port {
      name        = "grpc"
      port        = var.delivery_port
      target_port = "grpc"
    }
  }
}

resource "kubernetes_deployment_v1" "application" {
  metadata {
    name      = "application"
    namespace = var.namespace
    labels    = local.labels
  }

  lifecycle {
    precondition {
      condition     = var.autoscaling_min_replicas <= var.autoscaling_max_replicas
      error_message = "Autoscaling minimum replicas must not exceed the maximum."
    }
  }

  spec {
    replicas = var.autoscaling_enabled ? null : tostring(var.application_replicas)

    selector {
      match_labels = merge(local.labels, { "app.kubernetes.io/component" = "application" })
    }

    template {
      metadata {
        labels = merge(local.labels, { "app.kubernetes.io/component" = "application" })
      }

      spec {
        service_account_name = var.service_account_name

        container {
          name  = "application"
          image = var.application_image

          port {
            name           = "coordinator"
            container_port = var.application_port
          }

          env {
            name  = "HOST"
            value = "0.0.0.0"
          }

          env {
            name  = "PORT"
            value = tostring(var.application_port)
          }

          env_from {
            config_map_ref {
              name = kubernetes_config_map_v1.runtime.metadata[0].name
            }
          }

          env_from {
            secret_ref {
              name = var.application_secret_name
            }
          }

          readiness_probe {
            tcp_socket {
              port = "coordinator"
            }
          }
        }
      }
    }
  }
}

resource "kubernetes_deployment_v1" "gateway" {
  metadata {
    name      = "gateway"
    namespace = var.namespace
    labels    = local.labels
  }

  spec {
    replicas = 1

    selector {
      match_labels = merge(local.labels, { "app.kubernetes.io/component" = "gateway" })
    }

    template {
      metadata {
        labels = merge(local.labels, { "app.kubernetes.io/component" = "gateway" })
      }

      spec {
        service_account_name = var.service_account_name

        container {
          name  = "gateway"
          image = var.gateway_image

          port {
            name           = "gateway"
            container_port = var.gateway_port
          }

          env {
            name  = "HOST"
            value = "0.0.0.0"
          }

          env {
            name  = "PORT"
            value = tostring(var.gateway_port)
          }

          env_from {
            config_map_ref {
              name = kubernetes_config_map_v1.runtime.metadata[0].name
            }
          }

          env_from {
            secret_ref {
              name = var.gateway_secret_name
            }
          }

          readiness_probe {
            tcp_socket {
              port = "gateway"
            }
          }
        }
      }
    }
  }
}

resource "kubernetes_deployment_v1" "delivery" {
  metadata {
    name      = "delivery"
    namespace = var.namespace
    labels    = local.labels
  }

  spec {
    replicas = 1

    selector {
      match_labels = merge(local.labels, { "app.kubernetes.io/component" = "delivery" })
    }

    template {
      metadata {
        labels = merge(local.labels, { "app.kubernetes.io/component" = "delivery" })
      }

      spec {
        service_account_name = var.service_account_name

        container {
          name  = "delivery"
          image = var.delivery_image

          port {
            name           = "grpc"
            container_port = var.delivery_port
          }

          env {
            name  = "HOST"
            value = "0.0.0.0"
          }

          env {
            name  = "PORT"
            value = tostring(var.delivery_port)
          }

          readiness_probe {
            tcp_socket {
              port = "grpc"
            }
          }
        }
      }
    }
  }
}

resource "kubernetes_horizontal_pod_autoscaler_v2" "application" {
  count = var.autoscaling_enabled ? 1 : 0

  metadata {
    name      = "application"
    namespace = var.namespace
    labels    = local.labels
  }

  spec {
    min_replicas = var.autoscaling_min_replicas
    max_replicas = var.autoscaling_max_replicas

    scale_target_ref {
      api_version = "apps/v1"
      kind        = "Deployment"
      name        = kubernetes_deployment_v1.application.metadata[0].name
    }

    metric {
      type = "External"

      external {
        metric {
          name = var.autoscaling_metric
        }

        target {
          type          = "AverageValue"
          average_value = var.autoscaling_target
        }
      }
    }
  }
}
