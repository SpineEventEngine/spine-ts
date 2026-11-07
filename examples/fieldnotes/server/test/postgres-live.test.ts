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

import { randomBytes, randomUUID } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { Client } from "@spine-event-engine/client-web";
import { AnyPacker, StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import { fieldnotesProtoModule } from "@spine-event-engine/example-fieldnotes-model";
import { ActorContextSchema, UserIdSchema } from "@spine-event-engine/proto";
import { AddPlaceSchema } from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/commands_pb.js";
import { RenamePlaceSchema } from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/commands_pb.js";
import { PlaceViewSchema } from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/entities_pb.js";
import { PlaceViewQuery } from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/entities_query.js";
import {
  CoordinatesSchema,
  PlaceIdSchema,
} from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/types_pb.js";
import { ServerTests } from "@spine-event-engine/server/testing";
import {
  SubscriptionService,
  TopicIdSchema,
  TopicSchema,
  type Subscription,
  type SubscriptionUpdate,
} from "@spine-event-engine/proto/client";
import { PostgresStorageFactory } from "@spine-event-engine/storage-postgres";
import { Pool } from "pg";
import { expect, it, vi } from "vitest";
import { FieldnotesHost } from "../src/fieldnotes-host.js";
import type { FieldnotesSettings } from "../src/host-settings.js";

const url = process.env.FIELDNOTES_DATABASE_URL;
if (!url)
  throw new Error("FIELDNOTES_DATABASE_URL is required for Fieldnotes live PostgreSQL tests.");

interface SchemaPool {
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
}

async function withFieldnotesTestSchema(
  pool: SchemaPool,
  schema: string,
  run: () => Promise<void>,
  release: readonly (() => Promise<unknown> | undefined)[],
): Promise<void> {
  const failures: unknown[] = [];
  let created = false;
  try {
    await pool.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await run();
  } catch (error) {
    failures.push(error);
  }
  let released = true;
  for (const close of release) {
    try {
      await close();
    } catch (error) {
      failures.push(error);
      released = false;
    }
  }
  if (created && released) {
    try {
      await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    await pool.end();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, "Fieldnotes PostgreSQL test and cleanup failed.");
}

it("releases the admin pool when unique schema creation fails", async () => {
  const query = vi.fn(() => Promise.reject(new Error("schema creation failed")));
  const end = vi.fn(() => Promise.resolve());
  const run = vi.fn(() => Promise.resolve());
  await expect(
    withFieldnotesTestSchema({ query, end }, "fieldnotes_failure", run, []),
  ).rejects.toThrow("schema creation failed");
  expect(run).not.toHaveBeenCalled();
  expect(query).toHaveBeenCalledTimes(1);
  expect(end).toHaveBeenCalledTimes(1);
});

it("attempts later releases and pool end after an earlier release fails", async () => {
  const query = vi.fn(() => Promise.resolve());
  const end = vi.fn(() => Promise.resolve());
  const later = vi.fn(() => Promise.resolve());
  const primary = new Error("test failed");
  const release = new Error("first release failed");
  const result = withFieldnotesTestSchema(
    { query, end },
    "fieldnotes_failure",
    () => Promise.reject(primary),
    [() => Promise.reject(release), later],
  );
  await expect(result).rejects.toMatchObject({ errors: [primary, release] });
  expect(later).toHaveBeenCalledTimes(1);
  expect(query).toHaveBeenCalledTimes(1);
  expect(end).toHaveBeenCalledTimes(1);
});

it("retains one private Place and its opaque app session across a PostgreSQL host restart", async () => {
  const schema = `fieldnotes_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: url });
  const settings: FieldnotesSettings = {
    postgresUrl: url,
    publicOrigin: "https://localhost:3000",
    sessionPassword: randomBytes(32).toString("base64url"),
    csrfSecret: randomBytes(32),
    readerProofSecret: randomBytes(32),
    sessionTtlMilliseconds: 3_600_000,
    authRouteTimeoutMs: 10_000,
    authRouteMaxBytes: 65_536,
  };
  const factory = () => {
    const stringifiers = new StringifierRegistry();
    stringifiers.setTypeRegistry(TypeRegistry.from(fieldnotesProtoModule));
    return PostgresStorageFactory.newBuilder()
      .setOptions({ url, schema })
      .setStringifierRegistry(stringifiers)
      .build();
  };
  const id = create(PlaceIdSchema, { value: `place-${randomUUID()}` });
  let first: FieldnotesHost | undefined;
  let second: FieldnotesHost | undefined;
  let retained: Subscription | undefined;
  await withFieldnotesTestSchema(
    admin,
    schema,
    async () => {
      first = await FieldnotesHost.open(settings, { storageFactory: await factory() });
      const issued = await first.sessions.issue({ id: "persistent-author" });
      if (issued.kind !== "created") throw new Error("Opaque session issuance failed.");
      const credential = issued.credential.value;
      const clientFor = (host: FieldnotesHost) =>
        Client.forConnect(host.gateway.baseUrl, {
          onRequestMetadata: () => ({
            origin: settings.publicOrigin,
            cookie: `__Host-spine-session=${credential}; __Host-spine-csrf=${host.cookies.csrf(credential)}`,
            "x-spine-csrf": host.cookies.csrf(credential),
          }),
        });
      const rawHeaders = (host: FieldnotesHost, value: string) => ({
        headers: {
          origin: settings.publicOrigin,
          cookie: `__Host-spine-session=${value}; __Host-spine-csrf=${host.cookies.csrf(value)}`,
          "x-spine-csrf": host.cookies.csrf(value),
        },
      });
      const writer = clientFor(first);
      try {
        await writer.onBehalfOf("persistent-author").post(
          AddPlaceSchema,
          create(AddPlaceSchema, {
            id,
            name: "Persisted",
            coordinates: create(CoordinatesSchema, { latitude: 38.7, longitude: -9.1 }),
          }),
        );
        await vi.waitFor(async () => {
          const read = await writer.onBehalfOf("persistent-author").send(
            PlaceViewQuery.create()
              .author()
              .is(create(UserIdSchema, { value: "persistent-author" }))
              .byId(id)
              .build(),
          );
          expect(
            read.message.map((entry) => AnyPacker.tryUnpack(entry.state, PlaceViewSchema)),
          ).toMatchObject([{ id, name: "Persisted" }]);
        });
      } finally {
        await writer.close();
      }
      const firstSubscriptions = createClient(
        SubscriptionService,
        createConnectTransport({
          baseUrl: first.gateway.baseUrl,
          httpVersion: "1.1",
        }),
      );
      retained = await firstSubscriptions.subscribe(
        create(TopicSchema, {
          id: create(TopicIdSchema, { value: `t-${randomUUID()}` }),
          context: create(ActorContextSchema, {
            actor: create(UserIdSchema, { value: "persistent-author" }),
          }),
          target: PlaceViewQuery.create()
            .author()
            .is(create(UserIdSchema, { value: "persistent-author" }))
            .build()
            .build().target,
        }),
        rawHeaders(first, credential),
      );
      await first.close();
      first = undefined;
      await ServerTests.resetEnvironment();
      second = await FieldnotesHost.open(settings, { storageFactory: await factory() });
      expect(await second.sessions.resolve({ kind: "cookie", value: credential })).toMatchObject({
        principal: { id: "persistent-author" },
      });
      const reader = clientFor(second);
      try {
        const read = await reader.onBehalfOf("persistent-author").send(
          PlaceViewQuery.create()
            .author()
            .is(create(UserIdSchema, { value: "persistent-author" }))
            .byId(id)
            .build(),
        );
        expect(
          read.message.map((entry) => AnyPacker.tryUnpack(entry.state, PlaceViewSchema)),
        ).toMatchObject([{ id, name: "Persisted" }]);
        const subscriptions = createClient(
          SubscriptionService,
          createConnectTransport({
            baseUrl: second.gateway.baseUrl,
            httpVersion: "1.1",
          }),
        );
        const foreign = await second.sessions.issue({ id: "foreign-author" });
        if (foreign.kind !== "created")
          throw new Error("Expected retained handle and foreign session.");
        await expect(
          subscriptions.cancel(retained, rawHeaders(second, foreign.credential.value)),
        ).rejects.toThrow();
        const stolen = subscriptions
          .activate(retained, rawHeaders(second, foreign.credential.value))
          [Symbol.asyncIterator]();
        await expect(stolen.next()).rejects.toThrow();
        const active = subscriptions
          .activate(retained, rawHeaders(second, credential))
          [Symbol.asyncIterator]() as AsyncIterator<SubscriptionUpdate, void>;
        const ack = await active.next();
        if (ack.done) throw new Error("Retained subscription closed before activation.");
        expect(ack.value.response?.status?.status.case).toBe("ok");
        await reader
          .onBehalfOf("persistent-author")
          .post(
            RenamePlaceSchema,
            create(RenamePlaceSchema, { id, name: "After restart", expectedRevision: 1 }),
          );
        const update = await active.next();
        if (update.done)
          throw new Error("Retained subscription closed before the new Place state.");
        const entry =
          update.value.update.case === "entityUpdates"
            ? update.value.update.value.update[0]
            : undefined;
        expect(AnyPacker.tryUnpack(entry?.id, PlaceIdSchema)).toEqual(id);
        expect(
          AnyPacker.tryUnpack(
            entry?.kind.case === "state" ? entry.kind.value : undefined,
            PlaceViewSchema,
          ),
        ).toMatchObject({ name: "After restart", author: { value: "persistent-author" } });
        await expect(
          subscriptions.cancel(retained, rawHeaders(second, credential)),
        ).resolves.toBeDefined();
        await active.return?.();
      } finally {
        await reader.close();
      }
    },
    [() => second?.close(), () => first?.close(), () => ServerTests.resetEnvironment()],
  );
});
