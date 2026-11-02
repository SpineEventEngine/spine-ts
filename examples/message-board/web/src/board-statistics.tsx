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
import "@spine-event-engine/example-message-board-model";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { ClientRequest, Subscription } from "@spine-event-engine/client-web";
import { ReadBoardStats } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/board_queries_app_query.js";
import { BoardStatisticsViewQuery } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_query.js";
import {
  BoardIdSchema,
  type BoardId,
  type BoardStatistics,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import {
  TopicIdSchema,
  TopicSchema,
  type Query,
  type Topic,
} from "@spine-event-engine/proto/client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";

interface StatsReadState {
  generation: number;
  dirty: boolean;
  running: boolean;
  controller: AbortController | undefined;
}

interface StatsReadResult {
  readonly value: ReadBoardStats.Response | undefined;
  readonly status: "loading" | "ready" | "error";
  readonly refresh: () => void;
}

interface StatsResult extends StatsReadResult {
  readonly liveStatus: "connecting" | "connected" | "error";
}

const StatsQueries = Object.freeze({
  /**
   * Executes coalesced authoritative reads without applying stale responses.
   *
   * @param request Sends typed App Queries.
   * @param boardId Selects the board.
   * @param state Tracks the current read generation.
   * @param onValue Applies a current response.
   * @param onStatus Reports read completion or failure.
   * @returns Completion of the read loop.
   */
  async run(
    request: ClientRequest,
    boardId: BoardId,
    state: StatsReadState,
    onValue: (value: ReadBoardStats.Response | undefined) => void,
    onStatus: (value: "ready" | "error") => void,
  ): Promise<void> {
    const generation = state.generation;
    const controller = new AbortController();
    state.controller = controller;
    try {
      do {
        state.dirty = false;
        try {
          const response = await request.query(
            create(ReadBoardStats.querySchema, { board: boardId }),
            { signal: controller.signal },
          );
          if (generation !== state.generation) return;
          onValue(response.message[0]);
          onStatus("ready");
        } catch (error) {
          if (generation !== state.generation || controller.signal.aborted) return;
          console.warn("Board statistics read failed.", error);
          onStatus("error");
        }
      } while (state.dirty);
    } finally {
      if (generation === state.generation) {
        state.running = false;
        state.controller = undefined;
      }
    }
  },
});

const useStatsRead = (boardId: BoardId, request: ClientRequest): StatsReadResult => {
  const [value, setValue] = useState<ReadBoardStats.Response>();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const state = useRef<StatsReadState>({
    generation: 0,
    dirty: false,
    running: false,
    controller: undefined,
  });
  const refresh = useCallback(() => {
    state.current.dirty = true;
    if (state.current.running) return;
    state.current.running = true;
    void StatsQueries.run(request, boardId, state.current, setValue, setStatus);
  }, [boardId, request]);
  useEffect(() => {
    refresh();
    return () => {
      state.current.generation += 1;
      state.current.controller?.abort();
      state.current.running = false;
      state.current.dirty = false;
    };
  }, [refresh]);
  return { value, status, refresh };
};

interface StatsTopicState {
  active: boolean;
  subscription?: Subscription;
}

const StatsTopics = Object.freeze({
  /**
   * Activates the view Topic and refreshes after every projection update.
   *
   * @param request Creates the Entity Topic.
   * @param topic Targets the statistics Projection.
   * @param viewQuery Supplies authoritative reconnect state.
   * @param state Tracks cancellation and the active subscription.
   * @param onStatus Reports connection state.
   * @param onChanged Refreshes the typed App Query.
   * @returns Completion of the Topic observation.
   */
  async observe(
    request: ClientRequest,
    topic: Topic,
    viewQuery: Query,
    state: StatsTopicState,
    onStatus: (value: "connected" | "error") => void,
    onChanged: () => void,
  ): Promise<void> {
    try {
      const created = await request.createSubscription(topic, {
        kind: "entity",
        authoritativeQuery: () => viewQuery,
      });
      state.subscription = created;
      if (!state.active) return;
      await created.activate();
      if (!state.active) return;
      onStatus("connected");
      onChanged();
      for await (const delivery of created.updates) {
        if (!state.active) return;
        if (delivery.kind === "update" || delivery.kind === "resynchronization") onChanged();
      }
      if (state.active) onStatus("error");
    } catch (error) {
      if (state.active) {
        console.warn("Board statistics live updates failed.", error);
        onStatus("error");
      }
    } finally {
      await state.subscription?.cancel().catch(() => undefined);
    }
  },
});

const useStatsTopic = (
  request: ClientRequest,
  topic: Topic,
  viewQuery: Query,
  onChanged: () => void,
): "connecting" | "connected" | "error" => {
  const [liveStatus, setLiveStatus] = useState<"connecting" | "connected" | "error">("connecting");
  useEffect(() => {
    const state: StatsTopicState = { active: true };
    setLiveStatus("connecting");
    void StatsTopics.observe(request, topic, viewQuery, state, setLiveStatus, onChanged);
    return () => {
      state.active = false;
      void state.subscription?.cancel().catch(() => undefined);
    };
  }, [request, topic, viewQuery, onChanged]);
  return liveStatus;
};

/**
 * Returns typed lifetime statistics and observes their supplying Projection.
 *
 * @param board Selects the board to summarize.
 * @param request Sends the typed App Query and Topic.
 * @returns The statistics value, status, refresh, and Topic lifecycle controls.
 */
export const useBoardStatistics = (board: string, request: ClientRequest): StatsResult => {
  const boardId = useMemo(() => create(BoardIdSchema, { value: board }), [board]);
  const viewQuery = useMemo(
    () => BoardStatisticsViewQuery.create().byId(boardId).build().build(),
    [boardId],
  );
  const topic = useMemo(
    () =>
      create(TopicSchema, {
        id: create(TopicIdSchema, { value: `board-statistics-${board}` }),
        target: viewQuery.target,
      }),
    [board, viewQuery],
  );
  const { value, status, refresh } = useStatsRead(boardId, request);
  const liveStatus = useStatsTopic(request, topic, viewQuery, refresh);
  return { value, status, liveStatus, refresh };
};

/**
 * Renders separate lifetime summaries; absence never becomes a fabricated zero.
 *
 * @param props Supplies query values and statuses.
 * @returns The statistics panel.
 */
export const BoardStatisticsPanel = (props: {
  readonly value: ReadBoardStats.Response | undefined;
  readonly status: "loading" | "ready" | "error";
  readonly liveStatus: "connecting" | "connected" | "error";
}): ReactElement => {
  if (props.status === "loading")
    return <section aria-label="Board statistics">Loading statistics…</section>;
  if (props.status === "error")
    return (
      <section aria-label="Board statistics" role="alert">
        Statistics are unavailable.
      </section>
    );
  return (
    <section aria-label="Board statistics">
      <h2>Lifetime board activity</h2>
      {props.liveStatus === "error" ? (
        <p role="alert">Live statistics updates are unavailable. Reload to reconnect.</p>
      ) : null}
      <Summary title="Selected board" value={props.value?.board} />
      <Summary title="Announcements" value={props.value?.announcements} />
    </section>
  );
};

const Summary = (props: {
  readonly title: string;
  readonly value: BoardStatistics | undefined;
}): ReactElement => {
  const value = props.value;
  return (
    <div>
      <h3>{props.title}</h3>
      {value === undefined ? (
        <p>No visible activity yet</p>
      ) : (
        <p>
          {value.messageCount.toString()} messages · {value.authorCount.toString()} distinct authors
          {value.firstPostedAt === undefined
            ? ""
            : ` · First post ${timestampDate(value.firstPostedAt).toLocaleString()}`}
        </p>
      )}
    </div>
  );
};
