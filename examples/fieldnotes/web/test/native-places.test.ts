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

// @vitest-environment jsdom

import { create } from "@bufbuild/protobuf";
import { AnyPacker } from "@spine-event-engine/core";
import { PlaceViewSchema } from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/entities_pb.js";
import {
  PlaceIdSchema,
  CoordinatesSchema,
} from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/types_pb.js";
import { UserIdSchema } from "@spine-event-engine/proto";
import {
  EntityStateUpdateSchema,
  EntityUpdatesSchema,
  SubscriptionUpdateSchema,
} from "@spine-event-engine/proto/client";
import { expect, it, vi } from "vitest";
import { FieldnotesNativePlaces } from "../src/native-places";

const client = vi.hoisted(() => ({
  forConnect: vi.fn(),
  createSubscription: vi.fn(),
  send: vi.fn(),
  close: vi.fn(),
  metadata: null as null | { credentials: string; onRequestMetadata: () => HeadersInit },
}));
vi.mock("@spine-event-engine/client-web", () => ({
  Client: { forConnect: client.forConnect },
}));

function connect(subscription: object): void {
  client.forConnect.mockReset();
  client.createSubscription.mockReset();
  client.send.mockReset();
  client.close.mockReset();
  client.createSubscription.mockResolvedValue(subscription);
  client.close.mockResolvedValue(undefined);
  client.forConnect.mockReturnValue({
    onBehalfOf: () => ({ createSubscription: client.createSubscription, send: client.send }),
    close: client.close,
  });
}

function blockedPage(signal: AbortSignal): Promise<{ message: never[] }> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener(
      "abort",
      () => {
        reject(new Error("superseded page"));
      },
      { once: true },
    );
  });
}

it("scans the verified author's active places and removes ID-only stream departures", async () => {
  const placeId = create(PlaceIdSchema, { value: "same" });
  const state = create(PlaceViewSchema, {
    id: placeId,
    author: create(UserIdSchema, { value: "author" }),
    name: "Lisbon",
    coordinates: create(CoordinatesSchema, { latitude: 38.7, longitude: -9.1 }),
    placeKey: new TextEncoder().encode("same"),
    revision: 1,
  });
  const departure = {
    kind: "update" as const,
    update: create(SubscriptionUpdateSchema, {
      update: {
        case: "entityUpdates" as const,
        value: create(EntityUpdatesSchema, {
          update: [
            create(EntityStateUpdateSchema, {
              id: AnyPacker.pack(PlaceIdSchema, placeId),
              kind: { case: "noLongerMatching", value: true },
            }),
          ],
        }),
      },
    }),
  };
  const changed = create(PlaceViewSchema, { ...state, name: "New Lisbon", revision: 2 });
  const stateUpdate = {
    kind: "update" as const,
    update: create(SubscriptionUpdateSchema, {
      update: {
        case: "entityUpdates" as const,
        value: create(EntityUpdatesSchema, {
          update: [
            create(EntityStateUpdateSchema, {
              id: AnyPacker.pack(PlaceIdSchema, placeId),
              kind: { case: "state", value: AnyPacker.pack(PlaceViewSchema, changed) },
            }),
          ],
        }),
      },
    }),
  };
  let deliverState!: (value: typeof stateUpdate) => void;
  const pendingState = new Promise<typeof stateUpdate>((resolve) => {
    deliverState = resolve;
  });
  let deliver!: (value: typeof departure) => void;
  const pending = new Promise<typeof departure>((resolve) => {
    deliver = resolve;
  });
  const cancel = vi.fn(() => Promise.resolve());
  const subscription = {
    updates: {
      async *[Symbol.asyncIterator]() {
        yield await pendingState;
        yield await pending;
        await new Promise(() => undefined);
      },
    },
    lifecycle: {
      async *[Symbol.asyncIterator]() {
        await new Promise(() => undefined);
        yield* [];
      },
    },
    activate: vi.fn(() => Promise.resolve()),
    cancel,
  };
  client.createSubscription.mockResolvedValue(subscription);
  client.send
    .mockResolvedValueOnce({ message: [{ state: AnyPacker.pack(PlaceViewSchema, state) }] })
    .mockResolvedValueOnce({ message: [] });
  client.close.mockResolvedValue(undefined);
  client.forConnect.mockImplementation(
    (_url: string, options: { credentials: string; onRequestMetadata: () => HeadersInit }) => {
      client.metadata = options;
      return {
        onBehalfOf: () => ({ createSubscription: client.createSubscription, send: client.send }),
        close: client.close,
      };
    },
  );
  const changes: string[][] = [];
  const errors = vi.fn();
  const native = new FieldnotesNativePlaces(
    "author",
    (places) => {
      changes.push(places.map((place) => place.id?.value ?? ""));
    },
    errors,
  );
  await native.start();
  expect(native.places().map((place) => place.name)).toEqual(["Lisbon"]);
  expect(client.createSubscription).toHaveBeenCalledOnce();
  expect(subscription.activate).toHaveBeenCalledOnce();
  expect(client.send).toHaveBeenCalledTimes(2);
  const connectOptions = client.metadata;
  if (connectOptions === null) throw new Error("Client metadata options are missing.");
  expect(connectOptions.credentials).toBe("same-origin");
  const cookie = vi
    .spyOn(document, "cookie", "get")
    .mockReturnValue("__Host-spine-csrf=reader-token");
  expect(connectOptions.onRequestMetadata()).toEqual({ "x-spine-csrf": "reader-token" });
  cookie.mockReturnValue("__Host-spine-csrf=one; __Host-spine-csrf=two");
  expect(connectOptions.onRequestMetadata()).toEqual({});
  cookie.mockReturnValue("unrelated=value");
  expect(connectOptions.onRequestMetadata()).toEqual({});
  cookie.mockRestore();
  deliverState(stateUpdate);
  await vi.waitFor(() => {
    expect(native.places()[0]?.name).toBe("New Lisbon");
  });
  deliver(departure);
  await vi.waitFor(() => {
    expect(native.places()).toEqual([]);
  });
  expect(changes.at(-1)).toEqual([]);
  expect(errors).not.toHaveBeenCalled();
  await native.close();
  expect(cancel).toHaveBeenCalledOnce();
  expect(client.close).toHaveBeenCalledOnce();
});

it("rescans after a gap notice and reports a failed private stream", async () => {
  client.forConnect.mockReset();
  client.createSubscription.mockReset();
  client.send.mockReset();
  client.close.mockReset();
  const initial = create(PlaceViewSchema, {
    id: create(PlaceIdSchema, { value: "same" }),
    author: create(UserIdSchema, { value: "author" }),
    name: "Before gap",
    coordinates: create(CoordinatesSchema, { latitude: 38.7, longitude: -9.1 }),
    placeKey: new TextEncoder().encode("same"),
    revision: 1,
  });
  const recovered = create(PlaceViewSchema, { ...initial, name: "After gap", revision: 2 });
  let gap!: () => void;
  const gapNotice = new Promise<void>((resolve) => {
    gap = resolve;
  });
  let fail!: () => void;
  const failureNotice = new Promise<void>((resolve) => {
    fail = resolve;
  });
  const subscription = {
    updates: {
      async *[Symbol.asyncIterator]() {
        await new Promise(() => undefined);
        yield* [];
      },
    },
    lifecycle: {
      async *[Symbol.asyncIterator]() {
        await gapNotice;
        yield { state: "gapPossible" };
        await failureNotice;
        yield { state: "failed" };
        await new Promise(() => undefined);
      },
    },
    activate: () => Promise.resolve(),
    cancel: () => Promise.resolve(),
  };
  client.createSubscription.mockResolvedValue(subscription);
  client.send
    .mockResolvedValueOnce({ message: [{ state: AnyPacker.pack(PlaceViewSchema, initial) }] })
    .mockResolvedValueOnce({ message: [] })
    .mockResolvedValueOnce({ message: [{ state: AnyPacker.pack(PlaceViewSchema, recovered) }] })
    .mockResolvedValueOnce({ message: [] });
  client.close.mockResolvedValue(undefined);
  client.forConnect.mockReturnValue({
    onBehalfOf: () => ({ createSubscription: client.createSubscription, send: client.send }),
    close: client.close,
  });
  const errors = vi.fn();
  const native = new FieldnotesNativePlaces("author", () => undefined, errors);
  await native.start();
  gap();
  await vi.waitFor(() => {
    expect(native.places()[0]?.name).toBe("After gap");
  });
  expect(client.send).toHaveBeenCalledTimes(4);
  fail();
  await vi.waitFor(() => {
    expect(errors).toHaveBeenCalledOnce();
  });
  await native.close();
});

it("refuses a state whose typed ID differs from its streamed entity ID", async () => {
  client.forConnect.mockReset();
  client.createSubscription.mockReset();
  client.send.mockReset();
  client.close.mockReset();
  const foreign = create(PlaceViewSchema, {
    id: create(PlaceIdSchema, { value: "foreign" }),
    author: create(UserIdSchema, { value: "author" }),
    name: "Foreign",
    coordinates: create(CoordinatesSchema, { latitude: 38.7, longitude: -9.1 }),
    placeKey: new TextEncoder().encode("foreign"),
    revision: 1,
  });
  const update = {
    kind: "update" as const,
    update: create(SubscriptionUpdateSchema, {
      update: {
        case: "entityUpdates" as const,
        value: create(EntityUpdatesSchema, {
          update: [
            create(EntityStateUpdateSchema, {
              id: AnyPacker.pack(PlaceIdSchema, create(PlaceIdSchema, { value: "same" })),
              kind: { case: "state", value: AnyPacker.pack(PlaceViewSchema, foreign) },
            }),
          ],
        }),
      },
    }),
  };
  let deliver!: (value: typeof update) => void;
  const pending = new Promise<typeof update>((resolve) => {
    deliver = resolve;
  });
  client.createSubscription.mockResolvedValue({
    updates: {
      async *[Symbol.asyncIterator]() {
        yield await pending;
      },
    },
    lifecycle: {
      async *[Symbol.asyncIterator]() {
        await new Promise(() => undefined);
        yield* [];
      },
    },
    activate: () => Promise.resolve(),
    cancel: () => Promise.resolve(),
  });
  client.send.mockResolvedValue({ message: [] });
  client.close.mockResolvedValue(undefined);
  client.forConnect.mockReturnValue({
    onBehalfOf: () => ({ createSubscription: client.createSubscription, send: client.send }),
    close: client.close,
  });
  const errors = vi.fn();
  const native = new FieldnotesNativePlaces("author", () => undefined, errors);
  await native.start();
  deliver(update);
  await vi.waitFor(() => {
    expect(errors).toHaveBeenCalledOnce();
  });
  expect(native.places()).toEqual([]);
  await native.close();
});

it("rejects a non-PlaceView initial page before publishing a private collection", async () => {
  const subscription = {
    updates: {
      async *[Symbol.asyncIterator]() {
        await new Promise(() => undefined);
        yield* [];
      },
    },
    lifecycle: {
      async *[Symbol.asyncIterator]() {
        await new Promise(() => undefined);
        yield* [];
      },
    },
    activate: () => Promise.resolve(),
    cancel: () => Promise.resolve(),
  };
  connect(subscription);
  client.send.mockResolvedValue({
    message: [
      {
        state: AnyPacker.pack(
          PlaceIdSchema,
          create(PlaceIdSchema, { value: "wrong-message-kind" }),
        ),
      },
    ],
  });
  const changed = vi.fn();
  const native = new FieldnotesNativePlaces("author", changed, vi.fn());
  await expect(native.start()).rejects.toThrow("non-PlaceView");
  expect(changed).not.toHaveBeenCalled();
  expect(native.places()).toEqual([]);
  await native.close();
});

it("reports a private stream ending naturally instead of leaving the collection ready", async () => {
  let finish!: () => void;
  const ended = new Promise<void>((resolve) => {
    finish = resolve;
  });
  connect({
    updates: {
      async *[Symbol.asyncIterator]() {
        await ended;
        yield* [];
      },
    },
    lifecycle: {
      async *[Symbol.asyncIterator]() {
        await new Promise(() => undefined);
        yield* [];
      },
    },
    activate: () => Promise.resolve(),
    cancel: () => Promise.resolve(),
  });
  client.send.mockResolvedValue({ message: [] });
  const errors = vi.fn();
  const native = new FieldnotesNativePlaces("author", vi.fn(), errors);
  await native.start();
  expect(native.commands()).toBeDefined();
  finish();
  await vi.waitFor(() => {
    expect(errors).toHaveBeenCalledOnce();
  });
  await native.close();
});

it("reports a failed gap rescan while the subscription remains active", async () => {
  let gap!: () => void;
  const notice = new Promise<void>((resolve) => {
    gap = resolve;
  });
  connect({
    updates: {
      async *[Symbol.asyncIterator]() {
        await new Promise(() => undefined);
        yield* [];
      },
    },
    lifecycle: {
      async *[Symbol.asyncIterator]() {
        await notice;
        yield { state: "gapPossible" };
        await new Promise(() => undefined);
      },
    },
    activate: () => Promise.resolve(),
    cancel: () => Promise.resolve(),
  });
  client.send
    .mockResolvedValueOnce({ message: [] })
    .mockRejectedValueOnce(new Error("query failed"));
  const errors = vi.fn();
  const native = new FieldnotesNativePlaces("author", vi.fn(), errors);
  await native.start();
  gap();
  await vi.waitFor(() => {
    expect(errors).toHaveBeenCalledOnce();
  });
  await native.close();
});

it("rescans after a stream resynchronization and ignores unrelated update kinds", async () => {
  let resume!: () => void;
  const ready = new Promise<void>((resolve) => {
    resume = resolve;
  });
  connect({
    updates: {
      async *[Symbol.asyncIterator]() {
        await ready;
        yield { kind: "resynchronization" };
        yield { kind: "update", update: create(SubscriptionUpdateSchema) };
        yield {
          kind: "update",
          update: create(SubscriptionUpdateSchema, {
            update: {
              case: "entityUpdates",
              value: create(EntityUpdatesSchema, {
                update: [
                  create(EntityStateUpdateSchema, {
                    id: AnyPacker.pack(PlaceIdSchema, create(PlaceIdSchema, { value: "same" })),
                  }),
                ],
              }),
            },
          }),
        };
        await new Promise(() => undefined);
      },
    },
    lifecycle: {
      async *[Symbol.asyncIterator]() {
        await new Promise(() => undefined);
        yield* [];
      },
    },
    activate: () => Promise.resolve(),
    cancel: () => Promise.resolve(),
  });
  client.send.mockResolvedValue({ message: [] });
  const errors = vi.fn();
  const native = new FieldnotesNativePlaces("author", vi.fn(), errors);
  await native.start();
  resume();
  await vi.waitFor(() => {
    expect(client.send).toHaveBeenCalledTimes(2);
  });
  expect(errors).not.toHaveBeenCalled();
  await native.close();
});

it("refuses malformed typed IDs and state payloads in the private entity stream", async () => {
  const badUpdates = [
    create(EntityStateUpdateSchema, {
      id: AnyPacker.pack(UserIdSchema, create(UserIdSchema, { value: "wrong-id-type" })),
      kind: { case: "noLongerMatching", value: true },
    }),
    create(EntityStateUpdateSchema, {
      id: AnyPacker.pack(PlaceIdSchema, create(PlaceIdSchema, { value: "same" })),
      kind: {
        case: "state",
        value: AnyPacker.pack(PlaceIdSchema, create(PlaceIdSchema, { value: "wrong-state-type" })),
      },
    }),
  ];
  for (const malformed of badUpdates) {
    let deliver!: () => void;
    const ready = new Promise<void>((resolve) => {
      deliver = resolve;
    });
    connect({
      updates: {
        async *[Symbol.asyncIterator]() {
          await ready;
          yield {
            kind: "update",
            update: create(SubscriptionUpdateSchema, {
              update: {
                case: "entityUpdates",
                value: create(EntityUpdatesSchema, { update: [malformed] }),
              },
            }),
          };
        },
      },
      lifecycle: {
        async *[Symbol.asyncIterator]() {
          await new Promise(() => undefined);
          yield* [];
        },
      },
      activate: () => Promise.resolve(),
      cancel: () => Promise.resolve(),
    });
    client.send.mockResolvedValue({ message: [] });
    const errors = vi.fn();
    const native = new FieldnotesNativePlaces("author", vi.fn(), errors);
    await native.start();
    deliver();
    await vi.waitFor(() => {
      expect(errors).toHaveBeenCalledOnce();
    });
    expect(native.places()).toEqual([]);
    await native.close();
  }
});

it("reports a lifecycle iterator failure without leaving private places mounted", async () => {
  let interrupt!: () => void;
  const pending = new Promise<void>((resolve) => {
    interrupt = resolve;
  });
  connect({
    updates: {
      async *[Symbol.asyncIterator]() {
        await new Promise(() => undefined);
        yield* [];
      },
    },
    lifecycle: {
      async *[Symbol.asyncIterator]() {
        yield* [];
        await pending;
        throw new Error("native lifecycle interrupted");
      },
    },
    activate: () => Promise.resolve(),
    cancel: () => Promise.resolve(),
  });
  client.send.mockResolvedValue({ message: [] });
  const errors = vi.fn();
  const native = new FieldnotesNativePlaces("author", vi.fn(), errors);
  await native.start();
  interrupt();
  await vi.waitFor(() => {
    expect(errors).toHaveBeenCalledOnce();
  });
  expect(native.places()).toEqual([]);
  await native.close();
});

it("waits for a reconnect scan when a gap supersedes the initial page", async () => {
  let gap!: () => void;
  const notice = new Promise<void>((resolve) => {
    gap = resolve;
  });
  connect({
    updates: {
      async *[Symbol.asyncIterator]() {
        await new Promise(() => undefined);
        yield* [];
      },
    },
    lifecycle: {
      async *[Symbol.asyncIterator]() {
        await notice;
        yield { state: "gapPossible" };
        await new Promise(() => undefined);
      },
    },
    activate: () => Promise.resolve(),
    cancel: () => Promise.resolve(),
  });
  client.send
    .mockImplementationOnce((_query: unknown, options: { signal: AbortSignal }) =>
      blockedPage(options.signal),
    )
    .mockResolvedValueOnce({ message: [] });
  const errors = vi.fn();
  const native = new FieldnotesNativePlaces("author", vi.fn(), errors);
  const starting = native.start();
  await vi.waitFor(() => {
    expect(client.send).toHaveBeenCalledOnce();
  });
  gap();
  await expect(starting).resolves.toBeUndefined();
  expect(client.send).toHaveBeenCalledTimes(2);
  expect(errors).not.toHaveBeenCalled();
  await native.close();
});

it("ignores an aborted earlier rescan but reports a failed latest rescan", async () => {
  let firstGap!: () => void;
  let secondGap!: () => void;
  const first = new Promise<void>((resolve) => {
    firstGap = resolve;
  });
  const second = new Promise<void>((resolve) => {
    secondGap = resolve;
  });
  connect({
    updates: {
      async *[Symbol.asyncIterator]() {
        await new Promise(() => undefined);
        yield* [];
      },
    },
    lifecycle: {
      async *[Symbol.asyncIterator]() {
        await first;
        yield { state: "gapPossible" };
        await second;
        yield { state: "gapPossible" };
        await new Promise(() => undefined);
      },
    },
    activate: () => Promise.resolve(),
    cancel: () => Promise.resolve(),
  });
  client.send
    .mockResolvedValueOnce({ message: [] })
    .mockImplementationOnce((_query: unknown, options: { signal: AbortSignal }) =>
      blockedPage(options.signal),
    )
    .mockRejectedValueOnce(new Error("latest page failed"));
  const errors = vi.fn();
  const native = new FieldnotesNativePlaces("author", vi.fn(), errors);
  await native.start();
  firstGap();
  await vi.waitFor(() => {
    expect(client.send).toHaveBeenCalledTimes(2);
  });
  secondGap();
  await vi.waitFor(() => {
    expect(client.send).toHaveBeenCalledTimes(3);
  });
  await vi.waitFor(() => {
    expect(errors).toHaveBeenCalledOnce();
  });
  await native.close();
});

it("keeps the private stream ready when two gap notices supersede the same page", async () => {
  let firstGap!: () => void;
  let secondGap!: () => void;
  const first = new Promise<void>((resolve) => {
    firstGap = resolve;
  });
  const second = new Promise<void>((resolve) => {
    secondGap = resolve;
  });
  connect({
    updates: {
      async *[Symbol.asyncIterator]() {
        await new Promise(() => undefined);
        yield* [];
      },
    },
    lifecycle: {
      async *[Symbol.asyncIterator]() {
        await first;
        yield { state: "gapPossible" };
        await second;
        yield { state: "gapPossible" };
        await new Promise(() => undefined);
      },
    },
    activate: () => Promise.resolve(),
    cancel: () => Promise.resolve(),
  });
  client.send
    .mockResolvedValueOnce({ message: [] })
    .mockImplementationOnce((_query: unknown, options: { signal: AbortSignal }) =>
      blockedPage(options.signal),
    )
    .mockResolvedValueOnce({ message: [] });
  const errors = vi.fn();
  const changed = vi.fn();
  const native = new FieldnotesNativePlaces("author", changed, errors);
  await native.start();
  firstGap();
  await vi.waitFor(() => {
    expect(client.send).toHaveBeenCalledTimes(2);
  });
  secondGap();
  await vi.waitFor(() => {
    expect(client.send).toHaveBeenCalledTimes(3);
  });
  await vi.waitFor(() => {
    expect(changed).toHaveBeenCalledTimes(2);
  });
  expect(errors).not.toHaveBeenCalled();
  await native.close();
});
