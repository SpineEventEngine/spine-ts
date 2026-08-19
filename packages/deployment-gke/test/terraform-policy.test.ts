/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const terraformRoot = new URL("../terraform/", import.meta.url);
const packageRoot = new URL("../", import.meta.url);
const exec = promisify(execFile);

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
    expect(terraform).toContain("APPLICATION_PROCESS_COUNT");
    expect(terraform).toContain("DELIVERY_SHARD_COUNT");
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
  it("keeps shared Gateway guidance aligned with GKE and GCE discovery", async () => {
    const architecture = await readFile(
      new URL("../../../docs/architecture/README.md", import.meta.url),
      "utf8",
    );
    const browserGuide = await readFile(
      new URL("../../../docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md", import.meta.url),
      "utf8",
    );

    expect(architecture).toMatch(
      /one standalone Gateway dynamically\s+discovers application nodes on GKE or GCE/iu,
    );
    expect(architecture).toMatch(/GKE headless-Service DNS or GCE\s+leased discovery/u);
    expect(architecture).not.toContain("fixed 1–32 backend list");
    expect(browserGuide).toMatch(
      /one standalone Gateway dynamically\s+discovers application nodes on GKE or GCE/iu,
    );
    expect(browserGuide).toMatch(/not a hard runtime\s+maximum/u);
    expect(browserGuide).not.toContain("fixed 1–32 backend list");
  });

  it("records executable replacement and restart evidence in the capacity profile", async () => {
    const profile = await readFile(
      new URL("../../../build-protocol/reports/T-0128_CAPACITY_PROFILE.md", import.meta.url),
      "utf8",
    );

    for (const suite of [
      "packages/auth/test/dynamic-subscription-creator.test.ts",
      "packages/server/test/server/durable-subscription-bindings.test.ts",
      "packages/client-react/test/client-react.test.ts",
      "packages/deployment-gke/test/discovery/gke-node-discovery.test.ts",
      "packages/deployment-gce/test/registry/registry-reader.test.ts",
    ])
      expect(profile).toContain(suite);
    expect(profile).toMatch(/compatible.*overlap/iu);
    expect(profile).toMatch(/incompatible[\s\S]*stop-all/iu);
    expect(profile).toMatch(/authoritative re-query/iu);
  });

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
    expect(guide).toContain('"BACKEND_DISCOVERY_PORT"');
    expect(guide).toContain("BACKEND_DISCOVERY_SERVICE");
    expect(guide).toContain("DurableSubscriptionBindings");
    expect(guide).toContain("shared persistent storage across Gateway replacements");
    expect(guide).toMatch(/production\s+startup rejects missing or volatile bindings/iu);
    expect(guide).toContain("kubectl rollout status deployment/application");
    expect(guide).toContain("kubectl rollout status deployment/gateway");
    expect(guide).toContain("kubectl rollout status deployment/delivery");
    expect(guide).toContain("sole autoscaler");
    expect(guide).toContain("suspend or remove the KEDA policy");
    expect(guide).not.toMatch(/\bT-0126\b|\bWave 7\b/);
  });

  it("points its entrypoint snippets to runnable packaged examples", async () => {
    const guide = await readFile(new URL("README.md", packageRoot), "utf8");
    const settings = await readFile(
      new URL("examples/deployment-settings.ts", packageRoot),
      "utf8",
    );
    const application = await readFile(new URL("examples/application.ts", packageRoot), "utf8");
    const gateway = await readFile(new URL("examples/gateway.ts", packageRoot), "utf8");

    expect(guide).toContain(
      "// docs-snippet-path: packages/deployment-gke/examples/deployment-settings.ts",
    );
    expect(guide).toContain(
      "// docs-snippet-path: packages/deployment-gke/examples/application.ts",
    );
    expect(guide).toContain("// docs-snippet-path: packages/deployment-gke/examples/gateway.ts");
    expect(settings).toContain("DeploymentSettings");
    expect(application).toContain('from "./deployment-settings.js"');
    expect(application).toContain("process.env");
    expect(application).toContain("ManagedServerApplication");
    expect(application).toContain("processCount");
    expect(application).toContain("deliveryShardCount");
    expect(application).not.toContain("Server.atPort");
    expect(gateway).toContain('from "./deployment-settings.js"');
    expect(gateway).toContain("process.env");
    expect(guide).toContain(
      'import { DeploymentSettings, type DeploymentEnvironment } from "./deployment-settings.js";',
    );
    expect(guide).toContain("environment: DeploymentEnvironment = process.env");
    expect(guide).not.toContain("declare const DeploymentSettings");
  });

  it("uses ready Pod Coordinator listeners as the Gateway discovery targets", async () => {
    const terraform = await readTerraform();
    const application = await readFile(new URL("examples/application.ts", packageRoot), "utf8");
    const gateway = await readFile(new URL("examples/gateway.ts", packageRoot), "utf8");

    expect(resource(terraform, "kubernetes_service_v1", "application")).toContain(
      'target_port = "coordinator"',
    );
    expect(resource(terraform, "kubernetes_deployment_v1", "application")).toContain(
      'name           = "coordinator"',
    );
    expect(application).toContain("DeploymentSettings.processCount(environment)");
    expect(application).toContain("DeploymentSettings.deliveryShardCount(environment)");
    expect(gateway).toContain("GkeNodeDiscovery");
  });

  it("requires deployer-selected process and Delivery shard counts", async () => {
    const variables = await readFile(new URL("variables.tf", terraformRoot), "utf8");
    const values = await readFile(new URL("terraform.tfvars.example", terraformRoot), "utf8");

    for (const name of ["application_process_count", "delivery_shard_count"] as const) {
      const declaration = variables.slice(
        variables.indexOf(`variable \"${name}\"`),
        variables.indexOf("\nvariable ", variables.indexOf(`variable \"${name}\"`) + 1),
      );
      expect(declaration).not.toMatch(/default\s*=/u);
      expect(values).toMatch(new RegExp(`^${name}\\s*=`, "mu"));
    }
  });

  it("packs the Terraform and entrypoint deliverables", async () => {
    const directory = await mkdtemp(join(tmpdir(), "spine-gke-pack-"));
    try {
      await exec("pnpm", ["pack", "--pack-destination", directory], {
        cwd: new URL("../", import.meta.url),
      });
      const archive = (await readdir(directory)).find((file) => file.endsWith(".tgz"));
      expect(archive).toBeDefined();
      const { stdout } = await exec("tar", ["-tzf", join(directory, archive ?? "")]);
      for (const path of [
        "package/examples/deployment-settings.ts",
        "package/examples/application.ts",
        "package/examples/gateway.ts",
        "package/terraform/main.tf",
        "package/terraform/variables.tf",
        "package/terraform/terraform.tfvars.example",
        "package/terraform/.terraform.lock.hcl",
      ])
        expect(stdout).toContain(path);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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
