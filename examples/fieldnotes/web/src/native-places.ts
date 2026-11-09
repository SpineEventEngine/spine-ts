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
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { Client, type ClientRequest, type Subscription } from "@spine-event-engine/client-web";
import { AnyPacker, QUERY_SERVICE_MAX_RESULTS } from "@spine-event-engine/core";
import {
  PlaceViewSchema,
  type PlaceView,
} from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/entities_pb.js";
import { PlaceViewQuery } from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/entities_query.js";
import { PlaceIdSchema } from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/types_pb.js";
import { UserIdSchema } from "@spine-event-engine/proto";
import {
  TopicIdSchema,
  TopicSchema,
  type EntityStateUpdate,
} from "@spine-event-engine/proto/client";
import { FieldnotesPlaceCollection } from "./place-collection";
import { FieldnotesPlaceCommands } from "./place-commands";

/**
 * Connects the browser's fixed principal to native author-only paging and updates.
 */
export class FieldnotesNativePlaces {
  readonly #client: Client;

  readonly #request: ClientRequest;

  readonly #collection: FieldnotesPlaceCollection;

  readonly #commands: FieldnotesPlaceCommands;

  #subscription: Subscription | undefined;

  #closed = false;

  #failed = false;

  /**
   * Creates one same-origin Connect client after app-session verification.
   *
   * @param principalId Verified application principal ID.
   * @param onChange Receives changed visible PlaceView states.
   * @param onError Receives a generic connection failure notice.
   */
  constructor(
    private readonly principalId: string,
    private readonly onChange: (places: readonly PlaceView[]) => void,
    private readonly onError: () => void,
  ) {
    this.#client = Client.forConnect(`${window.location.origin}/spine`, {
      credentials: "same-origin",
      onRequestMetadata: () => this.csrf(),
    });
    this.#request = this.#client.onBehalfOf(principalId);
    this.#collection = new FieldnotesPlaceCollection(
      principalId,
      (cursor, signal) => this.page(cursor, signal),
      () => {
        this.onChange(this.#collection.places());
      },
    );
    this.#commands = new FieldnotesPlaceCommands(this.#request, this.#collection);
  }

  /**
   * Activates the author-only stream before the full active-page scan.
   *
   * @returns Completion after initial collection traversal.
   */
  async start(): Promise<void> {
    const query = PlaceViewQuery.create()
      .author()
      .is(
        create(UserIdSchema, {
          value: this.principalId,
        }),
      )
      .build();
    const target = query.build().target;
    if (target === undefined) throw new Error("Author-only topic target is missing.");
    const subscription = await this.#request.createSubscription(
      create(TopicSchema, {
        id: create(TopicIdSchema, { value: `t-${crypto.randomUUID()}` }),
        target,
      }),
      { kind: "entity", authoritativeQuery: () => query },
    );
    this.#subscription = subscription;
    void this.updates(subscription);
    void this.lifecycle(subscription);
    await subscription.activate();
    await this.#collection.scan();
  }

  /**
   * Returns current active places without exposing tombstone internals.
   *
   * @returns Latest visible PlaceView states.
   */
  places(): readonly PlaceView[] {
    return this.#collection.places();
  }

  /**
   * Returns the five domain Command operations for this verified actor.
   *
   * @returns One attempt coordinator sharing the current view barrier.
   */
  commands(): FieldnotesPlaceCommands {
    return this.#commands;
  }

  /**
   * Cancels private streams and clears collection state on logout or expiry.
   *
   * @returns Completion after remote cancellation and client close.
   */
  async close(): Promise<void> {
    this.#closed = true;
    this.#collection.close();
    try {
      await this.#subscription?.cancel();
    } finally {
      await this.#client.close();
    }
  }

  /**
   * Sends one canonical active page with the existing public capacity.
   *
   * @param cursor Detached creation-time continuation value.
   * @param signal Current scan cancellation.
   * @returns Decoded native PlaceView page.
   */
  private async page(cursor: Timestamp | undefined, signal: AbortSignal): Promise<PlaceView[]> {
    const author = create(UserIdSchema, { value: this.principalId });
    let query = PlaceViewQuery.create().author().is(author).removed().is(false);
    if (cursor !== undefined) query = query.whenCreated().isLessThan(cursor);
    const response = await this.#request.send(
      query.orderBy("whenCreated", "desc").limit(QUERY_SERVICE_MAX_RESULTS).build(),
      { signal },
    );
    return response.message.map((entry) => {
      const state = AnyPacker.tryUnpack(entry.state, PlaceViewSchema);
      if (state === undefined) throw new Error("Place page returned a non-PlaceView state.");
      return state;
    });
  }

  /**
   * Applies live states and ID-only terminal removals from the canonical topic.
   *
   * @param subscription Active author-only entity stream.
   * @returns Completion when the stream closes.
   */
  private async updates(subscription: Subscription): Promise<void> {
    try {
      for await (const delivery of subscription.updates) {
        if (this.#closed) return;
        if (delivery.kind === "resynchronization") {
          void this.rescan();
          continue;
        }
        if (delivery.update.update.case !== "entityUpdates") continue;
        for (const update of delivery.update.update.value.update) this.apply(update);
      }
      if (!this.#closed) this.failure();
    } catch {
      if (!this.#closed) this.failure();
    }
  }

  /**
   * Starts a complete rescan when the client reports a possible update gap.
   *
   * @param subscription Active stream with lifecycle notices.
   * @returns Completion when lifecycle notices end.
   */
  private async lifecycle(subscription: Subscription): Promise<void> {
    try {
      for await (const notice of subscription.lifecycle) {
        if (this.#closed) return;
        if (notice.state === "gapPossible") void this.rescan();
        if (notice.state === "failed") this.failure();
      }
    } catch {
      if (!this.#closed) this.failure();
    }
  }

  /**
   * Starts again from the first page instead of treating recovery fragments as a snapshot.
   *
   * @returns Completion after a full replacement or generic error notice.
   */
  private async rescan(): Promise<void> {
    try {
      await this.#collection.scan();
    } catch {
      if (!this.#closed) this.failure();
    }
  }

  /**
   * Decodes one generated entity update for this principal's collection.
   *
   * @param update Native entity state or no-longer-matching control.
   */
  private apply(update: EntityStateUpdate): void {
    const id = AnyPacker.tryUnpack(update.id, PlaceIdSchema)?.value;
    if (!id) throw new Error("Entity update has no typed PlaceId.");
    if (update.kind.case === "noLongerMatching") this.#collection.remove(id);
    else if (update.kind.case === "state") {
      const view = AnyPacker.tryUnpack(update.kind.value, PlaceViewSchema);
      if (view === undefined) throw new Error("Entity update has no PlaceView state.");
      if (view.id?.value !== id) throw new Error("Entity update typed ID differs from its state.");
      this.#collection.receive(view);
    }
  }

  /**
   * Reads only the host's credential-bound CSRF cookie for native POSTs.
   *
   * @returns Fresh per-request header values.
   */
  private csrf(): HeadersInit {
    const matches = document.cookie
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.startsWith("__Host-spine-csrf="));
    if (matches.length !== 1) return {};
    return { "x-spine-csrf": matches[0]?.slice("__Host-spine-csrf=".length) ?? "" };
  }

  /**
   * Rejects pending view barriers and hides private data after stream failure.
   */
  private failure(): void {
    if (this.#closed || this.#failed) return;
    this.#failed = true;
    this.#collection.fail(new Error("Place connection interrupted."));
    this.onError();
  }
}
