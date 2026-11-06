import { clone, create } from "@bufbuild/protobuf";
import { AnyPacker, SignalEnvelopes, TypeUrls } from "@spine-event-engine/core";
import {
  CommandSchema,
  EventContextSchema,
  EventSchema,
  UserIdSchema,
  type Event,
} from "@spine-event-engine/proto";
import { TargetSchema, TopicIdSchema, TopicSchema } from "@spine-event-engine/proto/client";
import { ServerEnvironment, SignalMetadata } from "@spine-event-engine/server";
import { ServerTests } from "@spine-event-engine/server/testing";
import { BlackBox } from "@spine-event-engine/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  PlaceRevisionConflictSchema,
  PlaceUnavailableSchema,
} from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/rejections_pb.js";
import { createFieldnotesContext } from "../src/index.js";

const metadata = new SignalMetadata();

describe("Fieldnotes Place domain", () => {
  beforeEach(async () => ServerEnvironment.instance().completeSetup());
  afterEach(async () => ServerTests.resetEnvironment());

  it("creates a place with the admitted author, empty Markdown and revision one", async () => {
    const context = await createFieldnotesContext();
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
        expect(await context.stand().read(PlaceViewSchema, id)).toMatchObject({
          name: "Belém",
          author: { value: "author-one" },
          revision: 1,
        });
      });
    } finally {
      await context.close();
    }
  });

  it("applies each accepted edit once and leaves a deleted tombstone", async () => {
    const context = await createFieldnotesContext();
    const id = create(PlaceIdSchema, { value: "edited-place" });
    const actorContext = metadata.actorContext({
      actor: create(UserIdSchema, { value: "editor" }),
    });
    const coordinates = create(CoordinatesSchema, { latitude: 38.7, longitude: -9.1 });
    const moved = create(CoordinatesSchema, { latitude: 41.1, longitude: -8.6 });
    try {
      await context.commandBus().post(
        SignalEnvelopes.command({
          context: metadata.commandContext({ actorContext }),
          schema: AddPlaceSchema,
          message: create(AddPlaceSchema, { id, name: "Initial", coordinates, markdown: "Start" }),
        }),
      );
      await context.commandBus().post(
        SignalEnvelopes.command({
          context: metadata.commandContext({ actorContext }),
          schema: RenamePlaceSchema,
          message: create(RenamePlaceSchema, { id, name: "Renamed", expectedRevision: 1 }),
        }),
      );
      expect(await context.stand().read(PlaceSchema, id)).toMatchObject({
        name: "Renamed",
        revision: 2,
      });
      await context.commandBus().post(
        SignalEnvelopes.command({
          context: metadata.commandContext({ actorContext }),
          schema: MovePlaceSchema,
          message: create(MovePlaceSchema, { id, coordinates: moved, expectedRevision: 2 }),
        }),
      );
      expect(await context.stand().read(PlaceSchema, id)).toMatchObject({
        coordinates: moved,
        revision: 3,
      });
      await context.commandBus().post(
        SignalEnvelopes.command({
          context: metadata.commandContext({ actorContext }),
          schema: EditPlaceNoteSchema,
          message: create(EditPlaceNoteSchema, { id, markdown: "", expectedRevision: 3 }),
        }),
      );
      expect(await context.stand().read(PlaceSchema, id)).toMatchObject({
        markdown: "",
        revision: 4,
      });
      await context.commandBus().post(
        SignalEnvelopes.command({
          context: metadata.commandContext({ actorContext }),
          schema: DeletePlaceSchema,
          message: create(DeletePlaceSchema, { id, expectedRevision: 4 }),
        }),
      );
      expect(await context.stand().read(PlaceSchema, id)).toMatchObject({
        removed: true,
        revision: 5,
      });
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
      await context.close();
    }
  });

  it("keeps distinct IDs at the same coordinates and refuses repeated creation", async () => {
    const context = await createFieldnotesContext();
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
      expect(await context.stand().read(PlaceSchema, first)).toEqual(before);
    } finally {
      await context.close();
    }
  });

  it("does not apply an exact repeated command or reuse its ID with altered content", async () => {
    const context = await createFieldnotesContext();
    const id = create(PlaceIdSchema, { value: "replayed-command" });
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
      const accepted = await context.stand().read(PlaceSchema, id);
      await context.commandBus().post(command);
      expect(await context.stand().read(PlaceSchema, id)).toEqual(accepted);
      const altered = clone(CommandSchema, command);
      altered.message = AnyPacker.pack(
        RenamePlaceSchema,
        create(RenamePlaceSchema, { id, name: "Injected", expectedRevision: 1 }),
      );
      await context.commandBus().post(altered);
      expect(await context.stand().read(PlaceSchema, id)).toEqual(accepted);
    } finally {
      await context.close();
    }
  });

  it("checks the author before stale revision and keeps state unchanged", async () => {
    const context = await createFieldnotesContext();
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
      expect(await context.stand().read(PlaceSchema, id)).toEqual(before);
    } finally {
      await context.close();
    }
  });

  it("emits requester-only refusal before revealing a revision conflict", async () => {
    const context = await createFieldnotesContext();
    const box = await BlackBox.from(context);
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

  it("rejects invalid coordinates before creation and preserves a deleted projection on old Event replay", async () => {
    const context = await createFieldnotesContext();
    const id = create(PlaceIdSchema, { value: "replay-place" });
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
            occurredAt: metadata.timestamp(),
          }),
        }),
      );
      expect(await context.stand().read(PlaceViewSchema, id)).toMatchObject({
        name: "",
        removed: true,
        revision: 2,
      });
    } finally {
      await context.close();
    }
  });

  it("rebuilds complete results from Aggregate Events in changed delivery orders", async () => {
    const source = await createFieldnotesContext();
    const box = await BlackBox.from(source);
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
      expect(moved?.createdAt).toEqual(edited?.createdAt);
      expect(edited?.createdAt).toEqual(deleted?.createdAt);
    } finally {
      await box.close();
    }
    await ServerTests.resetEnvironment();
    await ServerEnvironment.instance().completeSetup();
    const replay = await createFieldnotesContext();
    try {
      for (const index of [2, 1, 0, 2, 3]) {
        const event = events[index];
        if (event === undefined) throw new Error("Missing accepted Event.");
        await replay.eventBus().post(clone(EventSchema, { ...event, id: metadata.eventId() }));
      }
      expect(await replay.stand().read(PlaceViewSchema, id)).toMatchObject({
        name: "Second",
        coordinates: nextPoint,
        markdown: "latest",
        revision: 4,
        author: { value: "author" },
      });
      const deletion = events[4];
      if (deletion === undefined) throw new Error("Missing deletion Event.");
      await replay.eventBus().post(clone(EventSchema, { ...deletion, id: metadata.eventId() }));
      for (const index of [0, 1, 2, 3, 4]) {
        const event = events[index];
        if (event === undefined) throw new Error("Missing accepted Event.");
        await replay.eventBus().post(clone(EventSchema, { ...event, id: metadata.eventId() }));
      }
      expect(await replay.stand().read(PlaceViewSchema, id)).toMatchObject({
        name: "",
        markdown: "",
        removed: true,
        revision: 5,
        author: { value: "author" },
      });
    } finally {
      await replay.close();
    }
    await ServerTests.resetEnvironment();
    await ServerEnvironment.instance().completeSetup();
    const noteFirst = await createFieldnotesContext();
    try {
      for (const index of [3, 2, 1, 0]) {
        const event = events[index];
        if (event === undefined) throw new Error("Missing accepted Event.");
        await noteFirst.eventBus().post(clone(EventSchema, { ...event, id: metadata.eventId() }));
      }
      expect(await noteFirst.stand().read(PlaceViewSchema, id)).toMatchObject({
        name: "Second",
        coordinates: nextPoint,
        markdown: "latest",
        revision: 4,
        author: { value: "author" },
        removed: false,
      });
    } finally {
      await noteFirst.close();
    }
    await ServerTests.resetEnvironment();
    await ServerEnvironment.instance().completeSetup();
    const deletedFirst = await createFieldnotesContext();
    try {
      for (const index of [4, 0, 1, 2, 3, 4]) {
        const event = events[index];
        if (event === undefined) throw new Error("Missing accepted Event.");
        await deletedFirst
          .eventBus()
          .post(clone(EventSchema, { ...event, id: metadata.eventId() }));
      }
      expect(await deletedFirst.stand().read(PlaceViewSchema, id)).toMatchObject({
        name: "",
        markdown: "",
        revision: 5,
        author: { value: "author" },
        removed: true,
      });
    } finally {
      await deletedFirst.close();
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
