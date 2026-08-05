import {
  BoardMessageViewSchema,
  MessageIdSchema,
  type BoardMessageView,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import { AnyMessages } from "@spine-event-engine/core";
import type { Any } from "@bufbuild/protobuf/wkt";
import type { EntityStateUpdate, SubscriptionUpdate } from "@spine-event-engine/proto/client";

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
export type BoardPayloadResult =
  | Readonly<{ readonly kind: "applied"; readonly rows: readonly BoardMessageView[] }>
  | Readonly<{ readonly kind: "recovery"; readonly reason: BoardRecovery }>;

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
    const parsed = read(board, value);
    if (typeof parsed === "string") return { kind: "recovery", reason: parsed };
    const next = new Map(rows.map((row) => [row.id?.value ?? "", row]));
    for (const change of parsed)
      if (change.row === undefined) next.delete(change.id);
      else next.set(change.id, change.row);
    return { kind: "applied", rows: [...next.values()].sort(order) };
  },
});

/**
 * Parses an entire entity batch before any caller-visible row change.
 *
 * @param board Identifies the selected board.
 * @param value Supplies one raw subscription update.
 * @returns The validated changes or a recovery reason.
 */
function read(board: string, value: SubscriptionUpdate): readonly BoardChange[] | BoardRecovery {
  if (value.update.case !== "entityUpdates") return "wrong-update";
  if (value.update.value.update.length === 0) return "empty-batch";
  const changes: BoardChange[] = [];
  for (const update of value.update.value.update) {
    const change = readChange(board, update);
    if (typeof change === "string") return change;
    changes.push(change);
  }
  return changes;
}

/**
 * Decodes one subscription item after its batch is known to be an entity update.
 *
 * @param board Identifies the selected board.
 * @param update Supplies one entity state update.
 * @returns The row, removed identifier, or recovery reason.
 */
function readChange(board: string, update: EntityStateUpdate): BoardChange | BoardRecovery {
  const id = readId(update);
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
}

/**
 * Decodes a non-empty Message Board identity.
 *
 * @param update Supplies the entity state update containing an identity.
 * @returns The decoded identifier or its recovery reason.
 */
function readId(update: EntityStateUpdate): BoardId | BoardRecovery {
  if (update.id === undefined) return "missing-id";
  const id = AnyMessages.unpack(update.id, MessageIdSchema)?.value;
  return id === undefined || id.length === 0 ? "invalid-id" : { value: id };
}

/**
 * Orders rows by posting time and then identity for deterministic oldest-first display.
 *
 * @param left Supplies the first row.
 * @param right Supplies the second row.
 * @returns The relative display order.
 */
function order(left: BoardMessageView, right: BoardMessageView): number {
  const leftSeconds = left.postedAt?.seconds ?? 0n;
  const rightSeconds = right.postedAt?.seconds ?? 0n;
  const seconds = leftSeconds < rightSeconds ? -1 : leftSeconds > rightSeconds ? 1 : 0;
  return (
    seconds ||
    (left.postedAt?.nanos ?? 0) - (right.postedAt?.nanos ?? 0) ||
    (left.id?.value ?? "").localeCompare(right.id?.value ?? "")
  );
}

type BoardChange = Readonly<{ readonly id: string; readonly row?: BoardMessageView }>;
type BoardId = Readonly<{ readonly value: string }>;
