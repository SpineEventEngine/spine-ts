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
import {
  ManagedServerApplication,
  Server,
  ServerEnvironment,
  AppQueryHandler,
} from "../../dist/index.js";
import { registerSpineMetadata } from "../../dist/handler/spine-metadata-inventory.js";
import { managedServerApplicationAccess } from "../../dist/server/managed-server-application.js";
import {
  GetProjectOverview_QuerySchema,
  GetProjectOverview_ResponseSchema,
} from "../../test-fixtures/dist/generated/repository-routing/project_queries_pb.js";
import "../../test-fixtures/dist/generated/proto-module.js";
import process from "node:process";

class ManagedOverviewHandler extends AppQueryHandler {
  execute(query, context) {
    return create(GetProjectOverview_ResponseSchema, {
      project: {
        id: query.project?.value ?? "",
        name: `verified:${context.principal?.id ?? "missing"}`,
      },
    });
  }
}

registerSpineMetadata(
  {
    receivers: [],
    appQueries: [
      {
        handlerType: ManagedOverviewHandler,
        queryTypeName: GetProjectOverview_QuerySchema.typeName,
        querySchema: GetProjectOverview_QuerySchema,
        responseSchema: GetProjectOverview_ResponseSchema,
      },
    ],
  },
  "managed-query-fixture",
);

await ServerEnvironment.instance().completeSetup();
const managed = await ManagedServerApplication.run({
  processCount: 1,
  port: 0,
  moduleUrl: import.meta.url,
  readerAdmission: { direct: { authenticate: () => ({ principal: { id: "managed-reader" } }) } },
  forwardingProof: { issue: () => "managed-proof" },
  createServer: async ({ host, port }) =>
    Server.atPort(port, {
      host,
      appQueries: [new ManagedOverviewHandler()],
      services: {
        readerAdmission: {
          forwarded: { verify: (_bytes, proof) => proof === "managed-proof" },
        },
      },
    }).start(),
});

if (process.env.SPINE_MANAGED_SERVER_CHILD !== "true") {
  process.send?.({
    type: "parent-ready",
    pid: managedServerApplicationAccess.readyMembers(managed)[0]?.pid,
    endpoint: managedServerApplicationAccess.coordinatorEndpoint(managed),
  });
}
