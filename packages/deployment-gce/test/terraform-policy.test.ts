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

import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const terraformRoot = new URL("../terraform/", import.meta.url);
const packageRoot = new URL("../", import.meta.url);
const exec = promisify(execFile);

describe("the GCE deployment template", () => {
  it("defines one private Gateway, delivery server, and regional application group", async () => {
    const terraform = await readOptional(new URL("main.tf", terraformRoot));

    expect(application(terraform)).toContain("distribution_policy_zones = var.application_zones");
    expect(template(terraform, "application")).toContain("REGISTRY_STORAGE_REFERENCE");
    expect(template(terraform, "gateway")).toContain("REGISTRY_STORAGE_REFERENCE");
    for (const name of ["application", "gateway", "delivery"] as const) {
      const source = template(terraform, name);
      expect(source).toContain("docker-credential-gcr configure-docker --registries=");
      expect(source).toContain("DOCKER_CONFIG");
      expect(source).toContain('docker --config "$DOCKER_CONFIG" run --rm --network host');
    }
    expect(resource(terraform, "google_compute_health_check", "application")).not.toBe("");
    expect(resource(terraform, "google_compute_firewall", "private_runtime")).not.toBe("");
    expect(singleton(terraform, "gateway")).toContain("target_size               = 1");
    expect(singleton(terraform, "delivery")).toContain("target_size               = 1");
    for (const [type, name] of [
      ["google_compute_address", "gateway"],
      ["google_compute_address", "delivery"],
      ["google_compute_region_backend_service", "gateway"],
      ["google_compute_region_backend_service", "delivery"],
      ["google_compute_forwarding_rule", "gateway"],
      ["google_compute_forwarding_rule", "delivery"],
    ] as const)
      expect(resource(terraform, type, name)).not.toBe("");
    expect(resources(terraform).some((candidate) => candidate.type === "google_cloud_run")).toBe(
      false,
    );
    expect(terraform.toLowerCase()).not.toContain("mysql");
    expect(terraform.toLowerCase()).not.toContain("datastore");
  });

  it("keeps application autoscaling opt-in and prevents capacity contention", async () => {
    const terraform = await readOptional(new URL("main.tf", terraformRoot));
    const variables = await readOptional(new URL("variables.tf", terraformRoot));

    expect(variables).toMatch(/variable "autoscaling_enabled"[\s\S]*default\s+=\s+false/u);
    expect(variables).toContain('variable "autoscaling_signal"');
    expect(variables).toContain('variable "autoscaling_metric_scope"');
    expect(variables).toContain('variable "autoscaling_metric_filter"');
    expect(variables).toContain('variable "autoscaling_metric_target_type"');
    expect(variables).toContain('variable "autoscaling_metric"');
    expect(variables).toContain('variable "autoscaling_target"');
    expect(variables).toContain('variable "autoscaling_min_replicas"');
    expect(variables).toContain('variable "autoscaling_max_replicas"');
    expect(autoscaler(terraform)).not.toBe("");
    expect(autoscaler(terraform)).toMatch(/count\s+=\s+var\.autoscaling_enabled \? 1 : 0/u);
    expect(application(terraform)).toMatch(
      /target_size\s+=\s+var\.autoscaling_enabled \? null : var\.application_replicas/u,
    );
    expect(application(terraform)).toContain(
      "var.autoscaling_min_replicas <= var.autoscaling_max_replicas",
    );
    expect(application(terraform)).toContain(
      "max_surge_fixed       = length(var.application_zones)",
    );
    expect(application(terraform)).toContain("gce_instance");
    expect(application(terraform)).toContain("resource.type other than");
    expect(application(terraform)).toContain(
      "minimum replicas of zero requires a whole_group Monitoring metric",
    );
    expect(singleton(terraform, "gateway")).toContain('type                  = "PROACTIVE"');
    expect(singleton(terraform, "gateway")).toContain("max_surge_fixed       = 0");
    expect(singleton(terraform, "delivery")).toContain("max_unavailable_fixed = 1");
    expect(autoscaler(terraform)).toContain("filter = var.autoscaling_metric_filter");
    expect(autoscaler(terraform)).toContain("type   = var.autoscaling_metric_target_type");
  });

  it("rejects Monitoring metric scope combinations that cannot scale as declared", () => {
    expect(MonitoringMetrics.matchesScope("per_instance", 'resource.type = "gce_instance"')).toBe(
      true,
    );
    expect(MonitoringMetrics.matchesScope("per_instance", 'resource.type = "global"')).toBe(false);
    expect(MonitoringMetrics.matchesScope("whole_group", 'resource.type = "global"')).toBe(true);
    expect(MonitoringMetrics.matchesScope("whole_group", 'resource.type = "gce_instance"')).toBe(
      false,
    );
    expect(MonitoringMetrics.canScaleFromZero("whole_group", 0)).toBe(true);
    expect(MonitoringMetrics.canScaleFromZero("per_instance", 0)).toBe(false);
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

  it("does not treat comments or heredocs as topology resources", () => {
    const fixture = `# resource "google_compute_region_instance_group_manager" "gateway" {
// resource "google_compute_region_instance_group_manager" "application" {
/* resource "google_compute_region_instance_group_manager" "delivery" { */
metadata_startup_script = <<-EOT
resource "google_compute_region_instance_group_manager" "delivery" {
EOT`;

    const lowercase = `metadata_startup_script = <<-eot
resource "google_compute_region_instance_group_manager" "gateway" {
eot`;

    const quoted =
      'description = "resource \\"google_compute_region_instance_group_manager\\" \\"gateway\\" {"';

    const nested = `locals {
  resource "google_compute_region_instance_group_manager" "gateway" {}
}`;

    expect(resource(fixture, "google_compute_region_instance_group_manager", "gateway")).toBe("");
    expect(resource(fixture, "google_compute_region_instance_group_manager", "application")).toBe(
      "",
    );
    expect(resource(fixture, "google_compute_region_instance_group_manager", "delivery")).toBe("");
    expect(resource(lowercase, "google_compute_region_instance_group_manager", "gateway")).toBe("");
    expect(resource(quoted, "google_compute_region_instance_group_manager", "gateway")).toBe("");
    expect(resource(nested, "google_compute_region_instance_group_manager", "gateway")).toBe("");
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
    expect(guide).toMatch(/pending\s+Inbox work may execute under the new version/iu);
    expect(guide).toContain("Gateway interruption");
    expect(guide).toContain("roles/artifactregistry.reader");
    expect(guide).toContain("docker-credential-gcr");
    expect(guide).toContain("google-startup-scripts.service");
    expect(guide).toContain("autoscaling_min_replicas = 0");
    expect(guide).toContain(
      "gcloud compute instance-groups managed list-instances spine-application",
    );
    expect(guide).not.toMatch(/\bT-0127\b|\bWave 7\b/u);
  });

  it("links to the packaged entrypoint examples", async () => {
    const guide = await readOptional(new URL("README.md", packageRoot));
    const application = await readOptional(new URL("examples/application.ts", packageRoot));
    const gateway = await readOptional(new URL("examples/gateway.ts", packageRoot));

    expect(guide).toContain("[`GceApplicationEntrypoint`](examples/application.ts)");
    expect(guide).toContain("[`examples/gateway.ts`](examples/gateway.ts)");
    expect(application).toContain("ManagedServerApplication");
    expect(application).toContain("GceRegistrar");
    expect(application).toContain("processCount");
    expect(application).toContain("deliveryShardCount");
    expect(application).toContain("await registrar.start()");
    expect(application).toContain("() => registrar.close()");
    expect(application).toContain("storageFactoryFor");
    expect(application).not.toContain("Server.atPort");
    expect(gateway).toContain("GceNodeDiscovery");
    expect(gateway).toContain("storageFactoryFor");
  });

  it("publishes each ready node Coordinator rather than a managed child listener", async () => {
    const terraform = await readOptional(new URL("main.tf", terraformRoot));
    const application = await readOptional(new URL("examples/application.ts", packageRoot));

    expect(template(terraform, "application")).toContain("APPLICATION_PROCESS_COUNT");
    expect(template(terraform, "application")).toContain("DELIVERY_SHARD_COUNT");
    expect(application).toContain("GceDeploymentSettings.processCount(environment)");
    expect(application).toContain("GceDeploymentSettings.deliveryShardCount(environment)");
    expect(application).toContain("new GceRegistrar({ registry, port })");
  });

  it("requires deployer-selected process and Delivery shard counts", async () => {
    const variables = await readOptional(new URL("variables.tf", terraformRoot));
    const values = await readOptional(new URL("terraform.tfvars.example", terraformRoot));

    for (const name of ["application_process_count", "delivery_shard_count"] as const) {
      const declaration = variables.slice(
        variables.indexOf(`variable "${name}"`),
        variables.indexOf("\nvariable ", variables.indexOf(`variable "${name}"`) + 1),
      );
      expect(declaration).not.toMatch(/default\s*=/u);
      expect(values).toMatch(new RegExp(`^${name}\\s*=`, "mu"));
    }
  });

  it("packs the Terraform template and entrypoints", async () => {
    const directory = await mkdtemp(join(tmpdir(), "spine-gce-pack-"));
    try {
      await exec("pnpm", ["pack", "--pack-destination", directory], {
        cwd: new URL("../", import.meta.url),
      });
      const archive = (await readdir(directory)).find((file) => file.endsWith(".tgz"));
      expect(archive).toBeDefined();
      const { stdout } = await exec("tar", ["-tzf", join(directory, archive ?? "")]);
      for (const path of [
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

async function readOptional(path: URL): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

function application(terraform: string): string {
  return resource(terraform, "google_compute_region_instance_group_manager", "application");
}

function singleton(terraform: string, name: "gateway" | "delivery"): string {
  return resource(terraform, "google_compute_region_instance_group_manager", name);
}

function autoscaler(terraform: string): string {
  return resource(terraform, "google_compute_region_autoscaler", "application");
}

function resource(terraform: string, type: string, name: string): string {
  return (
    resources(terraform).find((candidate) => candidate.type === type && candidate.name === name)
      ?.source ?? ""
  );
}

function template(terraform: string, name: string): string {
  return resource(terraform, "google_compute_instance_template", name);
}

function resources(terraform: string): readonly HclResource[] {
  return HclResources.read(terraform);
}

interface HclResource {
  readonly type: string;
  readonly name: string;
  readonly source: string;
}

const HclResources = Object.freeze({
  read(source: string): readonly HclResource[] {
    const resources: HclResource[] = [];
    let index = 0;
    let depth = 0;
    while (index < source.length) {
      index = this.skipTrivia(source, index);
      if (source[index] === '"') {
        const value = this.stringAt(source, index);
        index = value?.end ?? source.length;
        continue;
      }
      if (source[index] === "{") {
        depth++;
        index++;
        continue;
      }
      if (source[index] === "}") {
        depth = Math.max(0, depth - 1);
        index++;
        continue;
      }
      if (depth !== 0 || !this.keywordAt(source, index, "resource")) {
        index++;
        continue;
      }
      const start = index;
      index = this.skipTrivia(source, index + "resource".length);
      const type = this.stringAt(source, index);
      if (type === undefined) {
        index++;
        continue;
      }
      index = this.skipTrivia(source, type.end);
      const name = this.stringAt(source, index);
      if (name === undefined) {
        index++;
        continue;
      }
      index = this.skipTrivia(source, name.end);
      if (source[index] !== "{") {
        index++;
        continue;
      }
      const end = this.blockEnd(source, index);
      if (end === undefined) return resources;
      resources.push({ type: type.value, name: name.value, source: source.slice(start, end) });
      index = end;
    }
    return resources;
  },

  blockEnd(source: string, index: number): number | undefined {
    let depth = 0;
    while (index < source.length) {
      const next = this.skipTrivia(source, index);
      if (next !== index) {
        index = next;
        continue;
      }
      if (source[index] === '"') {
        const value = this.stringAt(source, index);
        if (value === undefined) return undefined;
        index = value.end;
        continue;
      }
      if (source[index] === "{") depth++;
      if (source[index] === "}" && --depth === 0) return index + 1;
      index++;
    }
    return undefined;
  },

  skipTrivia(source: string, index: number): number {
    for (;;) {
      while (/\s/u.test(source[index] ?? "")) index++;
      if (source.startsWith("#", index) || source.startsWith("//", index)) {
        index = source.indexOf("\n", index);
        if (index < 0) return source.length;
        continue;
      }
      if (source.startsWith("/*", index)) {
        index = source.indexOf("*/", index + 2);
        if (index < 0) return source.length;
        index += 2;
        continue;
      }
      const heredoc = /^<<-?([A-Za-z][A-Za-z0-9_]*)\s*\n/u.exec(source.slice(index));
      if (heredoc === null) return index;
      const delimiter = heredoc[1];
      if (delimiter === undefined) return source.length;
      const terminator = new RegExp(`^\\s*${delimiter}\\s*$`, "mu");
      const match = terminator.exec(source.slice(index + heredoc[0].length));
      if (match === null) return source.length;
      index += heredoc[0].length + match.index + match[0].length;
    }
  },

  keywordAt(source: string, index: number, keyword: string): boolean {
    return (
      source.startsWith(keyword, index) &&
      !/[A-Za-z0-9_]/u.test(source[index + keyword.length] ?? "")
    );
  },

  stringAt(
    source: string,
    index: number,
  ): { readonly value: string; readonly end: number } | undefined {
    if (source[index] !== '"') return undefined;
    let value = "";
    for (let cursor = index + 1; cursor < source.length; cursor++) {
      if (source[cursor] === "\\") {
        value += source[cursor + 1] ?? "";
        cursor++;
        continue;
      }
      if (source[cursor] === '"') return { value, end: cursor + 1 };
      value += source[cursor] ?? "";
    }
    return undefined;
  },
});

const MonitoringMetrics = Object.freeze({
  matchesScope(scope: "per_instance" | "whole_group", filter: string): boolean {
    const instance = /resource\.type\s*=\s*"gce_instance"/u.test(filter);
    return scope === "per_instance" ? instance : /resource\.type\s*=/u.test(filter) && !instance;
  },

  canScaleFromZero(scope: "per_instance" | "whole_group", minimum: number): boolean {
    return minimum !== 0 || scope === "whole_group";
  },
});
