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

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { Projection } from "../../src/entity/entity.js";
import {
  type ServerStarted,
  ServerStartedSchema,
} from "../../test-fixtures/generated/server-lifecycle/events_pb.js";
import { ServerStatusSchema } from "../../test-fixtures/generated/server-lifecycle/states_pb.js";

/**
 * Real server-status Projection used to register a Delivery recipient.
 */
export class ServerStatusProjection extends Projection<string, typeof ServerStatusSchema> {
  /**
   * @param event Server startup event accepted by this Projection.
   */
  onServerStarted(event: ServerStarted): void {
    void event;
  }
}

/**
 * Creates generated-handler metadata for the server-status fixture.
 */
export function serverStatusRegistry(): { readonly directory: string; readonly root: URL } {
  const slot = `__spineServerEnvironment_${Math.random().toString(36).slice(2)}`;
  const directory = mkdtempSync(join(tmpdir(), "spine-server-environment-"));
  const moduleDirectory = join(directory, "generated/handler");
  mkdirSync(moduleDirectory, { recursive: true });
  (globalThis as Record<string, unknown>)[slot] = Object.freeze({
    receivers: [
      {
        receiverKind: "entity",
        receiverType: ServerStatusProjection,
        stateSchema: ServerStatusSchema,
        handlers: [
          {
            kind: "event-subscription",
            methodName: "onServerStarted",
            input: { schema: ServerStartedSchema, origin: "domestic" },
            outcomes: { returned: [], thrown: [] },
            parameterCount: 1,
          },
        ],
      },
    ],
  });
  writeFileSync(
    join(moduleDirectory, "generated-handler-registry.js"),
    `export const generatedHandlerRegistry = globalThis[${JSON.stringify(slot)}];\n`,
    "utf8",
  );
  return Object.freeze({ directory, root: pathToFileURL(directory) });
}
