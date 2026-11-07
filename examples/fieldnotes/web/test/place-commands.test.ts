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
import type {
  ClientRequest,
  Subscription,
  SubscriptionDelivery,
} from "@spine-event-engine/client-web";
import { AnyPacker } from "@spine-event-engine/core";
import { PlaceViewSchema } from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/entities_pb.js";
import {
  PlaceAddedSchema,
  PlaceRenamedSchema,
  PlaceMovedSchema,
  PlaceNoteEditedSchema,
  PlaceDeletedSchema,
} from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/events_pb.js";
import {
  PlaceUnavailableSchema,
  PlaceAlreadyExistsSchema,
  PlaceRevisionConflictSchema,
  InvalidPlaceCoordinatesSchema,
} from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/rejections_pb.js";
import {
  AddPlaceSchema,
  RenamePlaceSchema,
  MovePlaceSchema,
  EditPlaceNoteSchema,
  DeletePlaceSchema,
} from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/commands_pb.js";
import {
  CoordinatesSchema,
  PlaceIdSchema,
} from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/types_pb.js";
import { UserIdSchema, EventSchema } from "@spine-event-engine/proto";
import { EventUpdatesSchema, SubscriptionUpdateSchema } from "@spine-event-engine/proto/client";
import { expect, it, vi } from "vitest";
import { FieldnotesPlaceCollection } from "../src/place-collection";
import { FieldnotesPlaceCommands } from "../src/place-commands";

function delivery(message: ReturnType<typeof AnyPacker.pack>): SubscriptionDelivery {
  return {
    kind: "update",
    update: create(SubscriptionUpdateSchema, {
      update: {
        case: "eventUpdates",
        value: create(EventUpdatesSchema, {
          event: [create(EventSchema, { message })],
        }),
      },
    }),
  };
}

function subscription(update: SubscriptionDelivery, onCancel: () => void): Subscription {
  return {
    updates: {
      async *[Symbol.asyncIterator]() {
        await Promise.resolve();
        yield update;
      },
    },
    lifecycle: {
      async *[Symbol.asyncIterator]() {
        await Promise.resolve();
        yield* [];
      },
    },
    activate: () => Promise.resolve(),
    cancel: () => {
      onCancel();
      return Promise.resolve();
    },
  };
}

it("waits for the projected revision after a matching accepted rename Event", async () => {
  const collection = new FieldnotesPlaceCollection(
    "author",
    () => Promise.resolve([]),
    () => undefined,
  );
  const id = create(PlaceIdSchema, { value: "same" });
  let cancelled = false;
  const event = delivery(
    AnyPacker.pack(
      PlaceRenamedSchema,
      create(PlaceRenamedSchema, {
        id,
        name: "Revised",
        author: create(UserIdSchema, { value: "author" }),
        revision: 2,
      }),
    ),
  );
  const request: Pick<ClientRequest, "postAndSubscribe"> = {
    postAndSubscribe: () =>
      Promise.resolve({
        kind: "accepted",
        acknowledgement: { kind: "ok" },
        subscription: subscription(event, () => {
          cancelled = true;
        }),
      }),
  };
  const commands = new FieldnotesPlaceCommands(request, collection);
  let settled = false;
  const result = commands.rename("same", "Revised", 1).then((value) => {
    settled = true;
    return value;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(settled).toBe(false);
  collection.receive(
    create(PlaceViewSchema, {
      id,
      author: create(UserIdSchema, { value: "author" }),
      name: "Revised",
      coordinates: create(CoordinatesSchema, { latitude: 38.7, longitude: -9.1 }),
      placeKey: new TextEncoder().encode("same"),
      revision: 2,
    }),
  );
  await expect(result).resolves.toEqual({ kind: "committed", id: "same", revision: 2 });
  expect(cancelled).toBe(true);
});

it("returns the accepted Event revision when the visible projection is already newer", async () => {
  const collection = new FieldnotesPlaceCollection(
    "author",
    () => Promise.resolve([]),
    () => undefined,
  );
  const id = create(PlaceIdSchema, { value: "same" });
  collection.receive(
    create(PlaceViewSchema, {
      id,
      author: create(UserIdSchema, { value: "author" }),
      name: "Later name",
      coordinates: create(CoordinatesSchema, { latitude: 38.7, longitude: -9.1 }),
      placeKey: new TextEncoder().encode("same"),
      revision: 3,
    }),
  );
  const event = delivery(
    AnyPacker.pack(
      PlaceRenamedSchema,
      create(PlaceRenamedSchema, {
        id,
        name: "Earlier name",
        author: create(UserIdSchema, { value: "author" }),
        revision: 2,
      }),
    ),
  );
  const request: Pick<ClientRequest, "postAndSubscribe"> = {
    postAndSubscribe: () =>
      Promise.resolve({
        kind: "accepted",
        acknowledgement: { kind: "ok" },
        subscription: subscription(event, () => undefined),
      }),
  };
  const commands = new FieldnotesPlaceCommands(request, collection);
  await expect(commands.rename("same", "Earlier name", 1)).resolves.toEqual({
    kind: "committed",
    id: "same",
    revision: 2,
  });
  expect(collection.places()[0]?.revision).toBe(3);
});

it("reports a revision conflict without clearing a caller's draft", async () => {
  const collection = new FieldnotesPlaceCollection(
    "author",
    () => Promise.resolve([]),
    () => undefined,
  );
  const event = delivery(
    AnyPacker.pack(
      PlaceRevisionConflictSchema,
      create(PlaceRevisionConflictSchema, {
        requester: create(UserIdSchema, { value: "author" }),
        currentRevision: 7,
      }),
    ),
  );
  const onCancel = vi.fn();
  const request: Pick<ClientRequest, "postAndSubscribe"> = {
    postAndSubscribe: () =>
      Promise.resolve({
        kind: "accepted",
        acknowledgement: { kind: "ok" },
        subscription: subscription(event, onCancel),
      }),
  };
  const commands = new FieldnotesPlaceCommands(request, collection);
  await expect(commands.note("same", "unsaved words", 2)).resolves.toEqual({
    kind: "conflict",
    currentRevision: 7,
  });
  expect(onCancel).toHaveBeenCalledOnce();
});

it("maps each AddPlace refusal without waiting for an unrelated projected state", async () => {
  const messages = [
    [AnyPacker.pack(PlaceUnavailableSchema, create(PlaceUnavailableSchema)), "unavailable"],
    [AnyPacker.pack(PlaceAlreadyExistsSchema, create(PlaceAlreadyExistsSchema)), "already-exists"],
    [
      AnyPacker.pack(InvalidPlaceCoordinatesSchema, create(InvalidPlaceCoordinatesSchema)),
      "invalid-coordinates",
    ],
  ] as const;
  const collection = new FieldnotesPlaceCollection(
    "author",
    () => Promise.resolve([]),
    () => undefined,
  );
  for (const [message, kind] of messages) {
    const cancelled = vi.fn();
    const request: Pick<ClientRequest, "postAndSubscribe"> = {
      postAndSubscribe: () =>
        Promise.resolve({
          kind: "accepted",
          acknowledgement: { kind: "ok" },
          subscription: subscription(delivery(message), cancelled),
        }),
    };
    const commands = new FieldnotesPlaceCommands(request, collection);
    await expect(commands.add("New", 38.7, -9.1, "note")).resolves.toEqual({ kind });
    expect(cancelled).toHaveBeenCalledOnce();
  }
});

it("reports an interrupted outcome stream and still releases its subscription", async () => {
  const cancel = vi.fn(() => Promise.reject(new Error("socket already closed")));
  const silent: Subscription = {
    updates: {
      async *[Symbol.asyncIterator]() {
        await Promise.resolve();
        yield* [];
      },
    },
    lifecycle: {
      async *[Symbol.asyncIterator]() {
        await Promise.resolve();
        yield* [];
      },
    },
    activate: () => Promise.resolve(),
    cancel,
  };
  const request: Pick<ClientRequest, "postAndSubscribe"> = {
    postAndSubscribe: () =>
      Promise.resolve({ kind: "accepted", acknowledgement: { kind: "ok" }, subscription: silent }),
  };
  const collection = new FieldnotesPlaceCollection(
    "author",
    () => Promise.resolve([]),
    () => undefined,
  );
  const commands = new FieldnotesPlaceCommands(request, collection);
  await expect(commands.rename("same", "Changed", 1)).resolves.toEqual({ kind: "interrupted" });
  expect(cancel).toHaveBeenCalledOnce();
});

it("selects every domain-correct outcome type for each distinct Command", async () => {
  const silent: Subscription = {
    updates: {
      async *[Symbol.asyncIterator]() {
        await Promise.resolve();
        yield* [];
      },
    },
    lifecycle: {
      async *[Symbol.asyncIterator]() {
        await Promise.resolve();
        yield* [];
      },
    },
    activate: () => Promise.resolve(),
    cancel: () => Promise.resolve(),
  };
  const postAndSubscribe = vi.fn(() =>
    Promise.resolve({
      kind: "accepted" as const,
      acknowledgement: { kind: "ok" as const },
      subscription: silent,
    }),
  );
  const collection = new FieldnotesPlaceCollection(
    "author",
    () => Promise.resolve([]),
    () => undefined,
  );
  const commands = new FieldnotesPlaceCommands({ postAndSubscribe }, collection);
  await commands.add("New", 38.7, -9.1, "note");
  await commands.rename("same", "Name", 1);
  await commands.move("same", 38.7, -9.1, 1);
  await commands.note("same", "note", 1);
  await commands.delete("same", 1);
  const expected = [
    [
      AddPlaceSchema,
      PlaceAddedSchema,
      [PlaceUnavailableSchema, PlaceAlreadyExistsSchema, InvalidPlaceCoordinatesSchema],
    ],
    [RenamePlaceSchema, PlaceRenamedSchema, [PlaceUnavailableSchema, PlaceRevisionConflictSchema]],
    [
      MovePlaceSchema,
      PlaceMovedSchema,
      [PlaceUnavailableSchema, PlaceRevisionConflictSchema, InvalidPlaceCoordinatesSchema],
    ],
    [
      EditPlaceNoteSchema,
      PlaceNoteEditedSchema,
      [PlaceUnavailableSchema, PlaceRevisionConflictSchema],
    ],
    [DeletePlaceSchema, PlaceDeletedSchema, [PlaceUnavailableSchema, PlaceRevisionConflictSchema]],
  ] as const;
  for (const [index, [command, event, rejections]] of expected.entries())
    expect(postAndSubscribe).toHaveBeenNthCalledWith(index + 1, command, expect.anything(), {
      events: [event],
      rejections,
    });
});

it("passes one UI cancellation signal through all five native command attempts", async () => {
  const signal = new AbortController().signal;
  const postAndSubscribe = vi.fn(() =>
    Promise.resolve({
      kind: "refused" as const,
      acknowledgement: { kind: "rejection" as const, rejection: create(PlaceUnavailableSchema) },
    }),
  );
  const collection = new FieldnotesPlaceCollection(
    "author",
    () => Promise.resolve([]),
    () => undefined,
  );
  const commands = new FieldnotesPlaceCommands({ postAndSubscribe }, collection);
  const outcomes = await Promise.all([
    commands.add("New", 38.7, -9.1, "note", signal),
    commands.rename("same", "Name", 1, signal),
    commands.move("same", 38.7, -9.1, 1, signal),
    commands.note("same", "note", 1, signal),
    commands.delete("same", 1, signal),
  ]);
  expect(outcomes).toEqual(Array.from({ length: 5 }, () => ({ kind: "refused" })));
  for (let index = 1; index <= 5; index++)
    expect(postAndSubscribe).toHaveBeenNthCalledWith(
      index,
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ signal }),
    );
});
