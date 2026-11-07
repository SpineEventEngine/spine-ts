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
import type { ClientRequest, PostAndSubscribeResult } from "@spine-event-engine/client-web";
import { AnyPacker } from "@spine-event-engine/core";
import {
  AddPlaceSchema,
  RenamePlaceSchema,
  MovePlaceSchema,
  EditPlaceNoteSchema,
  DeletePlaceSchema,
} from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/commands_pb.js";
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
  CoordinatesSchema,
  PlaceIdSchema,
} from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/types_pb.js";
import type { Event } from "@spine-event-engine/proto";
import { FieldnotesPlaceCollection } from "./place-collection";

/**
 * Result after Command admission, domain outcome and projected-view observation.
 */
export type PlaceCommandOutcome =
  | {
      /**
       * Domain command and projection both completed.
       */
      readonly kind: "committed";

      /**
       * Typed PlaceId value.
       */
      readonly id: string;

      /**
       * Accepted Event revision, whose projection was observed at this revision or newer.
       */
      readonly revision: number;
    }
  | {
      /**
       * A newer committed revision refused this draft.
       */
      readonly kind: "conflict";

      /**
       * Revision the author may deliberately reapply against.
       */
      readonly currentRevision: number;
    }
  | {
      /**
       * Refusal or interrupted native operation.
       */
      readonly kind:
        "unavailable" | "already-exists" | "invalid-coordinates" | "refused" | "interrupted";
    };

const addRejections = [
  PlaceUnavailableSchema,
  PlaceAlreadyExistsSchema,
  InvalidPlaceCoordinatesSchema,
];
const editRejections = [PlaceUnavailableSchema, PlaceRevisionConflictSchema];
const moveRejections = [...editRejections, InvalidPlaceCoordinatesSchema];

/**
 * Posts distinct Fieldnotes Commands after activating their selected outcome stream.
 */
export class FieldnotesPlaceCommands {
  /**
   * Binds a verified actor scope to the collection's projected-result barrier.
   *
   * @param request Native client request scoped to the current principal.
   * @param collection Current private projected states.
   */
  constructor(
    private readonly request: Pick<ClientRequest, "postAndSubscribe">,
    private readonly collection: FieldnotesPlaceCollection,
  ) {}

  /**
   * Creates a place with one initial Markdown value and a fresh typed ID.
   *
   * @param name Display name.
   * @param latitude Selected latitude.
   * @param longitude Selected longitude.
   * @param markdown Initial single note.
   * @param signal Optional UI cancellation.
   * @returns Domain and view-confirmed outcome.
   */
  add(
    name: string,
    latitude: number,
    longitude: number,
    markdown: string,
    signal?: AbortSignal,
  ): Promise<PlaceCommandOutcome> {
    const id = crypto.randomUUID();
    return this.submit(
      this.request.postAndSubscribe(
        AddPlaceSchema,
        create(AddPlaceSchema, {
          id: create(PlaceIdSchema, { value: id }),
          name,
          coordinates: create(CoordinatesSchema, { latitude, longitude }),
          markdown,
        }),
        {
          events: [PlaceAddedSchema],
          rejections: addRejections,
          ...(signal === undefined ? {} : { signal }),
        },
      ),
      id,
      false,
      signal,
    );
  }

  /**
   * Updates the name of one place at its last observed revision.
   *
   * @param id Typed PlaceId value.
   * @param name New display name.
   * @param revision Last observed revision.
   * @param signal Optional UI cancellation.
   * @returns Domain and view-confirmed outcome.
   */
  rename(
    id: string,
    name: string,
    revision: number,
    signal?: AbortSignal,
  ): Promise<PlaceCommandOutcome> {
    return this.submit(
      this.request.postAndSubscribe(
        RenamePlaceSchema,
        create(RenamePlaceSchema, {
          id: create(PlaceIdSchema, { value: id }),
          name,
          expectedRevision: revision,
        }),
        {
          events: [PlaceRenamedSchema],
          rejections: editRejections,
          ...(signal === undefined ? {} : { signal }),
        },
      ),
      id,
      false,
      signal,
    );
  }

  /**
   * Updates the coordinates of one place at its last observed revision.
   *
   * @param id Typed PlaceId value.
   * @param latitude New latitude.
   * @param longitude New longitude.
   * @param revision Last observed revision.
   * @param signal Optional UI cancellation.
   * @returns Domain and view-confirmed outcome.
   */
  move(
    id: string,
    latitude: number,
    longitude: number,
    revision: number,
    signal?: AbortSignal,
  ): Promise<PlaceCommandOutcome> {
    return this.submit(
      this.request.postAndSubscribe(
        MovePlaceSchema,
        create(MovePlaceSchema, {
          id: create(PlaceIdSchema, { value: id }),
          coordinates: create(CoordinatesSchema, { latitude, longitude }),
          expectedRevision: revision,
        }),
        {
          events: [PlaceMovedSchema],
          rejections: moveRejections,
          ...(signal === undefined ? {} : { signal }),
        },
      ),
      id,
      false,
      signal,
    );
  }

  /**
   * Replaces the single note at its last observed revision.
   *
   * @param id Typed PlaceId value.
   * @param markdown New single Markdown body.
   * @param revision Last observed revision.
   * @param signal Optional UI cancellation.
   * @returns Domain and view-confirmed outcome.
   */
  note(
    id: string,
    markdown: string,
    revision: number,
    signal?: AbortSignal,
  ): Promise<PlaceCommandOutcome> {
    return this.submit(
      this.request.postAndSubscribe(
        EditPlaceNoteSchema,
        create(EditPlaceNoteSchema, {
          id: create(PlaceIdSchema, { value: id }),
          markdown,
          expectedRevision: revision,
        }),
        {
          events: [PlaceNoteEditedSchema],
          rejections: editRejections,
          ...(signal === undefined ? {} : { signal }),
        },
      ),
      id,
      false,
      signal,
    );
  }

  /**
   * Deletes a place only after explicit caller confirmation.
   *
   * @param id Typed PlaceId value.
   * @param revision Last observed revision.
   * @param signal Optional UI cancellation.
   * @returns Domain and terminal-view-confirmed outcome.
   */
  delete(id: string, revision: number, signal?: AbortSignal): Promise<PlaceCommandOutcome> {
    return this.submit(
      this.request.postAndSubscribe(
        DeletePlaceSchema,
        create(DeletePlaceSchema, {
          id: create(PlaceIdSchema, { value: id }),
          expectedRevision: revision,
        }),
        {
          events: [PlaceDeletedSchema],
          rejections: editRejections,
          ...(signal === undefined ? {} : { signal }),
        },
      ),
      id,
      true,
      signal,
    );
  }

  /**
   * Waits for one selected domain outcome and its resulting projected view.
   *
   * @param posting Native activation and admission promise.
   * @param id Typed PlaceId expected in the successful Event.
   * @param removed Whether terminal removal is required.
   * @param signal Optional UI cancellation.
   * @returns Confirmed success, domain rejection or interrupted observation.
   */
  private async submit(
    posting: Promise<PostAndSubscribeResult>,
    id: string,
    removed: boolean,
    signal?: AbortSignal,
  ): Promise<PlaceCommandOutcome> {
    const result = await posting;
    if (result.kind === "refused") return { kind: "refused" };
    try {
      for await (const delivery of result.subscription.updates) {
        if (delivery.kind !== "update" || delivery.update.update.case !== "eventUpdates") continue;
        for (const event of delivery.update.update.value.event) {
          const refusal = this.rejection(event);
          if (refusal !== undefined) return refusal;
          const revision = this.revision(event, id);
          if (revision === undefined) continue;
          await this.collection.waitFor(id, revision, removed, signal);
          return { kind: "committed", id, revision };
        }
      }
      return { kind: "interrupted" };
    } catch {
      return { kind: "interrupted" };
    } finally {
      await result.subscription.cancel().catch(() => undefined);
    }
  }

  /**
   * Reads a selected domain rejection without exposing foreign state.
   *
   * @param event Raw selected outcome Event.
   * @returns Public refusal or undefined for a success Event.
   */
  private rejection(event: Event): PlaceCommandOutcome | undefined {
    if (AnyPacker.tryUnpack(event.message, PlaceUnavailableSchema)) return { kind: "unavailable" };
    if (AnyPacker.tryUnpack(event.message, PlaceAlreadyExistsSchema))
      return { kind: "already-exists" };
    const conflict = AnyPacker.tryUnpack(event.message, PlaceRevisionConflictSchema);
    if (conflict) return { kind: "conflict", currentRevision: conflict.currentRevision };
    if (AnyPacker.tryUnpack(event.message, InvalidPlaceCoordinatesSchema))
      return { kind: "invalid-coordinates" };
    return undefined;
  }

  /**
   * Reads the revision only from a successful Event for the posted PlaceId.
   *
   * @param event Raw selected outcome Event.
   * @param id Posted typed PlaceId value.
   * @returns Accepted revision or undefined.
   */
  private revision(event: Event, id: string): number | undefined {
    const message = event.message;
    const outcomes = [
      AnyPacker.tryUnpack(message, PlaceAddedSchema),
      AnyPacker.tryUnpack(message, PlaceRenamedSchema),
      AnyPacker.tryUnpack(message, PlaceMovedSchema),
      AnyPacker.tryUnpack(message, PlaceNoteEditedSchema),
      AnyPacker.tryUnpack(message, PlaceDeletedSchema),
    ];
    return outcomes.find((outcome) => outcome?.id?.value === id)?.revision;
  }
}
