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

import { clone, create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { AnyPacker, SignalEnvelopes, TypeUrls } from "@spine-event-engine/core";
import { Client } from "@spine-event-engine/client-node";
import {
  CommandSchema,
  EventContextSchema,
  EventSchema,
  UserIdSchema,
  type Event,
} from "@spine-event-engine/proto";
import { TargetSchema, TopicIdSchema, TopicSchema } from "@spine-event-engine/proto/client";
import {
  Application,
  Server,
  ServerEnvironment,
  SignalMetadata,
  type BoundedContext,
} from "@spine-event-engine/server";
import { ApplicationTests, observeProducedSignals } from "@spine-event-engine/server/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AddPlaceSchema,
  DeletePlaceSchema,
  EditPlaceNoteSchema,
  MovePlaceSchema,
  RenamePlaceSchema,
} from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/commands_pb.js";
import {
  PlaceSchema,
  PlaceViewSchema,
} from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/entities_pb.js";
import {
  PlaceDeletedSchema,
  PlaceMovedSchema,
  PlaceNoteEditedSchema,
  PlaceRenamedSchema,
} from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/events_pb.js";
import {
  CoordinatesSchema,
  PlaceIdSchema,
} from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/types_pb.js";
import {
  PlaceAlreadyExistsSchema,
  PlaceRevisionConflictSchema,
  PlaceUnavailableSchema,
} from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/rejections_pb.js";
import { createFieldnotesContext } from "../src/index.js";

const metadata = new SignalMetadata();
const sessions = new Set<Awaited<ReturnType<typeof openPlaceSession>>>();
let currentApplication: Application;

async function waitForDelivery(): Promise<void> {
  await ApplicationTests.waitForDelivery(currentApplication);
}

async function openPlaceSession() {
  const environment = ServerEnvironment.newBuilder().build();
  const application = await Application.newBuilder()
    .setServerEnvironment(environment)
    .add(createFieldnotesContext())
    .build();
  const context: BoundedContext | undefined = application.contexts()[0];
  if (context === undefined) throw new Error("Expected a Bounded Context in the Application.");
  const endpoint = await Server.atPort(0).setApplication(application).start();
  const client = Client.connectTo(endpoint.baseUrl);
  const events: Event[] = [];
  const observation = observeProducedSignals(context, {
    onEvent: (event) => events.push(clone(EventSchema, event)),
  });
  currentApplication = application;
  let closed = false;
  const session = {
    context,
    onBehalfOf: (actor: string) => client.onBehalfOf(actor),
    assertEvents: () => events.map((event) => clone(EventSchema, event)),
    close: async () => {
      if (closed) return;
      await client.close();
      await endpoint.close();
      observation.close();
      await application.close();
      closed = true;
      sessions.delete(session);
    },
  };
  sessions.add(session);
  return session;
}

describe("Fieldnotes Place domain", () => {
  afterEach(async () => {
    await Promise.all([...sessions].map((session) => session.close()));
  });

  it("creates a place with the admitted author, empty Markdown and revision one", async () => {
    const session = await openPlaceSession();
    const context = session.context;
    const id = create(PlaceIdSchema, { value: "place-one" });
    const coordinates = create(CoordinatesSchema, { latitude: 38.7, longitude: -9.1 });
    const actorContext = metadata.actorContext({
      actor: create(UserIdSchema, { value: "author-one" }),
    });
    try {
      await context.commandBus().post(
        SignalEnvelopes.command({
          context: metadata.commandContext({ actorContext }),
          schema: AddPlaceSchema,
          message: create(AddPlaceSchema, { id, name: "Belém", coordinates, markdown: "" }),
        }),
      );
      await waitForDelivery();
      expect(await context.stand().read(PlaceSchema, id)).toMatchObject({
        id,
        name: "Belém",
        coordinates,
        markdown: "",
        author: { value: "author-one" },
        revision: 1,
        removed: false,
      });
      await vi.waitFor(async () => {
        const view = await context.stand().read(PlaceViewSchema, id);
        expect(view?.whenCreated).toBeDefined();
        expect(view).toMatchObject({
          name: "Belém",
          author: { value: "author-one" },
          revision: 1,
        });
      });
    } finally {
      await session.close();
    }
  });

  it("applies each accepted edit once and leaves a deleted tombstone", async () => {
    const session = await openPlaceSession();
    const context = session.context;
    const id = create(PlaceIdSchema, { value: "edited-place" });
    const actorContext = metadata.actorContext({
      actor: create(UserIdSchema, { value: "editor" }),
    });
    const coordinates = create(CoordinatesSchema, { latitude: 38.7, longitude: -9.1 });
    const moved = create(CoordinatesSchema, { latitude: 41.1, longitude: -8.6 });
    const keyAt = async (revision: number) =>
      vi.waitFor(async () => {
        const view = await context.stand().read(PlaceViewSchema, id);
        expect(view?.whenCreated).toBeDefined();
        expect(view).toMatchObject({
          id,
          revision,
        });
      });
    try {
      await context.commandBus().post(
        SignalEnvelopes.command({
          context: metadata.commandContext({ actorContext }),
          schema: AddPlaceSchema,
          message: create(AddPlaceSchema, { id, name: "Initial", coordinates, markdown: "Start" }),
        }),
      );
      await keyAt(1);
      const whenCreated = (await context.stand().read(PlaceSchema, id))?.whenCreated;
      expect(whenCreated).toBeDefined();
      await context.commandBus().post(
        SignalEnvelopes.command({
          context: metadata.commandContext({ actorContext }),
          schema: RenamePlaceSchema,
          message: create(RenamePlaceSchema, { id, name: "Renamed", expectedRevision: 1 }),
        }),
      );
      await waitForDelivery();
      expect(await context.stand().read(PlaceSchema, id)).toMatchObject({
        name: "Renamed",
        revision: 2,
        whenCreated,
      });
      await keyAt(2);
      await context.commandBus().post(
        SignalEnvelopes.command({
          context: metadata.commandContext({ actorContext }),
          schema: MovePlaceSchema,
          message: create(MovePlaceSchema, { id, coordinates: moved, expectedRevision: 2 }),
        }),
      );
      await waitForDelivery();
      expect(await context.stand().read(PlaceSchema, id)).toMatchObject({
        coordinates: moved,
        revision: 3,
        whenCreated,
      });
      await keyAt(3);
      await context.commandBus().post(
        SignalEnvelopes.command({
          context: metadata.commandContext({ actorContext }),
          schema: EditPlaceNoteSchema,
          message: create(EditPlaceNoteSchema, { id, markdown: "", expectedRevision: 3 }),
        }),
      );
      await waitForDelivery();
      expect(await context.stand().read(PlaceSchema, id)).toMatchObject({
        markdown: "",
        revision: 4,
        whenCreated,
      });
      await keyAt(4);
      await context.commandBus().post(
        SignalEnvelopes.command({
          context: metadata.commandContext({ actorContext }),
          schema: DeletePlaceSchema,
          message: create(DeletePlaceSchema, { id, expectedRevision: 4 }),
        }),
      );
      await waitForDelivery();
      expect(await context.stand().read(PlaceSchema, id)).toMatchObject({
        removed: true,
        revision: 5,
        whenCreated,
      });
      await keyAt(5);
      const deletedState = await context.stand().read(PlaceSchema, id);
      await context.commandBus().post(
        SignalEnvelopes.command({
          context: metadata.commandContext({ actorContext }),
          schema: AddPlaceSchema,
          message: create(AddPlaceSchema, { id, name: "Resurrected", coordinates }),
        }),
      );
      await context.commandBus().post(
        SignalEnvelopes.command({
          context: metadata.commandContext({ actorContext }),
          schema: RenamePlaceSchema,
          message: create(RenamePlaceSchema, { id, name: "Resurrected", expectedRevision: 5 }),
        }),
      );
      expect(await context.stand().read(PlaceSchema, id)).toEqual(deletedState);
      await vi.waitFor(async () => {
        expect(await context.stand().read(PlaceViewSchema, id)).toMatchObject({
          removed: true,
          revision: 5,
          author: { value: "editor" },
          name: "",
          markdown: "",
        });
      });
    } finally {
      await session.close();
    }
  });

  it("keeps distinct IDs at the same coordinates and refuses repeated creation", async () => {
    const session = await openPlaceSession();
    const context = session.context;
    const actorContext = metadata.actorContext({
      actor: create(UserIdSchema, { value: "one-author" }),
    });
    const foreignContext = metadata.actorContext({
      actor: create(UserIdSchema, { value: "other-author" }),
    });
    const coordinates = create(CoordinatesSchema, { latitude: 40, longitude: -8 });
    const first = create(PlaceIdSchema, { value: "shared-point-one" });
    const second = create(PlaceIdSchema, { value: "shared-point-two" });
    try {
      for (const id of [first, second])
        await context.commandBus().post(
          SignalEnvelopes.command({
            context: metadata.commandContext({ actorContext }),
            schema: AddPlaceSchema,
            message: create(AddPlaceSchema, { id, name: id.value, coordinates }),
          }),
        );
      await waitForDelivery();
      const before = await context.stand().read(PlaceSchema, first);
      expect(await context.stand().read(PlaceSchema, second)).toMatchObject({
        coordinates,
        author: { value: "one-author" },
        revision: 1,
      });
      for (const attemptedActor of [actorContext, foreignContext])
        await context.commandBus().post(
          SignalEnvelopes.command({
            context: metadata.commandContext({ actorContext: attemptedActor }),
            schema: AddPlaceSchema,
            message: create(AddPlaceSchema, { id: first, name: "Overwritten", coordinates }),
          }),
        );
      await waitForDelivery();
      expect(await context.stand().read(PlaceSchema, first)).toEqual(before);
    } finally {
      await session.close();
    }
  });

  it("uses unavailable refusal for a removed ID and already-exists for an active duplicate", async () => {
    const session = await openPlaceSession();
    const box = session;
    const author = box.onBehalfOf("author");
    const id = create(PlaceIdSchema, { value: "creation-refusals" });
    const topic = (schema: typeof PlaceUnavailableSchema | typeof PlaceAlreadyExistsSchema) =>
      create(TopicSchema, {
        id: create(TopicIdSchema, { value: `topic-${schema.typeName}` }),
        target: create(TargetSchema, {
          type: TypeUrls.derive(schema),
          criterion: { case: "includeAll", value: true },
        }),
        context: metadata.actorContext({ actor: create(UserIdSchema, { value: "author" }) }),
      });
    const unavailable = await author.createSubscription(topic(PlaceUnavailableSchema), {
      kind: "event",
    });
    const alreadyExists = await author.createSubscription(topic(PlaceAlreadyExistsSchema), {
      kind: "event",
    });
    await unavailable.activate();
    await alreadyExists.activate();
    const command = create(AddPlaceSchema, {
      id,
      name: "Original",
      coordinates: create(CoordinatesSchema, { latitude: 1, longitude: 2 }),
    });
    try {
      await author.post(AddPlaceSchema, command);
      const activeRefusal = alreadyExists.updates[Symbol.asyncIterator]().next();
      await author.post(AddPlaceSchema, command);
      const active = eventFromDelivery(await activeRefusal);
      expect(
        active?.message && AnyPacker.tryUnpack(active.message, PlaceAlreadyExistsSchema),
      ).toMatchObject({ requester: { value: "author" } });
      await author.post(DeletePlaceSchema, create(DeletePlaceSchema, { id, expectedRevision: 1 }));
      const removedRefusal = unavailable.updates[Symbol.asyncIterator]().next();
      await author.post(AddPlaceSchema, command);
      const removed = eventFromDelivery(await removedRefusal);
      expect(
        removed?.message && AnyPacker.tryUnpack(removed.message, PlaceUnavailableSchema),
      ).toMatchObject({ requester: { value: "author" } });
    } finally {
      await unavailable.cancel();
      await alreadyExists.cancel();
      await box.close();
    }
  });

  it("does not apply an exact repeated command or reuse its ID with altered content", async () => {
    const session = await openPlaceSession();
    const context = session.context;
    const id = create(PlaceIdSchema, { value: "duplicate-command" });
    const actorContext = metadata.actorContext({
      actor: create(UserIdSchema, { value: "author" }),
    });
    try {
      await context.commandBus().post(
        SignalEnvelopes.command({
          context: metadata.commandContext({ actorContext }),
          schema: AddPlaceSchema,
          message: create(AddPlaceSchema, {
            id,
            name: "First",
            coordinates: create(CoordinatesSchema, { latitude: 1, longitude: 2 }),
          }),
        }),
      );
      const command = SignalEnvelopes.command({
        context: metadata.commandContext({ actorContext }),
        schema: RenamePlaceSchema,
        message: create(RenamePlaceSchema, { id, name: "Second", expectedRevision: 1 }),
      });
      await context.commandBus().post(command);
      await waitForDelivery();
      const accepted = await context.stand().read(PlaceSchema, id);
      await context.commandBus().post(command);
      await waitForDelivery();
      expect(await context.stand().read(PlaceSchema, id)).toEqual(accepted);
      const altered = clone(CommandSchema, command);
      altered.message = AnyPacker.pack(
        RenamePlaceSchema,
        create(RenamePlaceSchema, { id, name: "Injected", expectedRevision: 1 }),
      );
      await context.commandBus().post(altered);
      await waitForDelivery();
      expect(await context.stand().read(PlaceSchema, id)).toEqual(accepted);
    } finally {
      await session.close();
    }
  });

  it("checks the author before stale revision and keeps state unchanged", async () => {
    const session = await openPlaceSession();
    const context = session.context;
    const id = create(PlaceIdSchema, { value: "private-place" });
    const actorContext = metadata.actorContext({
      actor: create(UserIdSchema, { value: "author" }),
    });
    const foreignContext = metadata.actorContext({
      actor: create(UserIdSchema, { value: "foreign" }),
    });
    const coordinates = create(CoordinatesSchema, { latitude: 0, longitude: 0 });
    try {
      await context.commandBus().post(
        SignalEnvelopes.command({
          context: metadata.commandContext({ actorContext }),
          schema: AddPlaceSchema,
          message: create(AddPlaceSchema, { id, name: "Private", coordinates }),
        }),
      );
      await waitForDelivery();
      const before = await context.stand().read(PlaceSchema, id);
      await context.commandBus().post(
        SignalEnvelopes.command({
          context: metadata.commandContext({ actorContext: foreignContext }),
          schema: RenamePlaceSchema,
          message: create(RenamePlaceSchema, { id, name: "Foreign", expectedRevision: 0 }),
        }),
      );
      await context.commandBus().post(
        SignalEnvelopes.command({
          context: metadata.commandContext({ actorContext }),
          schema: EditPlaceNoteSchema,
          message: create(EditPlaceNoteSchema, { id, markdown: "Stale", expectedRevision: 0 }),
        }),
      );
      await waitForDelivery();
      expect(await context.stand().read(PlaceSchema, id)).toEqual(before);
    } finally {
      await session.close();
    }
  });

  it("emits requester-only refusal before revealing a revision conflict", async () => {
    const session = await openPlaceSession();
    const box = session;
    const id = create(PlaceIdSchema, { value: "hidden-place" });
    const author = box.onBehalfOf("author");
    const foreign = box.onBehalfOf("foreign");
    const topic = (schema: typeof PlaceUnavailableSchema | typeof PlaceRevisionConflictSchema) =>
      create(TopicSchema, {
        id: create(TopicIdSchema, { value: `topic-${schema.typeName}` }),
        target: create(TargetSchema, {
          type: TypeUrls.derive(schema),
          criterion: { case: "includeAll", value: true },
        }),
        context: metadata.actorContext({ actor: create(UserIdSchema, { value: "author" }) }),
      });
    const refusalSubscription = await author.createSubscription(topic(PlaceUnavailableSchema), {
      kind: "event",
    });
    const conflictSubscription = await author.createSubscription(
      topic(PlaceRevisionConflictSchema),
      { kind: "event" },
    );
    await refusalSubscription.activate();
    await conflictSubscription.activate();
    const refusals = refusalSubscription.updates[Symbol.asyncIterator]();
    const conflicts = conflictSubscription.updates[Symbol.asyncIterator]();
    try {
      await author.post(
        AddPlaceSchema,
        create(AddPlaceSchema, {
          id,
          name: "Hidden",
          coordinates: create(CoordinatesSchema, { latitude: 4, longitude: 5 }),
        }),
      );
      const pendingRefusal = refusals.next();
      await foreign.post(
        RenamePlaceSchema,
        create(RenamePlaceSchema, {
          id,
          name: "Denied",
          expectedRevision: 0,
        }),
      );
      const pendingConflict = conflicts.next();
      await author.post(
        RenamePlaceSchema,
        create(RenamePlaceSchema, {
          id,
          name: "Stale",
          expectedRevision: 0,
        }),
      );
      const refusalUpdate: unknown = await pendingRefusal;
      const conflictUpdate: unknown = await pendingConflict;
      const refusalEvent = eventFromDelivery(refusalUpdate);
      const conflictEvent = eventFromDelivery(conflictUpdate);
      expect(
        refusalEvent?.message && AnyPacker.tryUnpack(refusalEvent.message, PlaceUnavailableSchema),
      ).toMatchObject({ requester: { value: "foreign" } });
      expect(
        conflictEvent?.message &&
          AnyPacker.tryUnpack(conflictEvent.message, PlaceRevisionConflictSchema),
      ).toMatchObject({ requester: { value: "author" }, currentRevision: 1 });
    } finally {
      await refusalSubscription.cancel();
      await conflictSubscription.cancel();
      await box.close();
    }
  });

  it("rejects invalid coordinates before creation and preserves a deleted projection on stale Event delivery", async () => {
    const session = await openPlaceSession();
    const context = session.context;
    const id = create(PlaceIdSchema, { value: "stale-place" });
    const actorContext = metadata.actorContext({
      actor: create(UserIdSchema, { value: "author" }),
    });
    try {
      await context.commandBus().post(
        SignalEnvelopes.command({
          context: metadata.commandContext({ actorContext }),
          schema: AddPlaceSchema,
          message: create(AddPlaceSchema, {
            id,
            name: "Invalid",
            coordinates: create(CoordinatesSchema, { latitude: 91, longitude: 0 }),
          }),
        }),
      );
      expect(await context.stand().read(PlaceSchema, id)).toBeUndefined();
      await context.commandBus().post(
        SignalEnvelopes.command({
          context: metadata.commandContext({ actorContext }),
          schema: AddPlaceSchema,
          message: create(AddPlaceSchema, {
            id,
            name: "Valid",
            coordinates: create(CoordinatesSchema, { latitude: 0, longitude: 0 }),
          }),
        }),
      );
      await context.commandBus().post(
        SignalEnvelopes.command({
          context: metadata.commandContext({ actorContext }),
          schema: DeletePlaceSchema,
          message: create(DeletePlaceSchema, { id, expectedRevision: 1 }),
        }),
      );
      await vi.waitFor(async () => {
        expect(await context.stand().read(PlaceViewSchema, id)).toMatchObject({
          removed: true,
          revision: 2,
        });
      });
      await context.eventBus().post(
        SignalEnvelopes.event({
          context: create(EventContextSchema, {
            timestamp: metadata.timestamp(),
            producerId: AnyPacker.pack(PlaceIdSchema, id),
          }),
          schema: PlaceRenamedSchema,
          message: create(PlaceRenamedSchema, {
            id,
            name: "Restored?",
            author: create(UserIdSchema, { value: "author" }),
            revision: 1,
            whenOccurred: metadata.timestamp(),
          }),
        }),
      );
      expect(await context.stand().read(PlaceViewSchema, id)).toMatchObject({
        name: "",
        removed: true,
        revision: 2,
      });
    } finally {
      await session.close();
    }
  });

  it("rebuilds complete results from Aggregate Events in changed delivery orders", async () => {
    const sourceSession = await openPlaceSession();
    const box = sourceSession;
    const actor = box.onBehalfOf("author");
    const id = create(PlaceIdSchema, { value: "ordered-place" });
    const firstPoint = create(CoordinatesSchema, { latitude: 10, longitude: 11 });
    const nextPoint = create(CoordinatesSchema, { latitude: 12, longitude: 13 });
    let events;
    try {
      await actor.post(
        AddPlaceSchema,
        create(AddPlaceSchema, { id, name: "First", coordinates: firstPoint, markdown: "initial" }),
      );
      await actor.post(
        RenamePlaceSchema,
        create(RenamePlaceSchema, { id, name: "Second", expectedRevision: 1 }),
      );
      await actor.post(
        MovePlaceSchema,
        create(MovePlaceSchema, { id, coordinates: nextPoint, expectedRevision: 2 }),
      );
      await actor.post(
        EditPlaceNoteSchema,
        create(EditPlaceNoteSchema, { id, markdown: "latest", expectedRevision: 3 }),
      );
      await actor.post(DeletePlaceSchema, create(DeletePlaceSchema, { id, expectedRevision: 4 }));
      await vi.waitFor(() => {
        expect(box.assertEvents()).toHaveLength(5);
      });
      events = box.assertEvents();
      const moved = events[2]?.message && AnyPacker.tryUnpack(events[2].message, PlaceMovedSchema);
      const edited =
        events[3]?.message && AnyPacker.tryUnpack(events[3].message, PlaceNoteEditedSchema);
      const deleted =
        events[4]?.message && AnyPacker.tryUnpack(events[4].message, PlaceDeletedSchema);
      expect(moved).toMatchObject({
        name: "Second",
        coordinates: nextPoint,
        markdown: "initial",
        revision: 3,
        author: { value: "author" },
      });
      expect(edited).toMatchObject({
        name: "Second",
        coordinates: nextPoint,
        markdown: "latest",
        revision: 4,
      });
      expect(deleted).toMatchObject({
        name: "",
        markdown: "",
        revision: 5,
        author: { value: "author" },
      });
      expect(moved?.whenCreated).toEqual(edited?.whenCreated);
      expect(edited?.whenCreated).toEqual(deleted?.whenCreated);
    } finally {
      await box.close();
    }
    const restartedSession = await openPlaceSession();
    const restarted = restartedSession.context;
    try {
      for (const index of [2, 1, 0, 2, 3]) {
        const event = events[index];
        if (event === undefined) throw new Error("Missing accepted Event.");
        await restarted.eventBus().post(clone(EventSchema, { ...event, id: metadata.eventId() }));
      }
      await waitForDelivery();
      expect(await restarted.stand().read(PlaceViewSchema, id)).toMatchObject({
        name: "Second",
        coordinates: nextPoint,
        markdown: "latest",
        revision: 4,
        author: { value: "author" },
      });
      const deletion = events[4];
      if (deletion === undefined) throw new Error("Missing deletion Event.");
      await restarted.eventBus().post(clone(EventSchema, { ...deletion, id: metadata.eventId() }));
      for (const index of [0, 1, 2, 3, 4]) {
        const event = events[index];
        if (event === undefined) throw new Error("Missing accepted Event.");
        await restarted.eventBus().post(clone(EventSchema, { ...event, id: metadata.eventId() }));
      }
      await waitForDelivery();
      expect(await restarted.stand().read(PlaceViewSchema, id)).toMatchObject({
        name: "",
        markdown: "",
        removed: true,
        revision: 5,
        author: { value: "author" },
      });
    } finally {
      await restartedSession.close();
    }
    const noteFirstSession = await openPlaceSession();
    const noteFirst = noteFirstSession.context;
    try {
      for (const index of [3, 2, 1, 0]) {
        const event = events[index];
        if (event === undefined) throw new Error("Missing accepted Event.");
        await noteFirst.eventBus().post(clone(EventSchema, { ...event, id: metadata.eventId() }));
      }
      await waitForDelivery();
      expect(await noteFirst.stand().read(PlaceViewSchema, id)).toMatchObject({
        name: "Second",
        coordinates: nextPoint,
        markdown: "latest",
        revision: 4,
        author: { value: "author" },
        removed: false,
      });
    } finally {
      await noteFirstSession.close();
    }
    const deletedFirstSession = await openPlaceSession();
    const deletedFirst = deletedFirstSession.context;
    try {
      for (const index of [4, 0, 1, 2, 3, 4]) {
        const event = events[index];
        if (event === undefined) throw new Error("Missing accepted Event.");
        await deletedFirst
          .eventBus()
          .post(clone(EventSchema, { ...event, id: metadata.eventId() }));
      }
      await waitForDelivery();
      expect(await deletedFirst.stand().read(PlaceViewSchema, id)).toMatchObject({
        name: "",
        markdown: "",
        revision: 5,
        author: { value: "author" },
        removed: true,
      });
    } finally {
      await deletedFirstSession.close();
    }
  });

  it("preserves the first complete Event's author and creation time against newer inconsistent Events", async () => {
    const session = await openPlaceSession();
    const context = session.context;
    const id = create(PlaceIdSchema, { value: "immutable-place" });
    const author = create(UserIdSchema, { value: "original-author" });
    const whenCreated = metadata.timestamp();
    const changedAt = create(TimestampSchema, { seconds: whenCreated.seconds + 1n });
    const coordinates = create(CoordinatesSchema, { latitude: 38.7, longitude: -9.1 });
    const post = (event: ReturnType<typeof create<typeof PlaceRenamedSchema>>) =>
      context.eventBus().post(
        SignalEnvelopes.event({
          context: create(EventContextSchema, {
            timestamp: metadata.timestamp(),
            producerId: AnyPacker.pack(PlaceIdSchema, id),
          }),
          schema: PlaceRenamedSchema,
          message: event,
        }),
      );
    try {
      const first = create(PlaceRenamedSchema, {
        id,
        name: "First complete result",
        coordinates,
        author,
        markdown: "initial",
        revision: 2,
        whenOccurred: whenCreated,
        whenCreated,
      });
      await post(first);
      await waitForDelivery();
      const accepted = await context.stand().read(PlaceViewSchema, id);
      expect(accepted).toMatchObject({
        name: "First complete result",
        revision: 2,
        author: { value: "original-author" },
        whenCreated,
      });
      await post(
        create(PlaceRenamedSchema, {
          ...first,
          name: "Foreign author",
          revision: 3,
          author: create(UserIdSchema, { value: "other-author" }),
        }),
      );
      await waitForDelivery();
      expect(await context.stand().read(PlaceViewSchema, id)).toEqual(accepted);
      await post(
        create(PlaceRenamedSchema, {
          ...first,
          name: "Changed creation",
          revision: 4,
          whenCreated: changedAt,
        }),
      );
      await waitForDelivery();
      expect(await context.stand().read(PlaceViewSchema, id)).toEqual(accepted);
      await post(
        create(PlaceRenamedSchema, {
          ...first,
          name: "Legitimate newer result",
          revision: 5,
          whenOccurred: changedAt,
        }),
      );
      await waitForDelivery();
      expect(await context.stand().read(PlaceViewSchema, id)).toMatchObject({
        name: "Legitimate newer result",
        revision: 5,
        author: { value: "original-author" },
        whenCreated,
      });
    } finally {
      await session.close();
    }
  });

  it("ignores incomplete first active Events so lower complete results can establish the view", async () => {
    const session = await openPlaceSession();
    const context = session.context;
    const author = create(UserIdSchema, { value: "author" });
    const whenCreated = metadata.timestamp();
    const coordinates = create(CoordinatesSchema, { latitude: 10, longitude: 11 });
    try {
      for (const missing of ["coordinates", "whenOccurred"] as const) {
        const id = create(PlaceIdSchema, { value: `missing-${missing}` });
        const complete = create(PlaceRenamedSchema, {
          id,
          name: "Complete result",
          coordinates,
          author,
          markdown: "note",
          revision: 4,
          whenOccurred: whenCreated,
          whenCreated,
        });
        const post = (message: typeof complete) =>
          context.eventBus().post(
            SignalEnvelopes.event({
              context: create(EventContextSchema, {
                timestamp: metadata.timestamp(),
                producerId: AnyPacker.pack(PlaceIdSchema, id),
              }),
              schema: PlaceRenamedSchema,
              message,
            }),
          );
        await post(
          create(PlaceRenamedSchema, {
            ...complete,
            revision: 9,
            [missing]: undefined,
          }),
        );
        await waitForDelivery();
        expect(await context.stand().read(PlaceViewSchema, id)).toBeUndefined();
        await post(complete);
        await waitForDelivery();
        expect(await context.stand().read(PlaceViewSchema, id)).toMatchObject({
          id,
          name: "Complete result",
          coordinates,
          author,
          revision: 4,
          whenCreated,
          whenUpdated: whenCreated,
          removed: false,
        });
      }
    } finally {
      await session.close();
    }
  });
});

function eventFromDelivery(result: unknown): Event | undefined {
  const delivery = result as {
    readonly value?: {
      readonly kind?: string;
      readonly update?: {
        readonly update?: {
          readonly case?: string;
          readonly value?: { readonly event?: readonly Event[] };
        };
      };
    };
  };
  return delivery.value?.kind === "update" && delivery.value.update?.update?.case === "eventUpdates"
    ? delivery.value.update.update.value?.event?.[0]
    : undefined;
}
