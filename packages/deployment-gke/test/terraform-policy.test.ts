import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const terraformRoot = new URL("../terraform/", import.meta.url);
const packageRoot = new URL("../", import.meta.url);

describe("the GKE deployment template", () => {
  it("defines the private one-Gateway topology", async () => {
    const terraform = await readTerraform();
    const gateway = resource(terraform, "kubernetes_deployment_v1", "gateway");
    const delivery = resource(terraform, "kubernetes_deployment_v1", "delivery");

    expect(terraform).toContain('resource "kubernetes_deployment_v1" "gateway"');
    expect(terraform).toContain('resource "kubernetes_deployment_v1" "application"');
    expect(terraform).toContain('resource "kubernetes_deployment_v1" "delivery"');
    expect(terraform).toContain('resource "kubernetes_service_v1" "application"');
    expect(terraform).toMatch(/cluster_ip\s+=\s+"None"/u);
    expect(terraform).toMatch(/publish_not_ready_addresses\s+=\s+false/u);
    expect(terraform).toContain("readiness_probe");
    expect(terraform).toContain("BACKEND_DISCOVERY_SERVICE");
    expect(terraform).toContain("service_account_name = var.service_account_name");
    expect(terraform).not.toContain('type = "LoadBalancer"');
    expect(gateway).toMatch(/replicas\s*=\s*1/u);
    expect(delivery).toMatch(/replicas\s*=\s*1/u);
    expect(delivery).toMatch(/name\s*=\s*"HOST"[\s\S]*?value\s*=\s*"0\.0\.0\.0"/u);
    expect(delivery).toContain('name  = "PORT"');
    expect(delivery).toContain("value = tostring(var.delivery_port)");
  });

  it("leaves operator-selected autoscaling disabled by default", async () => {
    const variables = await readFile(new URL("variables.tf", terraformRoot), "utf8");
    const terraform = await readTerraform();

    expect(variables).toMatch(/variable "autoscaling_enabled"[\s\S]*default\s+=\s+false/);
    expect(variables).toContain('variable "autoscaling_metric"');
    expect(variables).toContain('variable "autoscaling_target"');
    expect(variables).toContain('variable "autoscaling_min_replicas"');
    expect(variables).toContain('variable "autoscaling_max_replicas"');
    expect(terraform).toContain("count = var.autoscaling_enabled ? 1 : 0");
    expect(terraform).toContain(
      "replicas = var.autoscaling_enabled ? null : tostring(var.application_replicas)",
    );
    expect(terraform).toContain("var.autoscaling_min_replicas <= var.autoscaling_max_replicas");
    expect(variables).toMatch(/variable "autoscaling_enabled"[\s\S]*?default\s+=\s+false/u);
    expect(variables).toContain("Application port must be an integer from 1 through 65535.");
    expect(variables).toContain("Autoscaling minimum replicas must be a positive integer.");
  });

  it("uses references for secrets and does not select application storage", async () => {
    const terraform = await readTerraform();
    const variables = await readFile(new URL("variables.tf", terraformRoot), "utf8");

    expect(terraform).toContain("secret_ref");
    expect(variables).toContain('variable "application_secret_name"');
    expect(variables).toContain('variable "gateway_secret_name"');
    expect(resource(terraform, "kubernetes_deployment_v1", "application")).toContain(
      "name = var.application_secret_name",
    );
    expect(resource(terraform, "kubernetes_deployment_v1", "gateway")).toContain(
      "name = var.gateway_secret_name",
    );
    expect(terraform.toLowerCase()).not.toContain("mysql");
    expect(terraform.toLowerCase()).not.toContain("datastore");
    expect(terraform.toLowerCase()).not.toContain("cloud run");
    expect(terraform).not.toContain('resource "kubernetes_secret"');
  });
});

describe("the GKE deployment guide", () => {
  it("teaches the complete beginner workflow without internal planning language", async () => {
    const guide = await readFile(new URL("README.md", packageRoot), "utf8");

    for (const heading of [
      "## Before you begin",
      "## What this deployment creates",
      "## Configure the template",
      "## Deploy",
      "## Verify the deployment",
      "## Scale application nodes",
      "## Replace an application version",
      "## Roll back",
      "## Troubleshooting",
      "## Remove the deployment",
    ]) {
      expect(guide).toContain(heading);
    }
    expect(guide).toContain("terraform init");
    expect(guide).toContain("terraform plan");
    expect(guide).toContain("terraform apply");
    expect(guide).toMatch(/durable subscription/iu);
    expect(guide).toContain('host: "0.0.0.0"');
    expect(guide).toContain("DurableSubscriptionBindings");
    expect(guide).toMatch(/production\s+startup rejects missing or volatile bindings/iu);
    expect(guide).toContain("kubectl rollout status deployment/application");
    expect(guide).toContain("kubectl rollout status deployment/gateway");
    expect(guide).toContain("kubectl rollout status deployment/delivery");
    expect(guide).toContain("sole autoscaler");
    expect(guide).not.toMatch(/\bT-0126\b|\bWave 7\b/);
  });
});

async function readTerraform(): Promise<string> {
  return await readFile(new URL("main.tf", terraformRoot), "utf8");
}

function resource(terraform: string, type: string, name: string): string {
  const start = terraform.indexOf(`resource "${type}" "${name}"`);
  const next = terraform.indexOf('\nresource "', start + 1);

  return terraform.slice(start, next === -1 ? undefined : next);
}
