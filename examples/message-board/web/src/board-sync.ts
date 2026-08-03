import {
  useEntityQuery,
  useEntitySubscription,
  useSubscriptionDelivery,
  useSubscriptionLifecycle,
} from "@spine-event-engine/client-react";
import type { ClientRequest, SubscriptionLifecycle } from "@spine-event-engine/client-web";
import type { BoardMessageView } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import type { QueryResponse } from "@spine-event-engine/proto/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BoardView } from "./board-view.js";

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
  const [recovered, setRecovered] = useState<QueryResponse>();
  const [refreshed, setRefreshed] = useState<QueryResponse>();
  const refreshInFlight = useRef(false);
  const refreshRequest = useRef(0);
  const refreshController = useRef<AbortController | undefined>(undefined);
  const refreshGeneration = useRef(0);
  const query = useEntityQuery(() => view.query(), [view]);
  const subscription = useEntitySubscription(view.topic(), () => view.query(), [view]);
  const lifecycle = useSubscriptionLifecycle(subscription);
  const delivery = useSubscriptionDelivery(subscription);

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
    refreshController.current = controller;
    void (async () => {
      try {
        let completedRequest: number;
        do {
          completedRequest = refreshRequest.current;
          let response: QueryResponse | undefined;
          try {
            response = await request.send(view.query(), { signal: controller.signal });
          } catch {
            if (controller.signal.aborted) return;
          }
          if (generation !== refreshGeneration.current) return;
          if (response !== undefined) {
            setRefreshed(response);
            setRecovered(undefined);
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

  useEffect(
    () => () => {
      refreshGeneration.current += 1;
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

  useEffect(() => {
    if (delivery === undefined) return;
    if (delivery.kind === "resynchronization") {
      console.info("MessageBoard received authoritative board state after reconnecting.", {
        board,
        target: view.topic().target,
        response: delivery.response,
      });
      setRecovered(delivery.response);
    } else {
      console.info("MessageBoard received a server update and is refreshing the board.", {
        board,
        target: view.topic().target,
        update: delivery.update,
      });
      refresh();
    }
  }, [board, delivery, refresh, view]);

  const response = recovered ?? refreshed ?? (query.status === "success" ? query.value : undefined);
  return {
    rows: response === undefined ? [] : view.rows(response),
    lifecycle,
    refresh,
  };
};
