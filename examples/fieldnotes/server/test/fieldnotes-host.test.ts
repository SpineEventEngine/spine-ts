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

import { randomBytes } from "node:crypto";
import { randomUUID } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport, createGrpcTransport } from "@connectrpc/connect-node";
import { Client } from "@spine-event-engine/client-web";
import { AnyPacker } from "@spine-event-engine/core";
import { ActorContextSchema, UserIdSchema } from "@spine-event-engine/proto";
import {
  QueryService,
  SubscriptionService,
  TopicIdSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import { PlaceViewSchema } from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/entities_pb.js";
import { PlaceViewQuery } from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/entities_query.js";
import { AddPlaceSchema } from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/commands_pb.js";
import { DeletePlaceSchema } from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/commands_pb.js";
import { RenamePlaceSchema } from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/commands_pb.js";
import {
  CoordinatesSchema,
  PlaceIdSchema,
} from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/types_pb.js";
import { ServerTests } from "@spine-event-engine/server/testing";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FieldnotesHost } from "../src/fieldnotes-host.js";
import type { FieldnotesSettings } from "../src/host-settings.js";

const settings = (): FieldnotesSettings => ({
  postgresUrl: "postgres://localhost/fieldnotes",
  publicOrigin: "https://localhost:3000",
  sessionPassword: randomBytes(32).toString("base64url"),
  csrfSecret: randomBytes(32),
  readerProofSecret: randomBytes(32),
  sessionTtlMilliseconds: 3_600_000,
  authRouteTimeoutMs: 10_000,
  authRouteMaxBytes: 65_536,
});

describe("Fieldnotes host private Connect boundary", () => {
  afterEach(async () => ServerTests.resetEnvironment());

  it("closes the selected storage after startup connection failure", async () => {
    const factory = new InMemoryStorageFactory();
    vi.spyOn(factory, "checkConnection").mockRejectedValueOnce(new Error("connection unavailable"));
    const closed = vi.spyOn(factory, "close");
    await expect(FieldnotesHost.open(settings(), { storageFactory: factory })).rejects.toThrow(
      "connection unavailable",
    );
    expect(closed).toHaveBeenCalled();
    expect(factory.isOpen()).toBe(false);
  });

  it("rejects direct native reads without a verified forwarding proof", async () => {
    const host = await FieldnotesHost.open(settings(), {
      storageFactory: new InMemoryStorageFactory(),
    });
    try {
      const native = host.native;
      if (native === undefined) throw new Error("Native listener did not start.");
      const query = PlaceViewQuery.create().build().build();
      const client = createClient(QueryService, createGrpcTransport({ baseUrl: native.baseUrl }));
      await expect(client.read(query)).rejects.toThrow("Reader authentication failed");
      await expect(
        client.read(query, {
          headers: {
            "spine-internal-reader": "forged",
            "spine-internal-reader-proof": "forged",
          },
        }),
      ).rejects.toThrow("Reader authentication failed");
    } finally {
      await host.close();
    }
  });

  it("rejects broad and foreign PlaceView topics before starting a stream", async () => {
    const host = await FieldnotesHost.open(settings(), {
      storageFactory: new InMemoryStorageFactory(),
    });
    const issued = await host.sessions.issue({ id: "reader" });
    if (issued.kind !== "created") throw new Error("Expected issued session.");
    const credential = issued.credential.value;
    const client = Client.forConnect(host.gateway.baseUrl, {
      onRequestMetadata: () => ({
        origin: "https://localhost:3000",
        cookie: `__Host-spine-session=${credential}; __Host-spine-csrf=${host.cookies.csrf(credential)}`,
        "x-spine-csrf": host.cookies.csrf(credential),
      }),
    });
    const reader = client.onBehalfOf("reader");
    const queryFor = (author?: string) =>
      author === undefined
        ? PlaceViewQuery.create().build()
        : PlaceViewQuery.create()
            .author()
            .is(create(UserIdSchema, { value: author }))
            .build();
    const subscribe = async (author?: string) => {
      const query = queryFor(author);
      return reader.createSubscription(
        create(TopicSchema, {
          id: create(TopicIdSchema, { value: `t-${randomUUID()}` }),
          target: query.build().target,
        }),
        { kind: "entity", authoritativeQuery: () => query },
      );
    };
    try {
      const broad = await subscribe();
      await expect(broad.activate()).rejects.toThrow();
      await broad.cancel();
      const foreign = await subscribe("another-author");
      await expect(foreign.activate()).rejects.toThrow();
      await foreign.cancel();
      const admitted = await subscribe("reader");
      await admitted.activate();
      await admitted.cancel();
    } finally {
      await client.close();
      await host.close();
    }
  });

  it("keeps a subscribed handle private when another session steals its wire", async () => {
    const host = await FieldnotesHost.open(settings(), {
      storageFactory: new InMemoryStorageFactory(),
    });
    const author = await host.sessions.issue({ id: "author-a" });
    const foreign = await host.sessions.issue({ id: "author-b" });
    if (author.kind !== "created" || foreign.kind !== "created")
      throw new Error("Expected issued sessions.");
    const transport = createConnectTransport({ baseUrl: host.gateway.baseUrl, httpVersion: "1.1" });
    const service = createClient(SubscriptionService, transport);
    const headers = (credential: string) => ({
      origin: "https://localhost:3000",
      cookie: `__Host-spine-session=${credential}; __Host-spine-csrf=${host.cookies.csrf(credential)}`,
      "x-spine-csrf": host.cookies.csrf(credential),
    });
    const firstHeaders = { headers: headers(author.credential.value) };
    const stolenHeaders = { headers: headers(foreign.credential.value) };
    const target = PlaceViewQuery.create()
      .author()
      .is(create(UserIdSchema, { value: "author-a" }))
      .build()
      .build().target;
    const topic = create(TopicSchema, {
      id: create(TopicIdSchema, { value: `t-${randomUUID()}` }),
      context: create(ActorContextSchema, { actor: create(UserIdSchema, { value: "author-a" }) }),
      target,
    });
    try {
      const wire = await service.subscribe(topic, firstHeaders);
      await expect(service.cancel(wire, stolenHeaders)).rejects.toThrow();
      const stolen = service.activate(wire, stolenHeaders)[Symbol.asyncIterator]();
      await expect(stolen.next()).rejects.toThrow();
      await expect(service.cancel(wire, firstHeaders)).resolves.toBeDefined();
    } finally {
      await host.close();
    }
  });

  it("serves the author's PlaceView and hides it from another valid raw client", async () => {
    const host = await FieldnotesHost.open(settings(), {
      storageFactory: new InMemoryStorageFactory(),
    });
    const first = await host.sessions.issue({ id: "author-a" });
    const second = await host.sessions.issue({ id: "author-b" });
    if (first.kind !== "created" || second.kind !== "created")
      throw new Error("Expected issued sessions.");
    const client = (credential: string) =>
      Client.forConnect(host.gateway.baseUrl, {
        onRequestMetadata: () => ({
          origin: "https://localhost:3000",
          cookie: `__Host-spine-session=${credential}; __Host-spine-csrf=${host.cookies.csrf(credential)}`,
          "x-spine-csrf": host.cookies.csrf(credential),
        }),
      });
    const author = client(first.credential.value);
    const foreign = client(second.credential.value);
    const id = create(PlaceIdSchema, { value: "private-place" });
    try {
      await author.onBehalfOf("author-a").post(
        AddPlaceSchema,
        create(AddPlaceSchema, {
          id,
          name: "Private",
          coordinates: create(CoordinatesSchema, { latitude: 38.7, longitude: -9.1 }),
          markdown: "private note",
        }),
      );
      await vi.waitFor(async () => {
        const result = await author.onBehalfOf("author-a").send(
          PlaceViewQuery.create()
            .author()
            .is(create(UserIdSchema, { value: "author-a" }))
            .build(),
        );
        expect(
          result.message.map((entry) => AnyPacker.tryUnpack(entry.state, PlaceViewSchema)),
        ).toMatchObject([{ id, name: "Private" }]);
      });
      const foreignResult = await foreign.onBehalfOf("author-b").send(
        PlaceViewQuery.create()
          .author()
          .is(create(UserIdSchema, { value: "author-b" }))
          .byId(id)
          .build(),
      );
      expect(foreignResult.message).toHaveLength(0);
      await expect(
        foreign.onBehalfOf("author-b").send(
          PlaceViewQuery.create()
            .author()
            .is(create(UserIdSchema, { value: "author-a" }))
            .build(),
        ),
      ).rejects.toThrow();
      await expect(
        foreign.onBehalfOf("author-a").send(PlaceViewQuery.create().build()),
      ).rejects.toThrow();
    } finally {
      await author.close();
      await foreign.close();
      await host.close();
    }
  });

  it("selects an authorized row before a caller's ordered one-row query limit", async () => {
    const host = await FieldnotesHost.open(settings(), {
      storageFactory: new InMemoryStorageFactory(),
    });
    const first = await host.sessions.issue({ id: "author-a" });
    const second = await host.sessions.issue({ id: "author-b" });
    if (first.kind !== "created" || second.kind !== "created")
      throw new Error("Expected issued sessions.");
    const clientFor = (credential: string) =>
      Client.forConnect(host.gateway.baseUrl, {
        onRequestMetadata: () => ({
          origin: "https://localhost:3000",
          cookie: `__Host-spine-session=${credential}; __Host-spine-csrf=${host.cookies.csrf(credential)}`,
          "x-spine-csrf": host.cookies.csrf(credential),
        }),
      });
    const clientA = clientFor(first.credential.value);
    const clientB = clientFor(second.credential.value);
    const ownId = create(PlaceIdSchema, { value: `own-${randomUUID()}` });
    const foreignId = create(PlaceIdSchema, { value: `foreign-${randomUUID()}` });
    const coordinates = create(CoordinatesSchema, { latitude: 38.7, longitude: -9.1 });
    try {
      await clientB.onBehalfOf("author-b").post(
        AddPlaceSchema,
        create(AddPlaceSchema, {
          id: foreignId,
          name: "A foreign first",
          coordinates,
        }),
      );
      await clientA.onBehalfOf("author-a").post(
        AddPlaceSchema,
        create(AddPlaceSchema, {
          id: ownId,
          name: "Z authorized second",
          coordinates,
        }),
      );
      await vi.waitFor(async () => {
        const foreign = await clientB.onBehalfOf("author-b").send(
          PlaceViewQuery.create()
            .author()
            .is(create(UserIdSchema, { value: "author-b" }))
            .orderBy("name")
            .limit(1)
            .build(),
        );
        expect(
          foreign.message.map(
            (entry) => AnyPacker.tryUnpack(entry.state, PlaceViewSchema)?.id?.value,
          ),
        ).toEqual([foreignId.value]);
      });
      const scoped = PlaceViewQuery.create()
        .author()
        .is(create(UserIdSchema, { value: "author-a" }))
        .orderBy("name")
        .limit(1)
        .build();
      await vi.waitFor(async () => {
        const result = await clientA.onBehalfOf("author-a").send(scoped);
        expect(
          result.message.map(
            (entry) => AnyPacker.tryUnpack(entry.state, PlaceViewSchema)?.id?.value,
          ),
        ).toEqual([ownId.value]);
      });
      await expect(
        clientA
          .onBehalfOf("author-a")
          .send(PlaceViewQuery.create().orderBy("name").limit(1).build()),
      ).rejects.toThrow();
    } finally {
      await clientA.close();
      await clientB.close();
      await host.close();
    }
  });

  it("delivers a removed Place only through its author's canonical entity stream", async () => {
    const host = await FieldnotesHost.open(settings(), {
      storageFactory: new InMemoryStorageFactory(),
    });
    const issued = await host.sessions.issue({ id: "author-a" });
    if (issued.kind !== "created") throw new Error("Expected issued session.");
    const credential = issued.credential.value;
    const client = Client.forConnect(host.gateway.baseUrl, {
      onRequestMetadata: () => ({
        origin: "https://localhost:3000",
        cookie: `__Host-spine-session=${credential}; __Host-spine-csrf=${host.cookies.csrf(credential)}`,
        "x-spine-csrf": host.cookies.csrf(credential),
      }),
    });
    const author = client.onBehalfOf("author-a");
    const id = create(PlaceIdSchema, { value: `removed-${randomUUID()}` });
    const query = PlaceViewQuery.create()
      .author()
      .is(create(UserIdSchema, { value: "author-a" }))
      .build();
    const subscription = await author.createSubscription(
      create(TopicSchema, {
        id: create(TopicIdSchema, { value: `t-${randomUUID()}` }),
        target: query.build().target,
      }),
      { kind: "entity", authoritativeQuery: () => query },
    );
    const seen: string[] = [];
    const collect = (async () => {
      for await (const delivery of subscription.updates) {
        if (delivery.kind !== "update" || delivery.update.update.case !== "entityUpdates") continue;
        for (const entry of delivery.update.update.value.update) {
          if (entry.kind.case === undefined) throw new Error("Entity update has no kind.");
          seen.push(entry.kind.case);
        }
      }
    })();
    try {
      await subscription.activate();
      await author.post(
        AddPlaceSchema,
        create(AddPlaceSchema, {
          id,
          name: "Temporary",
          coordinates: create(CoordinatesSchema, { latitude: 38.7, longitude: -9.1 }),
        }),
      );
      await vi.waitFor(
        () => {
          expect(seen).toContain("state");
        },
        { timeout: 5_000 },
      );
      await author.post(DeletePlaceSchema, create(DeletePlaceSchema, { id, expectedRevision: 1 }));
      await vi.waitFor(
        () => {
          expect(seen).toContain("noLongerMatching");
        },
        { timeout: 5_000 },
      );
    } finally {
      await subscription.cancel();
      await collect;
      await client.close();
      await host.close();
    }
  });

  it("keeps every foreign Place ID out of an author's raw add, rename and delete stream", async () => {
    const host = await FieldnotesHost.open(settings(), {
      storageFactory: new InMemoryStorageFactory(),
    });
    const first = await host.sessions.issue({ id: "author-a" });
    const second = await host.sessions.issue({ id: "author-b" });
    if (first.kind !== "created" || second.kind !== "created")
      throw new Error("Expected issued sessions.");
    const clientFor = (credential: string) =>
      Client.forConnect(host.gateway.baseUrl, {
        onRequestMetadata: () => ({
          origin: "https://localhost:3000",
          cookie: `__Host-spine-session=${credential}; __Host-spine-csrf=${host.cookies.csrf(credential)}`,
          "x-spine-csrf": host.cookies.csrf(credential),
        }),
      });
    const clientA = clientFor(first.credential.value);
    const clientB = clientFor(second.credential.value);
    const authorA = clientA.onBehalfOf("author-a");
    const authorB = clientB.onBehalfOf("author-b");
    const idA = create(PlaceIdSchema, { value: `a-${randomUUID()}` });
    const idB = create(PlaceIdSchema, { value: `b-${randomUUID()}` });
    const queryFor = (name: string) =>
      PlaceViewQuery.create()
        .author()
        .is(create(UserIdSchema, { value: name }))
        .build();
    const subscribe = (name: string, author: typeof authorA) => {
      const query = queryFor(name);
      return author.createSubscription(
        create(TopicSchema, {
          id: create(TopicIdSchema, { value: `t-${randomUUID()}` }),
          target: query.build().target,
        }),
        { kind: "entity", authoritativeQuery: () => query },
      );
    };
    const streamA = await subscribe("author-a", authorA);
    const streamB = await subscribe("author-b", authorB);
    const seenA: { id: string | undefined; kind: string }[] = [];
    const seenB: { id: string | undefined; kind: string }[] = [];
    const collect = async (stream: typeof streamA, seen: typeof seenA) => {
      for await (const delivery of stream.updates) {
        if (delivery.kind !== "update" || delivery.update.update.case !== "entityUpdates") continue;
        for (const entry of delivery.update.update.value.update) {
          if (entry.kind.case === undefined) throw new Error("Entity update has no kind.");
          seen.push({
            id: AnyPacker.tryUnpack(entry.id, PlaceIdSchema)?.value,
            kind: entry.kind.case,
          });
        }
      }
    };
    const collectingA = collect(streamA, seenA);
    const collectingB = collect(streamB, seenB);
    try {
      await streamA.activate();
      await streamB.activate();
      const coordinates = create(CoordinatesSchema, { latitude: 38.7, longitude: -9.1 });
      await authorA.post(
        AddPlaceSchema,
        create(AddPlaceSchema, { id: idA, name: "A", coordinates }),
      );
      await authorB.post(
        AddPlaceSchema,
        create(AddPlaceSchema, { id: idB, name: "B", coordinates }),
      );
      await vi.waitFor(() => {
        expect(
          seenA.filter((entry) => entry.id === idA.value && entry.kind === "state"),
        ).toHaveLength(1);
        expect(
          seenB.filter((entry) => entry.id === idB.value && entry.kind === "state"),
        ).toHaveLength(1);
      });
      expect(seenA.every((entry) => entry.id === idA.value)).toBe(true);
      expect(seenB.every((entry) => entry.id === idB.value)).toBe(true);
      await authorA.post(
        RenamePlaceSchema,
        create(RenamePlaceSchema, { id: idA, name: "A2", expectedRevision: 1 }),
      );
      await authorB.post(
        RenamePlaceSchema,
        create(RenamePlaceSchema, { id: idB, name: "B2", expectedRevision: 1 }),
      );
      await vi.waitFor(() => {
        expect(
          seenA.filter((entry) => entry.id === idA.value && entry.kind === "state"),
        ).toHaveLength(2);
        expect(
          seenB.filter((entry) => entry.id === idB.value && entry.kind === "state"),
        ).toHaveLength(2);
      });
      expect(seenA.every((entry) => entry.id === idA.value)).toBe(true);
      expect(seenB.every((entry) => entry.id === idB.value)).toBe(true);
      await authorA.post(
        DeletePlaceSchema,
        create(DeletePlaceSchema, { id: idA, expectedRevision: 2 }),
      );
      await authorB.post(
        DeletePlaceSchema,
        create(DeletePlaceSchema, { id: idB, expectedRevision: 2 }),
      );
      await vi.waitFor(() => {
        expect(
          seenA.some((entry) => entry.id === idA.value && entry.kind === "noLongerMatching"),
        ).toBe(true);
        expect(
          seenB.some((entry) => entry.id === idB.value && entry.kind === "noLongerMatching"),
        ).toBe(true);
      });
      expect(seenA.every((entry) => entry.id === idA.value)).toBe(true);
      expect(seenB.every((entry) => entry.id === idB.value)).toBe(true);
    } finally {
      await streamA.cancel();
      await streamB.cancel();
      await collectingA;
      await collectingB;
      await clientA.close();
      await clientB.close();
      await host.close();
    }
  });
});
