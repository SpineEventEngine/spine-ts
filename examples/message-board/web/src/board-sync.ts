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

import {
  useEntityQuery,
  useEntitySubscription,
  useSubscriptionLifecycle,
} from "@spine-event-engine/client-react";
import type {
  ClientRequest,
  SubscriptionDelivery,
  SubscriptionLifecycle,
} from "@spine-event-engine/client-web";
import type { BoardMessageView } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import type { QueryResponse } from "@spine-event-engine/proto/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BoardView } from "./board-view.js";
import { BoardPayloads } from "./board-payloads.js";

/**
 * Describes authoritative board state and its refresh operation.
 */
export interface BoardSyncResult {
  // prettier-ignore

  /**
   * Contains rows ordered from oldest to newest.
   */
  readonly rows: readonly BoardMessageView[];

  /**
   * Describes the current subscription lifecycle.
   */
  readonly lifecycle: SubscriptionLifecycle | undefined;

  /**
   * Schedules an authoritative board query.
   */
  readonly refresh: () => void;

  /**
   * Schedules a refresh after a successful post when live updates are not connected.
   */
  readonly onPosted: () => void;
}

/**
 * Returns one board's authoritative state and live update status.
 *
 * @param board Identifies the board to synchronize.
 * @param request Sends authoritative queries and subscription operations.
 * @returns The ordered rows, lifecycle, and refresh operation.
 */
export const useBoardSync = (board: string, request: ClientRequest): BoardSyncResult => {
  const view = useMemo(() => new BoardView(board), [board]);
  const [applied, setApplied] = useState<readonly BoardMessageView[]>();
  const [recovered, setRecovered] = useState<QueryResponse>();
  const [refreshed, setRefreshed] = useState<QueryResponse>();
  const refreshInFlight = useRef(false);
  const refreshRequest = useRef(0);
  const refreshController = useRef<AbortController | undefined>(undefined);
  const refreshGeneration = useRef(0);
  const updateGeneration = useRef(0);
  const activeBoard = useRef(board);
  const rows = useRef<readonly BoardMessageView[]>([]);
  const lifecycleRef = useRef<SubscriptionLifecycle | undefined>(undefined);
  activeBoard.current = board;
  const query = useEntityQuery(() => view.query(), [view]);
  const response = recovered ?? refreshed ?? (query.status === "success" ? query.value : undefined);
  const displayedRows = applied ?? (response === undefined ? [] : view.rows(response));
  rows.current = displayedRows;

  useEffect(() => {
    console.info("MessageBoard is activating live updates.", {
      board,
      target: view.topic().target,
    });
    return () => {
      console.info("MessageBoard is cancelling live updates.", {
        board,
        target: view.topic().target,
      });
    };
  }, [board, view]);

  const refresh = useCallback(() => {
    refreshRequest.current += 1;
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    const controller = new AbortController();
    const generation = refreshGeneration.current;
    const capturedBoard = board;
    refreshController.current = controller;
    void (async () => {
      try {
        let completedRequest: number;
        do {
          completedRequest = refreshRequest.current;
          const capturedUpdate = updateGeneration.current;
          let response: QueryResponse | undefined;
          try {
            response = await request.send(view.query(), { signal: controller.signal });
          } catch {
            if (controller.signal.aborted) return;
          }
          if (generation !== refreshGeneration.current || capturedBoard !== activeBoard.current)
            return;
          if (response !== undefined && capturedUpdate === updateGeneration.current) {
            rows.current = view.rows(response);
            setRefreshed(response);
            setRecovered(undefined);
            setApplied(undefined);
          }
        } while (completedRequest !== refreshRequest.current);
      } finally {
        if (generation === refreshGeneration.current) {
          refreshInFlight.current = false;
          refreshController.current = undefined;
        }
      }
    })();
  }, [request, view]);

  const onDelivery = useCallback(
    (delivery: SubscriptionDelivery) => {
      if (delivery.kind === "resynchronization") {
        updateGeneration.current += 1;
        const recoveredRows = view.rows(delivery.response);
        rows.current = recoveredRows;
        console.info("MessageBoard received authoritative board state after reconnecting.", {
          board,
          target: view.topic().target,
          rows: recoveredRows.length,
        });
        setRecovered(delivery.response);
        setRefreshed(undefined);
        setApplied(undefined);
        return;
      }
      const result = BoardPayloads.apply(board, rows.current, delivery.update);
      if (result.kind === "applied") {
        updateGeneration.current += 1;
        if (refreshInFlight.current) refreshRequest.current += 1;
        rows.current = result.rows;
        console.info("MessageBoard applied a server payload.", {
          board,
          target: view.topic().target,
          rows: result.rows.length,
        });
        setApplied(result.rows);
      } else {
        console.warn("MessageBoard is refreshing after an unusable live update.", {
          board,
          target: view.topic().target,
          reason: result.reason,
        });
        refresh();
      }
    },
    [board, refresh, view],
  );
  const onLifecycle = useCallback((next: SubscriptionLifecycle) => {
    lifecycleRef.current = next;
  }, []);
  const subscription = useEntitySubscription(
    view.topic(),
    () => view.query(),
    [view],
    onDelivery,
    onLifecycle,
  );
  const lifecycle = useSubscriptionLifecycle(subscription);
  lifecycleRef.current = lifecycle;
  const onPosted = useCallback(() => {
    if (lifecycleRef.current?.state !== "connected") refresh();
  }, [refresh]);

  useEffect(
    () => () => {
      refreshGeneration.current += 1;
      updateGeneration.current += 1;
      refreshController.current?.abort();
    },
    [view],
  );

  useEffect(() => {
    if (lifecycle === undefined) return;
    if (lifecycle.state === "connecting") {
      const details = { board, target: view.topic().target, generation: lifecycle.generation };
      if (lifecycle.attempt === 0)
        console.info("MessageBoard live updates are connecting.", details);
      else console.warn("MessageBoard live updates are reconnecting.", details);
    } else if (lifecycle.state === "connected") {
      console.info("MessageBoard live updates are connected.", {
        board,
        target: view.topic().target,
        generation: lifecycle.generation,
      });
    } else if (lifecycle.state === "failed") {
      console.error("MessageBoard live updates failed.", {
        board,
        target: view.topic().target,
        generation: lifecycle.generation,
      });
    }
    if (lifecycle.state === "gapPossible") refresh();
  }, [board, lifecycle, refresh, view]);

  return {
    rows: displayedRows,
    lifecycle,
    refresh,
    onPosted,
  };
};
