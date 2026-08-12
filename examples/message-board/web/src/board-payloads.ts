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
  BoardMessageViewSchema,
  MessageIdSchema,
  type BoardMessageView,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import { AnyMessages } from "@spine-event-engine/core";
import type { Any } from "@bufbuild/protobuf/wkt";
import type { EntityStateUpdate, SubscriptionUpdate } from "@spine-event-engine/proto/client";

import { BoardRows } from "./board-view.js";

/**
 * Explains why the board must recover from an authoritative query.
 */
export type BoardRecovery =
  | "wrong-update"
  | "empty-batch"
  | "wrong-kind"
  | "missing-id"
  | "invalid-id"
  | "missing-state"
  | "invalid-state"
  | "identity-mismatch"
  | "foreign-board";

/**
 * Describes either an atomically applied subscription batch or required recovery.
 */
export type BoardPayloadResult = BoardPayloadApplied | BoardPayloadRecovery;

/**
 * Describes rows produced by one valid subscription batch.
 */
export interface BoardPayloadApplied {
  // prettier-ignore

  /**
   * Identifies a successfully applied batch.
   */
  readonly kind: "applied";

  /**
   * Contains the replacement rows in display order.
   */
  readonly rows: readonly BoardMessageView[];
}

/**
 * Describes the recovery required for one unusable subscription batch.
 */
export interface BoardPayloadRecovery {
  // prettier-ignore

  /**
   * Identifies a batch that needs authoritative recovery.
   */
  readonly kind: "recovery";

  /**
   * Explains why the payload was not applied.
   */
  readonly reason: BoardRecovery;
}

/**
 * Validates and applies Message Board entity-state update batches without client access.
 */
export const BoardPayloads: Readonly<{
  readonly apply: (
    board: string,
    rows: readonly BoardMessageView[],
    value: SubscriptionUpdate,
  ) => BoardPayloadResult;
}> = Object.freeze({
  // prettier-ignore

  /**
   * Applies a fully valid batch or reports the first reason authoritative recovery is required.
   *
   * @param board Identifies the board receiving the update.
   * @param rows Supplies the current board rows.
   * @param value Supplies one raw subscription update.
   * @returns The ordered replacement rows or a recovery reason.
   */
  apply(
    board: string,
    rows: readonly BoardMessageView[],
    value: SubscriptionUpdate,
  ): BoardPayloadResult {
    const parsed = BoardPayloadReaders.read(board, value);
    if (typeof parsed === "string") return { kind: "recovery", reason: parsed };
    const next = new Map(rows.map((row) => [row.id?.value ?? "", row]));
    for (const change of parsed)
      if (change.row === undefined) next.delete(change.id);
      else next.set(change.id, change.row);
    return { kind: "applied", rows: [...next.values()].sort(BoardRows.compare) };
  },
});

/**
 * Keeps payload parsing steps beside the reducer without expanding its public API.
 */
const BoardPayloadReaders = Object.freeze({
  // prettier-ignore

  /**
   * Parses an entire entity batch before any caller-visible row change.
   *
   * @param board Identifies the selected board.
   * @param value Supplies one raw subscription update.
   * @returns The validated changes or a recovery reason.
   */
  read(board: string, value: SubscriptionUpdate): readonly BoardChange[] | BoardRecovery {
    if (value.update.case !== "entityUpdates") return "wrong-update";
    if (value.update.value.update.length === 0) return "empty-batch";
    const changes: BoardChange[] = [];
    for (const update of value.update.value.update) {
      const change = BoardPayloadReaders.readChange(board, update);
      if (typeof change === "string") return change;
      changes.push(change);
    }
    return changes;
  },

  /**
   * Decodes one subscription item after its batch is known to be an entity update.
   *
   * @param board Identifies the selected board.
   * @param update Supplies one entity state update.
   * @returns The row, removed identifier, or recovery reason.
   */
  readChange(board: string, update: EntityStateUpdate): BoardChange | BoardRecovery {
    const id = BoardPayloadReaders.readId(update);
    if (typeof id === "string") return id;
    if (update.kind.case === "noLongerMatching") return { id: id.value };
    if (update.kind.case !== "state") return "wrong-kind";
    const state = update.kind.value as Any | undefined;
    if (state === undefined) return "missing-state";
    const row = AnyMessages.unpack(state, BoardMessageViewSchema);
    if (row === undefined) return "invalid-state";
    const rowId = row.id?.value;
    if (rowId === undefined || rowId.length === 0) return "invalid-state";
    if (rowId !== id.value) return "identity-mismatch";
    if (row.board?.value !== board) return "foreign-board";
    return { id: id.value, row };
  },

  /**
   * Decodes a non-empty Message Board identity.
   *
   * @param update Supplies the entity state update containing an identity.
   * @returns The decoded identifier or its recovery reason.
   */
  readId(update: EntityStateUpdate): BoardId | BoardRecovery {
    if (update.id === undefined) return "missing-id";
    const id = AnyMessages.unpack(update.id, MessageIdSchema)?.value;
    return id === undefined || id.length === 0 ? "invalid-id" : { value: id };
  },
});

type BoardChange = Readonly<{ readonly id: string; readonly row?: BoardMessageView }>;
type BoardId = Readonly<{ readonly value: string }>;
