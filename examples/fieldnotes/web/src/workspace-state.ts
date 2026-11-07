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

import type { PlaceView } from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/entities_pb.js";
import type { FieldnotesPlaceCommands, PlaceCommandOutcome } from "./place-commands";

/**
 * Five app-local domain operations used by the place editor.
 */
export type PlaceCommandsPort = Pick<
  FieldnotesPlaceCommands,
  "add" | "rename" | "move" | "note" | "delete"
>;

/**
 * Connection capabilities needed by the view-state controller.
 */
export interface PlaceConnection {
  /**
   * Starts the author-only stream and first complete scan.
   *
   * @returns Completion after initial scan.
   */
  start(): Promise<void>;

  /**
   * Closes active browser client work.
   *
   * @returns Completion after close.
   */
  close(): Promise<void>;

  /**
   * Returns currently visible private places.
   *
   * @returns Current collection snapshot.
   */
  places(): readonly PlaceView[];

  /**
   * Returns domain operations for the verified principal.
   *
   * @returns Scoped command adapter.
   */
  commands(): PlaceCommandsPort;
}

/**
 * Separate user input that remains through failed saves and remote changes.
 */
export interface PlaceDraft {
  /**
   * Draft display name.
   */
  readonly name: string;

  /**
   * Draft latitude, or empty while the user edits the number input.
   */
  readonly latitude: number | "";

  /**
   * Draft longitude, or empty while the user edits the number input.
   */
  readonly longitude: number | "";

  /**
   * Draft single Markdown body.
   */
  readonly markdown: string;
}

/**
 * One visible editing operation, never an ambiguous combined save.
 */
export type WorkspaceMode = "view" | "add" | "rename" | "move" | "note" | "delete";

/**
 * Immutable visible workspace state for one verified principal.
 */
export interface WorkspaceView {
  /**
   * Complete active collection known to this browser.
   */
  readonly places: readonly PlaceView[];

  /**
   * Selected committed place or null.
   */
  readonly selected: PlaceView | null;

  /**
   * Current single Command edit mode.
   */
  readonly mode: WorkspaceMode;

  /**
   * Dirty form values separate from committed state.
   */
  readonly draft: PlaceDraft;

  /**
   * Current saved-place search.
   */
  readonly search: string;

  /**
   * Whether one Command still awaits its projected result.
   */
  readonly saving: boolean;

  /**
   * Human-facing action result or error.
   */
  readonly feedback: string | null;
}

/**
 * Keeps private collection, selection and Command drafts independent.
 */
export class FieldnotesWorkspaceState {
  #selectedId: string | null = null;

  #editBaseRevision: number | null = null;

  #closed = false;

  #state: WorkspaceView = {
    places: [],
    selected: null,
    mode: "view",
    draft: { name: "", latitude: 38.7, longitude: -9.1, markdown: "" },
    search: "",
    saving: false,
    feedback: null,
  };

  /**
   * Binds one native connection to a current visible-state callback.
   *
   * @param connection Verified principal's private native client.
   * @param onView React state update callback.
   */
  constructor(
    private readonly connection: PlaceConnection,
    private readonly onView: (state: WorkspaceView) => void,
  ) {}

  /**
   * Starts the native stream and publishes its complete initial collection.
   *
   * @returns Completion after first full scan.
   */
  async start(): Promise<void> {
    await this.connection.start();
    this.refresh();
  }

  /**
   * Reads the current immutable browser presentation.
   *
   * @returns Current visible state.
   */
  view(): WorkspaceView {
    return this.#state;
  }

  /**
   * Publishes fresh native states without discarding an edit draft.
   */
  refresh(): void {
    if (this.#closed) return;
    const places = this.connection.places();
    const selected = places.find((place) => place.id?.value === this.#selectedId) ?? null;
    this.emit({ ...this.#state, places, selected });
  }

  /**
   * Sets a saved place while no draft is being edited.
   *
   * @param id Typed PlaceId value.
   */
  select(id: string): void {
    if (this.#state.mode !== "view") return;
    this.#selectedId = id;
    this.refresh();
  }

  /**
   * Starts a new place at the current presentation center.
   *
   * @param latitude Initial map latitude.
   * @param longitude Initial map longitude.
   */
  add(latitude = 38.7, longitude = -9.1): void {
    this.#selectedId = null;
    this.#editBaseRevision = null;
    this.emit({
      ...this.#state,
      selected: null,
      mode: "add",
      feedback: null,
      draft: { name: "", latitude, longitude, markdown: "" },
    });
  }

  /**
   * Starts exactly one edit using the last committed selected state.
   *
   * @param mode Rename, move, note or delete action.
   */
  edit(mode: Exclude<WorkspaceMode, "view" | "add">): void {
    const place = this.#state.selected;
    if (place === null || this.#state.saving) return;
    this.#editBaseRevision = place.revision;
    this.emit({
      ...this.#state,
      mode,
      feedback: null,
      draft: {
        name: place.name,
        markdown: place.markdown,
        latitude: place.coordinates?.latitude ?? 0,
        longitude: place.coordinates?.longitude ?? 0,
      },
    });
  }

  /**
   * Updates only the dirty form fields, retaining committed details separately.
   *
   * @param values Changed fields from an accessible form control.
   */
  changeDraft(values: Partial<PlaceDraft>): void {
    if (this.#state.saving) return;
    this.emit({ ...this.#state, draft: { ...this.#state.draft, ...values } });
  }

  /**
   * Sets the complete local collection filter by name and single Markdown body.
   *
   * @param value Saved-place search text.
   */
  search(value: string): void {
    this.emit({ ...this.#state, search: value });
  }

  /**
   * Clears only the current draft and keeps committed selection intact.
   */
  cancel(): void {
    if (this.#state.saving) return;
    this.#editBaseRevision = null;
    this.emit({ ...this.#state, mode: "view", feedback: null });
  }

  /**
   * Applies the preserved draft explicitly against the newest committed revision.
   */
  reapply(): void {
    if (this.#state.saving || this.#state.mode === "view" || this.#state.mode === "add") return;
    const revision = this.#state.selected?.revision;
    if (revision === undefined) return;
    this.#editBaseRevision = revision;
    this.emit({ ...this.#state, feedback: "Draft will use the current saved version." });
  }

  /**
   * Executes one Command while preserving drafts on every failure path.
   *
   * @returns Completion after domain and view result or error.
   */
  async save(): Promise<void> {
    if (this.#closed || this.#state.saving || this.#state.mode === "view") return;
    if (
      (this.#state.mode === "add" || this.#state.mode === "move") &&
      this.coordinates() === null
    ) {
      this.emit({ ...this.#state, feedback: "Choose valid latitude and longitude." });
      return;
    }
    this.emit({ ...this.#state, saving: true, feedback: "Waiting for confirmation…" });
    try {
      const result = await this.command();
      if (!this.active()) return;
      if (result.kind === "committed") {
        this.#editBaseRevision = null;
        this.#selectedId = this.#state.mode === "delete" ? null : result.id;
        this.emit({ ...this.#state, mode: "view", saving: false, feedback: "Saved." });
        this.refresh();
      } else this.emit({ ...this.#state, saving: false, feedback: this.message(result) });
    } catch {
      if (this.active())
        this.emit({
          ...this.#state,
          saving: false,
          feedback: "Confirmation was interrupted. Check the place before retrying.",
        });
    }
  }

  /**
   * Stops native client work and removes private presentation immediately.
   *
   * @returns Completion after connection cancellation.
   */
  async close(): Promise<void> {
    this.#closed = true;
    this.#selectedId = null;
    this.#editBaseRevision = null;
    this.emit({ ...this.#state, places: [], selected: null, mode: "view" });
    await this.connection.close();
  }

  /**
   * Posts the single Command named by the current edit mode.
   *
   * @returns Domain and projected-view-confirmed outcome.
   */
  private command(): Promise<PlaceCommandOutcome> {
    const { mode, draft, selected } = this.#state;
    const commands = this.connection.commands();
    if (mode === "add") {
      const point = this.coordinates();
      if (point === null) throw new Error("Incomplete AddPlace coordinates.");
      return commands.add(draft.name, point.latitude, point.longitude, draft.markdown);
    }
    if (selected?.id?.value === undefined) throw new Error("No selected PlaceId.");
    if (this.#editBaseRevision === null) throw new Error("No captured edit revision.");
    const id = selected.id.value;
    const revision = this.#editBaseRevision;
    if (mode === "rename") return commands.rename(id, draft.name, revision);
    if (mode === "move") {
      const point = this.coordinates();
      if (point === null) throw new Error("Incomplete MovePlace coordinates.");
      return commands.move(id, point.latitude, point.longitude, revision);
    }
    if (mode === "note") return commands.note(id, draft.markdown, revision);
    if (mode === "delete") return commands.delete(id, revision);
    throw new Error("No pending place command.");
  }

  /**
   * Accepts complete finite geographic coordinates, including deliberate zero.
   *
   * @returns Numeric point or null while either input is incomplete or invalid.
   */
  private coordinates(): { latitude: number; longitude: number } | null {
    const { latitude, longitude } = this.#state.draft;
    if (
      typeof latitude !== "number" ||
      typeof longitude !== "number" ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    )
      return null;
    return { latitude, longitude };
  }

  /**
   * Maps selected domain refusals to clear draft-preserving feedback.
   *
   * @param outcome Domain rejection or interrupted observation.
   * @returns Human-facing result text.
   */
  private message(outcome: Exclude<PlaceCommandOutcome, { kind: "committed" }>): string {
    if (outcome.kind === "conflict")
      return "Place changed since last edit. Review the saved version and reapply your draft.";
    if (outcome.kind === "unavailable") return "This place is unavailable.";
    if (outcome.kind === "already-exists") return "This place already exists.";
    if (outcome.kind === "invalid-coordinates") return "Choose valid latitude and longitude.";
    if (outcome.kind === "refused") return "The place change was refused. Review the fields.";
    return "Confirmation was interrupted. Check the place before retrying.";
  }

  /**
   * Updates one immutable state only while the principal is active.
   *
   * @param next New visible state.
   */
  private emit(next: WorkspaceView): void {
    this.#state = next;
    this.onView(next);
  }

  /**
   * Checks the mutable principal lifecycle after asynchronous Command work.
   *
   * @returns Whether private state may still be rendered.
   */
  private active(): boolean {
    return !this.#closed;
  }
}
