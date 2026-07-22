import { create } from "@bufbuild/protobuf";
import { ActorContextSchema } from "@spine-ts/proto";
import type { CommandDispatcher } from "@spine-ts/server";
import { BoundedContext, Server } from "@spine-ts/server";
import { describe, expect, it } from "vitest";

import { Client, ProjectionQuery } from "../src/index.js";
import { ProjectionStateSchema } from "../test-fixtures/projection-column-fixtures.js";

describe("Client loopback", () => {
  it("posts and queries through the public client over a native Spine server", async () => {
    const dispatched: string[] = [];
    const dispatcher: CommandDispatcher = {
      messageSchemas: () => [ProjectionStateSchema],
      dispatch(command) {
        dispatched.push(command.id?.uuid ?? "missing");
        return Promise.resolve();
      },
    };
    const context = BoundedContext.singleTenant("ClientLoopback").addCommandDispatcher(dispatcher).build();
    const server = await new Server({ contexts: [context] }).start();
    const client = Client.connectTo(server.baseUrl);

    try {
      const posted = await client.asGuest().post(
        ProjectionStateSchema,
        create(ProjectionStateSchema, { id: "task-1", title: "First" }),
      );
      const queried = await client.asGuest().query(
        ProjectionStateSchema,
        ProjectionQuery.select({
          schema: ProjectionStateSchema,
          columns: {} as never,
          context: create(ActorContextSchema),
        }),
      );

      expect(posted.kind).toBe("ok");
      expect(dispatched).toHaveLength(1);
      expect(queried.kind).toBe("error");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
