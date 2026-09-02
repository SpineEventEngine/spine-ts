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

import type { Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { spineProtoModule as packageModule, type ProtoModule } from "@spine-event-engine/proto";

import * as clientSchemas from "../src/client/index.js";
import * as authSchemas from "../src/auth/index.js";
import * as deliverySchemas from "../src/delivery/index.js";
import * as deliveryServerSchemas from "../src/delivery-server/index.js";
import * as errorSchemas from "../generated/spine/base/error_pb.js";
import * as fieldPathSchemas from "../generated/spine/base/field_path_pb.js";
import * as ackSchemas from "../generated/spine/core/ack_pb.js";
import * as actorContextSchemas from "../generated/spine/core/actor_context_pb.js";
import * as commandSchemas from "../generated/spine/core/command_pb.js";
import * as boundedContextSchemas from "../generated/spine/core/bounded_context_pb.js";
import * as diagnosticsSchemas from "../generated/spine/core/diagnostics_pb.js";
import * as enrichmentSchemas from "../generated/spine/core/enrichment_pb.js";
import * as eventSchemas from "../generated/spine/core/event_pb.js";
import * as responseSchemas from "../generated/spine/core/response_pb.js";
import * as tenantSchemas from "../generated/spine/core/tenant_id_pb.js";
import * as userSchemas from "../generated/spine/core/user_id_pb.js";
import * as versionSchemas from "../generated/spine/core/version_pb.js";
import * as emailSchemas from "../generated/spine/net/email_address_pb.js";
import * as domainSchemas from "../generated/spine/net/internet_domain_pb.js";
import * as optionSchemas from "../generated/spine/options_pb.js";
import * as stringSchemas from "../generated/spine/string/template_string_pb.js";
import * as timeSchemas from "../generated/spine/time/time_pb.js";
import * as timeOptionSchemas from "../generated/spine/time_options_pb.js";
import * as languageSchemas from "../generated/spine/ui/language_pb.js";
import * as validationSchemas from "../generated/spine/validation/validation_error_pb.js";
import * as catchUpSchemas from "../generated/spine/server/catchup/catch_up_pb.js";
import * as entitySchemas from "../generated/spine/server/entity/entity_pb.js";
import * as entityStateKeySchemas from "../generated/spine/server/entity/state_key_pb.js";
import * as environmentSchemas from "../generated/spine/server/server_environment_pb.js";
import * as integrationSchemas from "../generated/spine/server/integration/broker_pb.js";
import * as transportSchemas from "../generated/spine/server/transport/transport_pb.js";
import * as nodeDiscoverySchemas from "../generated/spine/deployment/node_discovery_pb.js";
import * as systemEventSchemas from "../generated/spine/system/server/entity_log_events_pb.js";
import * as systemTypeSchemas from "../generated/spine/system/server/entity_type_pb.js";
import { spineProtoModule } from "../generated/proto-module.js";

interface SpineManifest {
  readonly formatVersion: number;
  readonly generationId: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly protoFiles: readonly string[];
  readonly generatedExports: Readonly<Record<string, string>>;
  readonly dependencies: readonly string[];
  readonly moduleExport: string;
}

function schemaNames(exports: object): string[] {
  return Object.values(exports)
    .filter(
      (value): value is GenMessage<Message> =>
        typeof value === "object" &&
        value !== null &&
        (value as { kind?: unknown }).kind === "message",
    )
    .map((schema) => schema.typeName)
    .sort();
}

describe("spineProtoModule", () => {
  it("retains the public descriptor documentation in generated source", () => {
    const source = readFileSync(new URL("../generated/proto-module.ts", import.meta.url), "utf8");

    expect(source).toContain("All Spine schemas shipped by `@spine-event-engine/proto`.");
    expect(source).toContain("Generated from Proto: grpc/health/v1/health.proto");
  });

  it("publishes a deterministic manifest for every owned canonical source", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../spine-proto-manifest.json", import.meta.url), "utf8"),
    ) as unknown as SpineManifest;

    expect(manifest).toMatchObject({
      formatVersion: 2,
      packageName: "@spine-event-engine/proto",
      packageVersion: (() => {
        const packageJson: unknown = JSON.parse(
          readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
        );
        return packageJson !== null && typeof packageJson === "object"
          ? (packageJson as Record<string, unknown>).version
          : undefined;
      })(),
      dependencies: [],
      moduleExport: "spineProtoModule",
    });
    expect(manifest.protoFiles).toHaveLength(50);
    expect(manifest.generationId).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      JSON.parse(
        readFileSync(new URL("../generated/.spine-proto-generation.json", import.meta.url), "utf8"),
      ),
    ).toEqual({ generationId: manifest.generationId });
    expect(Object.keys(manifest.generatedExports)).toEqual(manifest.protoFiles);
    expect(Object.values(manifest.generatedExports)).toEqual(
      manifest.protoFiles.map((path) => `generated/${path.replace(/\.proto$/, "_pb.js")}`),
    );
    expect(JSON.stringify(manifest)).not.toMatch(/(?:file:|workspace:|\/Users\/|\\\\)/u);
  });

  it("is available with its declaration from the package root", () => {
    const module: ProtoModule = packageModule;

    expect(module.name).toBe(spineProtoModule.name);
    expect(module.schemas.map((schema) => schema.typeName)).toEqual(
      spineProtoModule.schemas.map((schema) => schema.typeName),
    );
  });

  it("freezes its descriptor and every shipped Spine message schema inventory", () => {
    const shippedSchemas = [
      ...schemaNames(errorSchemas),
      ...schemaNames(fieldPathSchemas),
      ...schemaNames(ackSchemas),
      ...schemaNames(actorContextSchemas),
      ...schemaNames(commandSchemas),
      ...schemaNames(boundedContextSchemas),
      ...schemaNames(diagnosticsSchemas),
      ...schemaNames(enrichmentSchemas),
      ...schemaNames(eventSchemas),
      ...schemaNames(responseSchemas),
      ...schemaNames(tenantSchemas),
      ...schemaNames(userSchemas),
      ...schemaNames(versionSchemas),
      ...schemaNames(emailSchemas),
      ...schemaNames(domainSchemas),
      ...schemaNames(optionSchemas),
      ...schemaNames(stringSchemas),
      ...schemaNames(timeSchemas),
      ...schemaNames(timeOptionSchemas),
      ...schemaNames(languageSchemas),
      ...schemaNames(validationSchemas),
      ...schemaNames(authSchemas),
      ...schemaNames(clientSchemas),
      ...schemaNames(deliverySchemas),
      ...schemaNames(deliveryServerSchemas),
      ...schemaNames(catchUpSchemas),
      ...schemaNames(entitySchemas),
      ...schemaNames(entityStateKeySchemas),
      ...schemaNames(environmentSchemas),
      ...schemaNames(integrationSchemas),
      ...schemaNames(transportSchemas),
      ...schemaNames(nodeDiscoverySchemas),
      ...schemaNames(systemEventSchemas),
      ...schemaNames(systemTypeSchemas),
    ].sort();

    expect(spineProtoModule.name).toBe("@spine-event-engine/proto");
    expect(spineProtoModule.schemas.map((schema) => schema.typeName)).toEqual(shippedSchemas);
    expect(spineProtoModule.dependencies).toEqual([]);
    expect(Object.isFrozen(spineProtoModule)).toBe(true);
    expect(Object.isFrozen(spineProtoModule.schemas)).toBe(true);
    expect(Object.isFrozen(spineProtoModule.dependencies)).toBe(true);
  });
});
