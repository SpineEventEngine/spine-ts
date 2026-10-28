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
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { Client } from "@spine-event-engine/client-web";
import { ErrorSchema, TenantIdSchema, UserIdSchema } from "@spine-event-engine/proto";
import { BoundedContext, Server, ServerEnvironment } from "@spine-event-engine/server";
import { BrowserServer } from "@spine-event-engine/server/browser";
import { ServerTests } from "@spine-event-engine/server/testing";
import { afterEach, expect, it, vi } from "vitest";

import { CreateProjectSchema } from "../generated/spine/server/testing/project_commands_pb.js";
import { projectWorkflowIds } from "../test-fixtures/project-workflow.js";

afterEach(async () => ServerTests.resetEnvironment());

it("preserves unknown-tenant details through browser gateway and Connect client", async () => {
  const environment = ServerEnvironment.instance();
  await environment.completeSetup();
  const tenant = create(TenantIdSchema, { kind: { case: "value", value: "absent-browser" } });
  const actor = create(UserIdSchema, { value: "guest" });
  const dispatch = vi.fn(() => Promise.resolve());
  const context = await BoundedContext.multitenant("BrowserTenantProof")
    .addCommandDispatcher({
      messageSchemas: () => [CreateProjectSchema],
      dispatch,
    })
    .build();
  const actorContext = { actor, tenant, timestamp: create(TimestampSchema) };
  let native: Awaited<ReturnType<Server["start"]>> | undefined;
  let running: Awaited<ReturnType<typeof BrowserServer.run>> | undefined;
  let client: Client | undefined;
  try {
    native = await new Server({ contexts: [context], port: 0 }).start();
    running = await BrowserServer.open(native, {
      origins: ["http://127.0.0.1:5173"],
      publicAccess: true,
      authorize: () => Promise.resolve(true),
      contexts: {
        resolve: () => Promise.resolve(actorContext),
        resolveContext: () => Promise.resolve(actorContext),
      },
      clock: { now: () => create(TimestampSchema) },
    });
    client = Client.forConnect(running.baseUrl, {
      tenant,
      onRequestMetadata: () => ({ origin: "http://127.0.0.1:5173" }),
    });
    const result = await client
      .asGuest()
      .post(
        CreateProjectSchema,
        create(CreateProjectSchema, {
          project: projectWorkflowIds("browser", 1).project,
          name: "Plan",
        }),
      )
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(result).toBeInstanceOf(ConnectError);
    expect((result as ConnectError).code, String(result)).toBe(Code.NotFound);
    expect((result as ConnectError).findDetails(ErrorSchema)[0]?.type).toBe("TENANT_UNKNOWN");
    expect(dispatch).not.toHaveBeenCalled();
  } finally {
    await closeBrowserResources([
      () => client?.close(),
      () => running?.close(),
      () => native?.close(),
      () => context.close(),
    ]);
  }
});

async function closeBrowserResources(closes: readonly (() => Promise<void> | undefined)[]) {
  const failures: unknown[] = [];
  for (const close of closes)
    try {
      await close();
    } catch (error) {
      failures.push(error);
    }
  if (failures.length > 0)
    throw new AggregateError(failures, "Browser protocol test cleanup failed.");
}
