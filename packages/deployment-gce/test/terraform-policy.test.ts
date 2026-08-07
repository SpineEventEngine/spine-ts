import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const terraformRoot = new URL("../terraform/", import.meta.url);
const packageRoot = new URL("../", import.meta.url);

describe("the GCE deployment template", () => {
  it("defines one private Gateway, delivery server, and regional application group", async () => {
    const terraform = await readOptional(new URL("main.tf", terraformRoot));

    expect(terraform).toContain('resource "google_compute_region_instance_group_manager" "application"');
    expect(terraform).toContain('resource "google_compute_instance_template" "application"');
    expect(terraform).toContain('resource "google_compute_instance_template" "gateway"');
    expect(terraform).toContain('resource "google_compute_instance_template" "delivery"');
    expect(terraform).toContain('resource "google_compute_health_check" "application"');
    expect(terraform).toContain('resource "google_compute_firewall" "private_runtime"');
    expect(terraform).toContain('resource "google_compute_address" "gateway"');
    expect(terraform).toContain('resource "google_compute_region_instance_group_manager" "gateway"');
    expect(terraform).toContain('target_size = 1');
    expect(terraform).toContain('DELIVERY_SERVER_URL');
    expect(terraform).toContain('REGISTRY_NAMESPACE');
    expect(terraform).toContain('REGISTRY_STORAGE_REFERENCE');
    expect(terraform).not.toContain('google_cloud_run');
    expect(terraform.toLowerCase()).not.toContain("mysql");
    expect(terraform.toLowerCase()).not.toContain("datastore");
  });

  it("keeps application autoscaling opt-in and prevents capacity contention", async () => {
    const terraform = await readOptional(new URL("main.tf", terraformRoot));
    const variables = await readOptional(new URL("variables.tf", terraformRoot));

    expect(variables).toMatch(/variable "autoscaling_enabled"[\s\S]*default\s+=\s+false/u);
    expect(variables).toContain('variable "autoscaling_metric_type"');
    expect(variables).toContain('variable "autoscaling_metric"');
    expect(variables).toContain('variable "autoscaling_target"');
    expect(variables).toContain('variable "autoscaling_min_replicas"');
    expect(variables).toContain('variable "autoscaling_max_replicas"');
    expect(terraform).toContain('resource "google_compute_region_autoscaler" "application"');
    expect(terraform).toContain("count = var.autoscaling_enabled ? 1 : 0");
    expect(terraform).toContain("target_size = var.autoscaling_enabled ? null : var.application_replicas");
    expect(terraform).toContain("var.autoscaling_min_replicas <= var.autoscaling_max_replicas");
  });

  it("accepts references instead of secret values and immutable images", async () => {
    const terraform = await readOptional(new URL("main.tf", terraformRoot));
    const variables = await readOptional(new URL("variables.tf", terraformRoot));
    const values = await readOptional(new URL("terraform.tfvars.example", terraformRoot));

    expect(variables).toContain('variable "application_secret_reference"');
    expect(variables).toContain('variable "gateway_secret_reference"');
    expect(terraform).toContain("APPLICATION_SECRET_REFERENCE");
    expect(terraform).toContain("GATEWAY_SECRET_REFERENCE");
    expect(terraform).not.toContain('resource "google_secret_manager_secret"');
    expect(values).toContain("@sha256:REPLACE");
  });
});

describe("the GCE deployment guide", () => {
  it("teaches a beginner to deploy, scale, replace, recover, and remove the topology", async () => {
    const guide = await readOptional(new URL("README.md", packageRoot));

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
    ])
      expect(guide).toContain(heading);
    expect(guide).toContain("terraform init");
    expect(guide).toContain("terraform plan");
    expect(guide).toContain("terraform apply");
    expect(guide).toContain("20 seconds");
    expect(guide).toContain("60 seconds");
    expect(guide).toContain("10 seconds");
    expect(guide).toMatch(/scale.from.zero/iu);
    expect(guide).toContain("pending Inbox work may execute under the new version");
    expect(guide).toContain("Gateway interruption");
    expect(guide).not.toMatch(/\bT-0127\b|\bWave 7\b/u);
  });

  it("points entrypoint snippets to packaged examples", async () => {
    const guide = await readOptional(new URL("README.md", packageRoot));
    const application = await readOptional(new URL("examples/application.ts", packageRoot));
    const gateway = await readOptional(new URL("examples/gateway.ts", packageRoot));

    expect(guide).toContain("// docs-snippet-path: packages/deployment-gce/examples/application.ts");
    expect(guide).toContain("// docs-snippet-path: packages/deployment-gce/examples/gateway.ts");
    expect(application).toContain("GceRegistrar");
    expect(application).toContain("Server.atPort");
    expect(gateway).toContain("GceRegistryReader");
    expect(gateway).toContain("ScheduledNodeDiscovery");
  });
});

async function readOptional(path: URL): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}
