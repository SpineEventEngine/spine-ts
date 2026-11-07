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

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { Client } from "@spine-event-engine/client-web";
import {
  AnyPacker,
  QUERY_SERVICE_MAX_RESULTS,
  StringifierRegistry,
  Time,
  TypeRegistry,
} from "@spine-event-engine/core";
import { fieldnotesProtoModule } from "@spine-event-engine/example-fieldnotes-model";
import { ActorContextSchema, UserIdSchema } from "@spine-event-engine/proto";
import { AddPlaceSchema } from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/commands_pb.js";
import { RenamePlaceSchema } from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/commands_pb.js";
import {
  PlaceViewSchema,
  type PlaceView,
} from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/entities_pb.js";
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
import { ColumnTypes, RecordColumn } from "@spine-event-engine/storage";
import { Pool } from "pg";
import { expect, it, vi } from "vitest";
import {
  EntityRecords,
  standEntityStorageDescriptor,
} from "../../../../packages/server/src/entity/entity-storage-descriptor.js";
import { describeEntityMetadata } from "../../../../packages/server/src/entity/entity-metadata.js";
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

/**
 * Builds the paging fixture factory with the same PostgreSQL options in both tests.
 *
 * @param schema Isolated test schema.
 * @param stringifiers Fieldnotes type registry.
 * @param builder PostgreSQL factory builder, injectable for failure testing.
 * @returns Connected storage factory.
 */
function buildPagingStorageFactory(
  schema: string,
  stringifiers: StringifierRegistry,
  builder = PostgresStorageFactory.newBuilder(),
): Promise<PostgresStorageFactory> {
  if (url === undefined) throw new Error("FIELDNOTES_DATABASE_URL is required.");
  return builder.setOptions({ url, schema }).setStringifierRegistry(stringifiers).build();
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

it("releases the admin pool when paging factory construction fails inside its schema scope", async () => {
  const query = vi.fn(() => Promise.resolve());
  const end = vi.fn(() => Promise.resolve());
  const primary = new Error("factory build failed");
  const builder = PostgresStorageFactory.newBuilder();
  const build = vi.spyOn(builder, "build").mockRejectedValue(primary);
  const stringifiers = new StringifierRegistry();
  stringifiers.setTypeRegistry(TypeRegistry.from(fieldnotesProtoModule));
  await expect(
    withFieldnotesTestSchema(
      { query, end },
      "fieldnotes_factory_failure",
      async () => {
        await buildPagingStorageFactory("fieldnotes_factory_failure", stringifiers, builder);
      },
      [],
    ),
  ).rejects.toBe(primary);
  expect(build).toHaveBeenCalledTimes(1);
  expect(query.mock.calls).toEqual([
    ['CREATE SCHEMA "fieldnotes_factory_failure"'],
    ['DROP SCHEMA "fieldnotes_factory_failure" CASCADE'],
  ]);
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

it("retains a direct OIDC transaction and one-use grant across fresh PostgreSQL hosts", async () => {
  const schema = `fieldnotes_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: url });
  const origin = "https://localhost:3000";
  const issuer = "https://issuer.example";
  const settings: FieldnotesSettings = {
    postgresUrl: url,
    publicOrigin: origin,
    sessionPassword: randomBytes(32).toString("base64url"),
    csrfSecret: randomBytes(32),
    readerProofSecret: randomBytes(32),
    sessionTtlMilliseconds: 3_600_000,
    authRouteTimeoutMs: 10_000,
    authRouteMaxBytes: 65_536,
  };
  const provider = {
    authorizationEndpoint: `${issuer}/authorize`,
    recommendedScopes: ["openid"],
    provider: {
      issuer,
      exchangeAuthorizationCode: () => Promise.resolve({ issuer, subject: "restart-user" }),
    },
  };
  const options = async () => {
    const stringifiers = new StringifierRegistry();
    stringifiers.setTypeRegistry(TypeRegistry.from(fieldnotesProtoModule));
    return {
      storageFactory: await buildPagingStorageFactory(schema, stringifiers),
      authentication: { mode: "google" as const, clientId: "client-id", clientSecret: "secret" },
      googleProvider: provider,
    };
  };
  const post = (host: FieldnotesHost, path: string, body: unknown) =>
    fetch(`${host.gateway.baseUrl}${path}`, {
      method: "POST",
      headers: { origin, "content-type": "application/json", "x-fieldnotes-auth": "1" },
      body: JSON.stringify(body),
    });
  let host: FieldnotesHost | undefined;
  await withFieldnotesTestSchema(
    admin,
    schema,
    async () => {
      const verifier = "v".repeat(43);
      const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
      host = await FieldnotesHost.open(settings, await options());
      const started = await post(host, "/auth/google/start", { codeChallenge: challenge });
      expect(started.status).toBe(200);
      const start: unknown = await started.json();
      if (
        typeof start !== "object" ||
        start === null ||
        !("authorizationUrl" in start) ||
        typeof start.authorizationUrl !== "string"
      )
        throw new Error("OIDC authorization URL is missing.");
      const state = new URL(start.authorizationUrl).searchParams.get("state");
      if (!state) throw new Error("OIDC start state is missing.");
      await host.close();
      host = undefined;
      await ServerTests.resetEnvironment();
      host = await FieldnotesHost.open(settings, await options());
      const callback = await fetch(
        `${host.gateway.baseUrl}/auth/google/callback?state=${encodeURIComponent(state)}&code=code&iss=${encodeURIComponent(issuer)}`,
        { redirect: "manual" },
      );
      expect(callback.status).toBe(303);
      const location = callback.headers.get("location");
      if (!location) throw new Error("OIDC completion location is missing.");
      const grant = new URL(location).hash.slice("#grant=".length);
      expect(grant).toBeTruthy();
      await host.close();
      host = undefined;
      await ServerTests.resetEnvironment();
      host = await FieldnotesHost.open(settings, await options());
      const issued = await post(host, "/auth/google/exchange", { grant, codeVerifier: verifier });
      expect(issued.status).toBe(200);
      expect(issued.headers.getSetCookie()).toHaveLength(2);
      expect(
        (await post(host, "/auth/google/exchange", { grant, codeVerifier: verifier })).status,
      ).toBe(401);
      const cookies = issued.headers.getSetCookie();
      const credential = cookies[0]?.split(";", 1)[0]?.split("=", 2)[1];
      const csrf = cookies[1]?.split(";", 1)[0]?.split("=", 2)[1];
      if (!credential || !csrf) throw new Error("OIDC exchange cookies are missing.");
      const session = await fetch(`${host.gateway.baseUrl}/auth/session`, {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          "x-fieldnotes-auth": "1",
          cookie: `__Host-spine-session=${credential}; __Host-spine-csrf=${csrf}`,
          "x-spine-csrf": csrf,
        },
        body: "{}",
      });
      expect(session.status).toBe(200);
      expect(await session.json()).toMatchObject({
        principal: { id: JSON.stringify(["google-oidc", issuer, "restart-user"]) },
      });
    },
    [() => host?.close(), () => ServerTests.resetEnvironment()],
  );
});

it("traverses more than two native pages through the private PostgreSQL gateway", async () => {
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
  const stringifiers = new StringifierRegistry();
  stringifiers.setTypeRegistry(TypeRegistry.from(fieldnotesProtoModule));
  let factory: PostgresStorageFactory | undefined;
  let host: FieldnotesHost | undefined;
  await withFieldnotesTestSchema(
    admin,
    schema,
    async () => {
      factory = await buildPagingStorageFactory(schema, stringifiers);
      host = await FieldnotesHost.open(settings, { storageFactory: factory });
      const issued = await host.sessions.issue({ id: "paging-author" });
      if (issued.kind !== "created") throw new Error("Paging session issuance failed.");
      const credential = issued.credential.value;
      const csrf = host.cookies.csrf(credential);
      const client = Client.forConnect(host.gateway.baseUrl, {
        onRequestMetadata: () => ({
          origin: settings.publicOrigin,
          cookie: `__Host-spine-session=${credential}; __Host-spine-csrf=${csrf}`,
          "x-spine-csrf": csrf,
        }),
      });
      try {
        const author = create(UserIdSchema, { value: "paging-author" });
        const foreign = create(UserIdSchema, { value: "foreign-author" });
        const storage = openPlaceViewFixtureStorage(factory);
        try {
          const read = async (cursor?: Uint8Array): Promise<PlaceView[]> => {
            let query = PlaceViewQuery.create().author().is(author).removed().is(false);
            if (cursor !== undefined) query = query.placeKey().isGreaterThan(cursor);
            const response = await client
              .onBehalfOf(author.value)
              .send(query.orderBy("placeKey").limit(QUERY_SERVICE_MAX_RESULTS).build());
            return response.message.map((entry) => {
              const state = AnyPacker.tryUnpack(entry.state, PlaceViewSchema);
              if (state === undefined) throw new Error("Page returned a non-PlaceView state.");
              return state;
            });
          };
          expect(await read()).toEqual([]);
          const active = [
            ...Array.from(
              { length: QUERY_SERVICE_MAX_RESULTS - 1 },
              (_, index) => `a-${String(index).padStart(5, "0")}`,
            ),
            "á-place",
            "b-place",
            ...Array.from(
              { length: QUERY_SERVICE_MAX_RESULTS - 4 },
              (_, index) => `m-${String(index).padStart(5, "0")}`,
            ),
            "ñ-place",
            "東京-place",
            "\uE000-place",
            "\u{10000}-place",
            "😀-é",
            "😀-e\u0301",
          ];
          const tombstones = Array.from(
            { length: QUERY_SERVICE_MAX_RESULTS },
            (_, index) => `0-${String(index).padStart(5, "0")}`,
          );
          const foreignIds = Array.from(
            { length: 17 },
            (_, index) => `m-${String(index).padStart(5, "0")}-foreign`,
          );
          for (const key of tombstones)
            await storage.current.write(placeViewFixture(key, author, true));
          for (let index = 0; index < active.length; index += 1) {
            const key = active[index];
            if (key === undefined) throw new Error("Missing Place fixture key.");
            await storage.current.write(placeViewFixture(key, author, false));
            if (index === QUERY_SERVICE_MAX_RESULTS - 1) {
              expect((await read()).length).toBe(QUERY_SERVICE_MAX_RESULTS);
            }
            if (index === QUERY_SERVICE_MAX_RESULTS) {
              const first = await read();
              expect(first.length).toBe(QUERY_SERVICE_MAX_RESULTS);
              const next = await read(first.at(-1)?.placeKey);
              expect(next.length).toBe(1);
            }
          }
          for (const key of foreignIds)
            await storage.current.write(placeViewFixture(key, foreign, false));
          const recovery = await client
            .onBehalfOf(author.value)
            .send(
              PlaceViewQuery.create()
                .author()
                .is(author)
                .orderBy("placeKey")
                .limit(QUERY_SERVICE_MAX_RESULTS)
                .build(),
            );
          expect(recovery.message).toEqual([]);
          const found: string[] = [];
          const pages: PlaceView[][] = [];
          let cursor: Uint8Array | undefined;
          for (;;) {
            const page = await read(cursor);
            if (page.length === 0) break;
            pages.push(page);
            const next = page.at(-1)?.placeKey;
            const previous = cursor;
            const sameAsPrevious =
              previous === undefined || next === undefined
                ? false
                : next.length === previous.length &&
                  next.every((value, index) => value === previous[index]);
            if (next === undefined || next.length === 0 || sameAsPrevious)
              throw new Error("Place page did not advance its cursor.");
            for (const state of page) {
              const id = state.id?.value;
              if (!id) throw new Error("Place page has no typed ID.");
              const encoded = new TextEncoder().encode(id);
              if (
                state.placeKey.length !== encoded.length ||
                !state.placeKey.every((value, index) => value === encoded[index])
              )
                throw new Error("Place page has an invalid typed ID or continuation key.");
              found.push(id);
            }
            cursor = new Uint8Array(next);
          }
          expect(found).toHaveLength(active.length);
          expect(new Set(found).size).toBe(found.length);
          expect(new Set(found)).toEqual(new Set(active));
          expect(pages[1]?.at(-1)?.id?.value).toBe("\uE000-place");
          expect(pages[2]?.[0]?.id?.value).toBe("\u{10000}-place");
        } finally {
          storage.close();
        }
      } finally {
        await client.close();
      }
    },
    [() => host?.close() ?? factory?.close(), () => ServerTests.resetEnvironment()],
  );
});

function openPlaceViewFixtureStorage(factory: PostgresStorageFactory) {
  const columns = describeEntityMetadata(PlaceViewSchema).columns.map(
    (field) =>
      new RecordColumn(
        field.name,
        ColumnTypes.fromField(field.descriptor),
        (state: PlaceView) => state[field.localName as keyof PlaceView],
      ),
  );
  const input = standEntityStorageDescriptor(
    { name: "Fieldnotes", multitenant: false },
    PlaceViewSchema,
    columns,
  );
  return (
    factory as unknown as {
      createEntityStorage(value: typeof input): {
        current: { write(record: ReturnType<typeof EntityRecords.pack>): Promise<void> };
        close(): void;
      };
    }
  ).createEntityStorage(input);
}

function placeViewFixture(
  key: string,
  author: ReturnType<typeof create<typeof UserIdSchema>>,
  removed: boolean,
) {
  const id = create(PlaceIdSchema, { value: key });
  const occurredAt = Time.currentTime();
  const state = create(PlaceViewSchema, {
    id,
    placeKey: new TextEncoder().encode(id.value),
    author,
    name: removed ? "" : "Shared name",
    coordinates: removed
      ? undefined
      : create(CoordinatesSchema, { latitude: 38.7, longitude: -9.1 }),
    markdown: "",
    revision: 1,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    removed,
  });
  return EntityRecords.pack(PlaceViewSchema, id, state, 1n, { archived: false, deleted: false });
}
