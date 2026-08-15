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

import { create, fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import {
  FileDescriptorProtoSchema,
  FileDescriptorSetSchema,
  type StringValue,
} from "@bufbuild/protobuf/wkt";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { file_spine_options, type EventContext } from "@spine-event-engine/proto";
import { EventRouting, Projection } from "../../src/index.js";

import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";

type State = Message<"ProjectionState"> & { id: string; name: string; priority: number };

const set = fromBinary(
  FileDescriptorSetSchema,
  Buffer.from(serverEntityMetadataTestFixtures.main.descriptorSetBase64, "base64"),
);
const descriptor = set.file[0];
if (descriptor === undefined) throw new Error("Wave 13 origin fixture has no descriptor.");
export const Wave13OriginStateSchema = messageDesc(
  fileDesc(Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"), [
    file_spine_options,
  ]),
  0,
) as GenMessage<State>;

export class Wave13OriginProjection extends Projection<
  string,
  typeof Wave13OriginStateSchema,
  number
> {
  static domesticContexts: EventContext[] = [];
  static externalContexts: EventContext[] = [];

  static reset(): void {
    this.domesticContexts = [];
    this.externalContexts = [];
  }

  onDomestic(event: StringValue, context: EventContext): void {
    Wave13OriginProjection.domesticContexts.push(context);
    this.record(event, "domestic");
  }

  onExternal(event: StringValue, context: EventContext): void {
    Wave13OriginProjection.externalContexts.push(context);
    this.record(event, "external");
  }

  private record(event: StringValue, origin: string): void {
    this.update((draft) =>
      Object.assign(
        draft,
        create(Wave13OriginStateSchema, {
          id: event.value,
          name: `${origin}:${event.value}`,
          priority: 1,
        }),
      ),
    );
  }
}

export const wave13OriginRouting = EventRouting.create<string>().route(
  StringValueSchema,
  (event) => [event.value],
);

export function createWave13OriginRegistry(): { readonly clear: () => void; readonly root: URL } {
  const root = mkdtempSync(join(tmpdir(), "spine-wave13-origin-registry-"));
  const directory = join(root, "generated/handler");
  const slot = `__spineWave13Origin_${crypto.randomUUID().replaceAll("-", "")}`;
  const registry = {
    version: 3,
    entities: [
      {
        entityType: Wave13OriginProjection,
        stateSchema: Wave13OriginStateSchema,
        handlers: [
          {
            kind: "event-subscription",
            methodName: "onDomestic",
            signalSchema: StringValueSchema,
            emittedSchemas: [],
            parameterCount: 2,
            origin: "domestic",
          },
          {
            kind: "event-subscription",
            methodName: "onExternal",
            signalSchema: StringValueSchema,
            emittedSchemas: [],
            parameterCount: 2,
            origin: "external",
          },
        ],
      },
    ],
  };
  mkdirSync(directory, { recursive: true });
  (globalThis as Record<string, unknown>)[slot] = registry;
  writeFileSync(
    join(directory, "generated-handler-registry.js"),
    `export const generatedHandlerRegistry = globalThis[${JSON.stringify(slot)}];\n`,
  );
  return {
    root: pathToFileURL(root),
    clear: () => {
      Reflect.deleteProperty(globalThis, slot);
      rmSync(root, { force: true, recursive: true });
    },
  };
}
