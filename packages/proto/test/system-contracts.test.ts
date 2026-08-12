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

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getOption } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { type_url_prefix } from "../src/index.js";
import * as curatedSchemas from "../src/index.js";
import { InboxLabel } from "../generated/spine/server/delivery/inbox_pb.js";
import { required, validate } from "../generated/spine/options_pb.js";
import {
  EntityStateChangedSchema,
  file_spine_system_server_entity_log_events,
} from "../generated/spine/system/server/entity_log_events_pb.js";
import { EntityTypeNameSchema } from "../generated/spine/system/server/entity_type_pb.js";

interface SourceEntry {
  readonly localPath: string;
  readonly commit: string;
  readonly upstreamPath: string;
  readonly sha256: string;
}

interface SourceManifest {
  readonly sources: readonly SourceEntry[];
  readonly ownedSources?: readonly {
    readonly localPath: string;
    readonly sha256: string;
  }[];
}

function source(manifest: SourceManifest, localPath: string): SourceEntry {
  const entry = manifest.sources.find((candidate) => candidate.localPath === localPath);
  if (entry === undefined) {
    throw new Error(`Expected frozen source ${localPath}.`);
  }
  return entry;
}

function field<T extends { readonly name: string }>(
  fields: readonly T[],
  name: string,
  message: string,
): T {
  const descriptor = fields.find((candidate) => candidate.name === name);
  if (descriptor === undefined) {
    throw new Error(`Expected ${message} field ${name}.`);
  }
  return descriptor;
}

describe("distributed delivery system contracts", () => {
  it("pins the JVM EntityStateChanged event and its dependency byte-for-byte", () => {
    const manifest = JSON.parse(
      readFileSync(resolve("packages/proto/proto/spine-sources.json"), "utf8"),
    ) as SourceManifest;
    const commit = "461a8281e484c12636d8cf660a1d6c929fbbd7ec";

    for (const [localPath, upstreamPath] of [
      [
        "packages/proto/proto/spine/system/server/entity_log_events.proto",
        "server/src/main/proto/spine/system/server/entity_log_events.proto",
      ],
      [
        "packages/proto/proto/spine/system/server/entity_type.proto",
        "server/src/main/proto/spine/system/server/entity_type.proto",
      ],
    ] as const) {
      const entry = source(manifest, localPath);
      expect(entry.commit).toBe(commit);
      expect(entry.upstreamPath).toBe(upstreamPath);
      expect(
        createHash("sha256")
          .update(readFileSync(resolve(localPath)))
          .digest("hex"),
      ).toBe(entry.sha256);
    }
  });

  it("keeps EntityStateChanged on its exact wire shape", () => {
    const eventSource = readFileSync(
      resolve("packages/proto/proto/spine/system/server/entity_log_events.proto"),
      "utf8",
    );

    expect(eventSource).toContain("package spine.system.server;");
    expect(eventSource).toContain('option (type_url_prefix) = "type.spine.io";');
    expect(eventSource).toMatch(/core\.MessageId entity = 1 \[\(required\) = true\];/u);
    expect(eventSource).toMatch(/google\.protobuf\.Any new_state = 2 \[\(required\) = true\];/u);
    expect(eventSource).toMatch(
      /repeated core\.MessageId signal_id = 3 \[\(required\) = true, \(validate\) = true\];/u,
    );
    expect(eventSource).toMatch(/google\.protobuf\.Timestamp when = 4;/u);
    expect(eventSource).toMatch(/core\.Version new_version = 5;/u);
    expect(eventSource).toMatch(/google\.protobuf\.Any old_state = 6;/u);
  });

  it("generates internal schemas with the exact field numbers and type URL prefix", () => {
    expect(EntityStateChangedSchema.typeName).toBe("spine.system.server.EntityStateChanged");
    expect(EntityTypeNameSchema.typeName).toBe("spine.system.server.EntityTypeName");
    expect(getOption(file_spine_system_server_entity_log_events, type_url_prefix)).toBe(
      "type.spine.io",
    );
    expect(EntityStateChangedSchema.fields.map((field) => [field.name, field.number])).toEqual([
      ["entity", 1],
      ["old_state", 6],
      ["new_state", 2],
      ["signal_id", 3],
      ["when", 4],
      ["new_version", 5],
    ]);
    expect(
      getOption(field(EntityStateChangedSchema.fields, "entity", "EntityStateChanged"), required),
    ).toBe(true);
    expect(
      getOption(
        field(EntityStateChangedSchema.fields, "signal_id", "EntityStateChanged"),
        required,
      ),
    ).toBe(true);
    expect(
      getOption(
        field(EntityStateChangedSchema.fields, "signal_id", "EntityStateChanged"),
        validate,
      ),
    ).toBe(true);
  });

  it("reuses the frozen Inbox labels", () => {
    const inboxSource = readFileSync(
      resolve("packages/proto/proto/spine/server/delivery/inbox.proto"),
      "utf8",
    );

    expect(inboxSource).toMatch(/HANDLE_COMMAND = 1;/u);
    expect(inboxSource).toMatch(/UPDATE_SUBSCRIBER = 3;/u);
    expect(inboxSource).toMatch(/REACT_UPON_EVENT = 4;/u);
    expect(InboxLabel.HANDLE_COMMAND).toBe(1);
    expect(InboxLabel.UPDATE_SUBSCRIBER).toBe(3);
    expect(InboxLabel.REACT_UPON_EVENT).toBe(4);
  });

  it("keeps system contracts out of curated end-user exports", () => {
    expect(curatedSchemas).not.toHaveProperty("EntityStateChangedSchema");
    expect(curatedSchemas).not.toHaveProperty("EntityTypeNameSchema");
    const packageJson = JSON.parse(
      readFileSync(resolve("packages/proto/package.json"), "utf8"),
    ) as { readonly exports: Readonly<Record<string, unknown>> };

    expect(packageJson.exports).not.toHaveProperty("./system");
  });
});
