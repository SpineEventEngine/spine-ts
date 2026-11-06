import { clone, create } from "@bufbuild/protobuf";
import { Time } from "@spine-event-engine/core";
import { UserIdSchema, type CommandContext, type UserId } from "@spine-event-engine/proto";
import {
  Aggregate,
  Assign,
  BoundedContext,
  Projection,
  Subscribe,
  Throws,
} from "@spine-event-engine/server";

import {
  type AddPlace,
  type DeletePlace,
  type EditPlaceNote,
  type MovePlace,
  type RenamePlace,
} from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/commands_pb.js";
import {
  PlaceSchema,
  PlaceViewSchema,
} from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/entities_pb.js";
import {
  PlaceAddedSchema,
  type PlaceAdded,
  PlaceDeletedSchema,
  PlaceMovedSchema,
  PlaceNoteEditedSchema,
  PlaceRenamedSchema,
  type PlaceDeleted,
  type PlaceMoved,
  type PlaceNoteEdited,
  type PlaceRenamed,
} from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/events_pb.js";
import {
  CoordinatesSchema,
  PlaceIdSchema,
  type Coordinates,
  type PlaceId,
} from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/types_pb.js";
import {
  InvalidPlaceCoordinates,
  PlaceAlreadyExists,
  PlaceRevisionConflict,
  PlaceUnavailable,
} from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/rejections.js";

/**
 * Applies accepted changes to one private place.
 */
export class PlaceAggregate extends Aggregate<PlaceId, typeof PlaceSchema> {
  // prettier-ignore

  /**
   * Records a request to create one place.
   *
   * @param command The requested place details.
   * @param context The admitted Command actor.
   * @returns The accepted creation Event.
   */
  @Assign
  @Throws(PlaceUnavailable, PlaceAlreadyExists, InvalidPlaceCoordinates)
  addPlace(command: AddPlace, context: CommandContext): PlaceAdded {
    const requester = this.admittedActor(context);
    if (this.version.number !== 0 || this.state.removed) {
      if (this.state.author?.value === requester.value)
        throw PlaceAlreadyExists.create({ requester });
      throw PlaceUnavailable.create({ requester });
    }
    const coordinates = this.requiredCoordinates(command.coordinates, requester);
    const id = clone(PlaceIdSchema, this.id);
    const occurredAt = Time.currentTime();
    const revision = this.version.number + 1;
    this.update((draft) => Object.assign(draft, create(PlaceSchema, {
      id, name: command.name, coordinates, author: requester,
      markdown: command.markdown, revision,
      createdAt: occurredAt, updatedAt: occurredAt, removed: false,
    })));
    return create(PlaceAddedSchema, {
      id, name: command.name, coordinates, author: requester,
      markdown: command.markdown, revision, occurredAt, createdAt: occurredAt,
    });
  }

  /**
   * Replaces an author's place name at the observed revision.
   *
   * @param command The new name and observed revision.
   * @param context The admitted Command actor.
   * @returns The accepted rename Event.
   */
  @Assign
  @Throws(PlaceUnavailable, PlaceRevisionConflict)
  renamePlace(command: RenamePlace, context: CommandContext): PlaceRenamed {
    const requester = this.requireAuthor(context);
    this.requireRevision(command.expectedRevision, requester);
    const occurredAt = Time.currentTime();
    const revision = this.version.number + 1;
    const next = this.update((draft) => {
      draft.name = command.name;
      draft.revision = revision;
      draft.updatedAt = occurredAt;
    });
    return create(PlaceRenamedSchema, {
      id: clone(PlaceIdSchema, this.id),
      name: next.name,
      coordinates: next.coordinates,
      markdown: next.markdown,
      author: requester,
      revision,
      occurredAt,
      createdAt: next.createdAt,
    });
  }

  /**
   * Updates an author's place location at the observed revision.
   *
   * @param command The new point and observed revision.
   * @param context The admitted Command actor.
   * @returns The accepted movement Event.
   */
  @Assign
  @Throws(PlaceUnavailable, PlaceRevisionConflict, InvalidPlaceCoordinates)
  movePlace(command: MovePlace, context: CommandContext): PlaceMoved {
    const requester = this.requireAuthor(context);
    this.requireRevision(command.expectedRevision, requester);
    const coordinates = this.requiredCoordinates(command.coordinates, requester);
    const occurredAt = Time.currentTime();
    const revision = this.version.number + 1;
    const next = this.update((draft) => {
      draft.coordinates = coordinates;
      draft.revision = revision;
      draft.updatedAt = occurredAt;
    });
    return create(PlaceMovedSchema, {
      id: clone(PlaceIdSchema, this.id),
      coordinates: next.coordinates,
      name: next.name,
      markdown: next.markdown,
      author: requester,
      revision,
      occurredAt,
      createdAt: next.createdAt,
    });
  }

  /**
   * Replaces the author's single Markdown note at the observed revision.
   *
   * @param command Replacement Markdown and observed revision.
   * @param context The admitted Command actor.
   * @returns The accepted note Event.
   */
  @Assign
  @Throws(PlaceUnavailable, PlaceRevisionConflict)
  editPlaceNote(command: EditPlaceNote, context: CommandContext): PlaceNoteEdited {
    const requester = this.requireAuthor(context);
    this.requireRevision(command.expectedRevision, requester);
    const occurredAt = Time.currentTime();
    const revision = this.version.number + 1;
    const next = this.update((draft) => {
      draft.markdown = command.markdown;
      draft.revision = revision;
      draft.updatedAt = occurredAt;
    });
    return create(PlaceNoteEditedSchema, {
      id: clone(PlaceIdSchema, this.id),
      markdown: next.markdown,
      name: next.name,
      coordinates: next.coordinates,
      author: requester,
      revision,
      occurredAt,
      createdAt: next.createdAt,
    });
  }

  /**
   * Removes an author's place while retaining its identifier and revision.
   *
   * @param command The place and observed revision.
   * @param context The admitted Command actor.
   * @returns The accepted deletion Event.
   */
  @Assign
  @Throws(PlaceUnavailable, PlaceRevisionConflict)
  deletePlace(command: DeletePlace, context: CommandContext): PlaceDeleted {
    const requester = this.requireAuthor(context);
    this.requireRevision(command.expectedRevision, requester);
    const occurredAt = Time.currentTime();
    const revision = this.version.number + 1;
    const next = this.update((draft) => {
      draft.name = "";
      draft.coordinates = undefined;
      draft.markdown = "";
      draft.revision = revision;
      draft.updatedAt = occurredAt;
      draft.removed = true;
    });
    return create(PlaceDeletedSchema, {
      id: clone(PlaceIdSchema, this.id),
      author: requester,
      revision,
      occurredAt,
      name: next.name,
      coordinates: next.coordinates,
      markdown: next.markdown,
      createdAt: next.createdAt,
    });
  }

  /**
   * Checks the author of an active place before exposing its revision.
   *
   * @param context The admitted Command actor.
   * @returns The verified author.
   */
  private requireAuthor(context: CommandContext): UserId {
    const requester = this.admittedActor(context);
    if (
      this.version.number === 0 ||
      this.state.removed ||
      this.state.author?.value !== requester.value
    )
      throw PlaceUnavailable.create({ requester });
    return requester;
  }

  /**
   * Checks the observed revision after verifying the author.
   *
   * @param expectedRevision Revision observed by the editor.
   * @param requester Verified author receiving the current revision.
   */
  private requireRevision(expectedRevision: number, requester: UserId): void {
    if (expectedRevision !== this.version.number)
      throw PlaceRevisionConflict.create({ requester, currentRevision: this.version.number });
  }

  /**
   * Copies the admitted actor from a trusted Command envelope.
   *
   * @param context Command context rebuilt by the gateway.
   * @returns The requesting user identifier.
   */
  private admittedActor(context: CommandContext): UserId {
    const actor = context.actorContext?.actor;
    if (actor === undefined) throw new Error("An admitted Command actor is required.");
    return clone(UserIdSchema, actor);
  }

  /**
   * Copies finite latitude and longitude within geographic ranges.
   *
   * @param coordinates Point supplied by the command.
   * @param requester User receiving any invalid-point refusal.
   * @returns A detached point that can be displayed on Earth.
   */
  private requiredCoordinates(
    coordinates: Coordinates | undefined,
    requester: UserId,
  ): Coordinates {
    if (
      coordinates === undefined ||
      !Number.isFinite(coordinates.latitude) ||
      !Number.isFinite(coordinates.longitude) ||
      coordinates.latitude < -90 ||
      coordinates.latitude > 90 ||
      coordinates.longitude < -180 ||
      coordinates.longitude > 180
    )
      throw InvalidPlaceCoordinates.create({ requester });
    return clone(CoordinatesSchema, coordinates);
  }
}

/**
 * Folds accepted place Events into the author-scoped read model.
 */
export class PlaceViewProjection extends Projection<PlaceId, typeof PlaceViewSchema> {
  // prettier-ignore

  /**
   * Applies a committed place creation.
   *
   * @param event The accepted creation Event.
   */
  @Subscribe
  onPlaceAdded(event: PlaceAdded): void {
    this.applyResult(event, false);
  }

  /**
   * Applies a newer accepted name to an active place.
   *
   * @param event The accepted rename Event.
   */
  @Subscribe
  onPlaceRenamed(event: PlaceRenamed): void {
    this.applyResult(event, false);
  }

  /**
   * Applies a newer accepted point to an active place.
   *
   * @param event The accepted movement Event.
   */
  @Subscribe
  onPlaceMoved(event: PlaceMoved): void {
    this.applyResult(event, false);
  }

  /**
   * Applies a newer accepted Markdown value to an active place.
   *
   * @param event The accepted note Event.
   */
  @Subscribe
  onPlaceNoteEdited(event: PlaceNoteEdited): void {
    this.applyResult(event, false);
  }

  /**
   * Clears current display data and retains a newer deletion tombstone.
   *
   * @param event The accepted deletion Event.
   */
  @Subscribe
  onPlaceDeleted(event: PlaceDeleted): void {
    this.applyResult(event, true);
  }

  /**
   * Replaces the whole read model from a newer complete domain result.
   *
   * @param event Complete state after one accepted change.
   * @param removed Whether this result is the terminal deletion.
   */
  private applyResult(
    event: PlaceAdded | PlaceRenamed | PlaceMoved | PlaceNoteEdited | PlaceDeleted,
    removed: boolean,
  ): void {
    if (this.state.removed || event.revision <= this.state.revision) return;
    this.update((draft) =>
      Object.assign(
        draft,
        create(PlaceViewSchema, {
          id: clone(PlaceIdSchema, this.id),
          name: event.name,
          coordinates: event.coordinates,
          author: event.author,
          markdown: event.markdown,
          revision: event.revision,
          createdAt: event.createdAt,
          updatedAt: event.occurredAt,
          removed,
        }),
      ),
    );
  }
}

/**
 * Builds the single-tenant Fieldnotes domain for isolated tests and host assembly.
 *
 * @returns The assembled context with one Aggregate and one Projection.
 */
export async function createFieldnotesContext(): Promise<BoundedContext> {
  return BoundedContext.singleTenant("Fieldnotes")
    .add(PlaceAggregate)
    .add(PlaceViewProjection)
    .build();
}
