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
import { useEntityQuery, useEntitySubscription } from "@spine-event-engine/client-react";
import type { ClientRequest, SubscriptionDelivery } from "@spine-event-engine/client-web";
import { AnyPacker } from "@spine-event-engine/core";
import { AnnouncementBoardViewQuery } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_query.js";
import {
  AnnouncementBoardViewSchema,
  BoardIdSchema,
  type AnnouncementBoardView,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import {
  TopicIdSchema,
  TopicSchema,
  type QueryResponse,
  type SubscriptionUpdate,
} from "@spine-event-engine/proto/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Applies only a matching announcement BoardId state or removal.
 */
export const AnnouncementPayloads: Readonly<{
  /**
   * Applies a matching announcement update or requests an authoritative recovery.
   */
  reconcile(
    previous: AnnouncementBoardView | undefined,
    update: SubscriptionUpdate,
  ): AnnouncementBoardView | undefined | "recover";
}> = Object.freeze({
  /**
   * Resolves an update only when every changed Entity targets announcements.
   */
  reconcile(previous, update) {
    if (update.update.case !== "entityUpdates" || update.update.value.update.length === 0)
      return "recover";
    let next = previous;
    for (const change of update.update.value.update) {
      if (
        change.id === undefined ||
        AnyPacker.tryUnpack(change.id, BoardIdSchema)?.value !== "announcements"
      )
        return "recover";
      if (change.kind.case === "noLongerMatching") next = undefined;
      else if (change.kind.case === "state") {
        const row = AnyPacker.tryUnpack(change.kind.value, AnnouncementBoardViewSchema);
        if (row?.id?.value !== "announcements") return "recover";
        next = row;
      } else return "recover";
    }
    return next;
  },
});

/**
 * Extracts the announcement board row from an authoritative Entity response.
 */
const row = (response: QueryResponse): AnnouncementBoardView | undefined => {
  return response.message.flatMap((item) => {
    const value =
      item.state === undefined
        ? undefined
        : AnyPacker.tryUnpack(item.state, AnnouncementBoardViewSchema);
    return value?.id?.value === "announcements" ? [value] : [];
  })[0];
};

/**
 * Returns the separate announcement Projection collection through its own Topic.
 *
 * @param request Sends authoritative announcement queries.
 * @param onChanged Refreshes dependent statistics after an update.
 * @returns The latest announcement and read error state.
 */
export const useAnnouncementSync = (
  request: ClientRequest,
  onChanged: () => void,
): {
  readonly value: AnnouncementBoardView | undefined;
  readonly error: boolean;
} => {
  const { query, topic, initial } = useAnnouncementSource();
  const state = useAnnouncementState(request, onChanged);
  const recover = useAnnouncementRecovery(request, query, state);
  const onDelivery = useCallback(
    (delivery: SubscriptionDelivery) => {
      if (delivery.kind === "resynchronization") {
        state.apply(row(delivery.response));
        return;
      }
      const next = AnnouncementPayloads.reconcile(state.value.current, delivery.update);
      if (next === "recover") recover();
      else state.apply(next);
    },
    [recover, state.apply, state.value],
  );
  useEntitySubscription(topic, () => query, [query], onDelivery);
  return {
    value: state.hasApplied
      ? state.applied
      : initial.status === "success"
        ? row(initial.value)
        : undefined,
    error: state.error || initial.status === "error",
  };
};

/**
 * Creates the announcement Entity query and matching live Topic.
 */
const useAnnouncementSource = () => {
  const query = useMemo(
    () =>
      AnnouncementBoardViewQuery.create()
        .byId(create(BoardIdSchema, { value: "announcements" }))
        .build()
        .build(),
    [],
  );
  const topic = useMemo(
    () =>
      create(TopicSchema, {
        id: create(TopicIdSchema, { value: "board-announcements" }),
        target: query.target,
      }),
    [query],
  );
  const initial = useEntityQuery(() => query, [query]);
  return { query, topic, initial };
};

/**
 * Tracks the last applied announcement with cancellation and generation guards.
 */
const useAnnouncementState = (request: ClientRequest, onChanged: () => void) => {
  const [applied, setApplied] = useState<{ value: AnnouncementBoardView | undefined }>();
  const [error, setError] = useState(false);
  const value = useRef<AnnouncementBoardView | undefined>(undefined);
  const generation = useRef(0);
  const updateGeneration = useRef(0);
  const controller = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    setApplied(undefined);
    setError(false);
    return () => {
      mounted.current = false;
      generation.current += 1;
      controller.current?.abort();
    };
  }, [request]);
  const apply = useCallback(
    (next: AnnouncementBoardView | undefined) => {
      updateGeneration.current += 1;
      generation.current += 1;
      controller.current?.abort();
      value.current = next;
      setApplied({ value: next });
      setError(false);
      onChanged();
    },
    [onChanged],
  );
  // prettier-ignore
  return { applied: applied?.value, hasApplied: applied !== undefined, error, setError, value, generation,
    updateGeneration, controller, mounted, apply };
};

/**
 * State maintained while applying live announcement updates and recovery reads.
 */
type AnnouncementState = ReturnType<typeof useAnnouncementState>;

const AnnouncementRecoveries = Object.freeze({
  /**
   * Applies only a current authoritative response and reports read failure.
   *
   * @param request Sends the authoritative Entity Query.
   * @param query Selects announcements.
   * @param state Tracks generation and cancellation.
   * @param current Identifies this recovery attempt.
   * @param update Identifies the last applied update.
   * @param controller Cancels this recovery attempt.
   * @returns Completion of the read.
   */
  async run(
    request: ClientRequest,
    query: ReturnType<typeof useAnnouncementSource>["query"],
    state: AnnouncementState,
    current: number,
    update: number,
    controller: AbortController,
  ): Promise<void> {
    try {
      const response = await request.send(query, { signal: controller.signal });
      if (
        !state.mounted.current ||
        current !== state.generation.current ||
        update !== state.updateGeneration.current
      )
        return;
      state.apply(row(response));
    } catch (reason) {
      if (
        !state.mounted.current ||
        current !== state.generation.current ||
        controller.signal.aborted
      )
        return;
      console.warn("Announcement recovery failed.", reason);
      state.setError(true);
    } finally {
      if (state.controller.current === controller) state.controller.current = undefined;
    }
  },
});

/**
 * Starts an authoritative announcement read after an ambiguous live update.
 */
const useAnnouncementRecovery = (
  request: ClientRequest,
  query: ReturnType<typeof useAnnouncementSource>["query"],
  state: AnnouncementState,
) =>
  useCallback(() => {
    const current = ++state.generation.current;
    const update = state.updateGeneration.current;
    state.controller.current?.abort();
    const controller = new AbortController();
    state.controller.current = controller;
    void AnnouncementRecoveries.run(request, query, state, current, update, controller);
  }, [
    query,
    request,
    state.apply,
    state.controller,
    state.generation,
    state.mounted,
    state.setError,
    state.updateGeneration,
  ]);
