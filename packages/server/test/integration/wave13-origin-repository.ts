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

import { create } from "@bufbuild/protobuf";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { EventContext } from "@spine-event-engine/proto";
import { EventRouting, Projection } from "@spine-event-engine/server";

import { ProjectOverviewStateSchema } from "../../test-fixtures/generated/entity-metadata/project_states_pb.js";
import {
  type ReviewTaskAssigned,
  ReviewTaskAssignedSchema,
} from "../../test-fixtures/generated/handler-registry/events_pb.js";

export const Wave13OriginStateSchema = ProjectOverviewStateSchema;

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

  onDomestic(event: ReviewTaskAssigned, context: EventContext): void {
    Wave13OriginProjection.domesticContexts.push(context);
    this.record(event, "domestic");
  }

  onExternal(event: ReviewTaskAssigned, context: EventContext): void {
    Wave13OriginProjection.externalContexts.push(context);
    this.record(event, "external");
  }

  private record(event: ReviewTaskAssigned, origin: string): void {
    this.update((draft) =>
      Object.assign(
        draft,
        create(Wave13OriginStateSchema, {
          id: event.id,
          name: `${origin}:${event.id}`,
          priority: 1,
        }),
      ),
    );
  }
}

export const wave13OriginRouting = EventRouting.create<string>().route(
  ReviewTaskAssignedSchema,
  (event) => [event.id],
);

export function createWave13OriginRegistry(): { readonly clear: () => void; readonly root: URL } {
  const root = mkdtempSync(join(tmpdir(), "spine-wave13-origin-registry-"));
  const directory = join(root, "generated/handler");
  const slot = `__spineWave13Origin_${crypto.randomUUID().replaceAll("-", "")}`;
  const registry = {
    receivers: [
      {
        receiverKind: "entity",
        receiverType: Wave13OriginProjection,
        stateSchema: Wave13OriginStateSchema,
        handlers: [
          {
            kind: "event-subscription",
            methodName: "onDomestic",
            signalSchema: ReviewTaskAssignedSchema,
            emittedSchemas: [],
            parameterCount: 2,
            origin: "domestic",
          },
          {
            kind: "event-subscription",
            methodName: "onExternal",
            signalSchema: ReviewTaskAssignedSchema,
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
