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

import { Projection } from "../../src/entity/entity.js";
import {
  type ServerStarted,
  ServerStartedSchema,
} from "../../test-fixtures/generated/server-lifecycle/events_pb.js";
import { ServerStatusSchema } from "../../test-fixtures/generated/server-lifecycle/states_pb.js";
import {
  registerSpineMetadata,
  type SpineMetadata,
} from "../../src/handler/spine-metadata-inventory.js";

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

const serverStatusMetadata: SpineMetadata = {
  receivers: [
    {
      receiverKind: "entity" as const,
      receiverType: ServerStatusProjection,
      stateSchema: ServerStatusSchema,
      handlers: [
        {
          kind: "event-subscription" as const,
          methodName: "onServerStarted",
          input: { schema: ServerStartedSchema, origin: "domestic" },
          outcomes: { returned: [], thrown: [] },
          parameterCount: 1,
        },
      ],
    },
  ],
};

/**
 * Creates passive metadata for the server-status fixture.
 */
export function serverStatusRegistry(): void {
  registerSpineMetadata(serverStatusMetadata, "test:server-status-projection");
}
