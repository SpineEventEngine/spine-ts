import { create } from "@bufbuild/protobuf";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { packEvent } from "@spine-event-engine/core";
import { ActorContextSchema, EventContextSchema, EventIdSchema } from "@spine-event-engine/proto";
import type { CommandDispatcher, EventDispatcher } from "@spine-event-engine/server";
import { BoundedContext, Projection, Repository, Server } from "@spine-event-engine/server";
import { describe, expect, it } from "vitest";

import { Client, EntityColumn, EntityQuery, eq } from "../src/index.js";
import { defineGeneratedEntityColumns } from "../src/codegen/index.js";
import { ProjectionStateSchema } from "../test-fixtures/entity-column-fixtures.js";

describe("Client loopback", () => {
  it("receives a decoded state update through the public client subscription", async () => {
    const repository = new Repository({
      entityType: ClientProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.singleTenant("ClientSubscriptions").add(repository).build();
    const server = await new Server({ contexts: [context] }).start();
    const client = Client.connectTo(server.baseUrl);
    try {
      const columns = EntityColumn.register(
        ProjectionStateSchema,
        defineGeneratedEntityColumns(ProjectionStateSchema, {
          title: { field: ProjectionStateSchema.field.title, comparison: "ordering" },
          priority: { field: ProjectionStateSchema.field.priority, comparison: "ordering" },
          status: { field: ProjectionStateSchema.field.status, comparison: "equality" },
          dueAt: { field: ProjectionStateSchema.field.dueAt, comparison: "ordering" },
          owner: { field: ProjectionStateSchema.field.owner, comparison: "equality" },
          fingerprint: { field: ProjectionStateSchema.field.fingerprint, comparison: "equality" },
          active: { field: ProjectionStateSchema.field.active, comparison: "equality" },
          sequence: { field: ProjectionStateSchema.field.sequence, comparison: "ordering" },
        }),
      );
      const states = await client
        .asGuest()
        .subscribeToState(ProjectionStateSchema, StringValueSchema, {
          where: eq(columns.title, "First"),
        });
      const iterator = states[Symbol.asyncIterator]();
      const pending = iterator.next();
      const first = await emitUntil(
        pending,
        () =>
          context
            .stand()
            .update(
              ProjectionStateSchema,
              create(ProjectionStateSchema, { id: "task-1", title: "First" }),
            ),
        "matching state update",
      );
      expect(first).toMatchObject({
        value: { kind: "state", state: { id: "task-1" } },
      });
      await context
        .stand()
        .update(
          ProjectionStateSchema,
          create(ProjectionStateSchema, { id: "task-1", title: "Second" }),
        );
      await expect(iterator.next()).resolves.toMatchObject({
        value: { kind: "noLongerMatching", id: { value: "task-1" } },
      });
      await states.cancel();
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("receives a decoded event and context through the public client subscription", async () => {
    const context = BoundedContext.singleTenant("ClientEvents")
      .addEventDispatcher(eventDispatcher(ProjectionStateSchema))
      .build();
    const server = await new Server({ contexts: [context] }).start();
    const client = Client.connectTo(server.baseUrl);
    try {
      const events = await client.asGuest().subscribeToEvents(ProjectionStateSchema);
      const pending = events[Symbol.asyncIterator]().next();
      let probe = 0;
      const delivered = await emitUntil(
        pending,
        () => {
          probe += 1;
          return context.eventBus().post(
            packEvent({
              id: create(EventIdSchema, { value: `event-${String(probe)}` }),
              context: create(EventContextSchema),
              schema: ProjectionStateSchema,
              message: create(ProjectionStateSchema, {
                id: `task-${String(probe)}`,
                title: "Created",
              }),
            }),
          );
        },
        "event subscription update",
      );
      expect(delivered).toMatchObject({
        value: { message: { title: "Created" }, context: {} },
      });
      await events.cancel();
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("posts and queries through the public client over a native Spine server", async () => {
    const dispatched: string[] = [];
    const dispatcher: CommandDispatcher = {
      messageSchemas: () => [ProjectionStateSchema],
      dispatch(command) {
        dispatched.push(command.id?.uuid ?? "missing");
        return Promise.resolve();
      },
    };
    const context = BoundedContext.singleTenant("ClientLoopback")
      .addCommandDispatcher(dispatcher)
      .build();
    const server = await new Server({ contexts: [context] }).start();
    const client = Client.connectTo(server.baseUrl);

    try {
      const posted = await client
        .asGuest()
        .post(
          ProjectionStateSchema,
          create(ProjectionStateSchema, { id: "task-1", title: "First" }),
        );
      const queried = await client.asGuest().query(
        ProjectionStateSchema,
        EntityQuery.select({
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

class ClientProjection extends Projection<string, typeof ProjectionStateSchema, number> {}

function eventDispatcher(schema: typeof ProjectionStateSchema): EventDispatcher {
  return { messageSchemas: () => [schema], dispatch: () => Promise.resolve() };
}

async function emitUntil<Value>(
  pending: Promise<Value>,
  onEmit: () => Promise<unknown>,
  label: string,
): Promise<Value> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    await onEmit();
    const attempt = await Promise.race([
      pending.then((value) => ({ kind: "value" as const, value })),
      new Promise<{ readonly kind: "retry" }>((resolve) => {
        setTimeout(() => {
          resolve({ kind: "retry" });
        }, 5);
      }),
    ]);
    if (attempt.kind === "value") return attempt.value;
  }
  throw new Error(`Timed out waiting for ${label}.`);
}
