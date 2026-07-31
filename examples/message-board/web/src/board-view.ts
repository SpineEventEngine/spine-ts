import { create } from "@bufbuild/protobuf";
import {
  BoardIdSchema,
  BoardMessageViewSchema,
  type BoardMessageView,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import { AnyMessages, TypeUrls } from "@spine-event-engine/core";
import { ActorContextSchema } from "@spine-event-engine/proto";
import {
  CompositeFilterSchema,
  CompositeFilter_CompositeOperator,
  FilterSchema,
  Filter_Operator,
  OrderBySchema,
  OrderBy_Direction,
  QueryIdSchema,
  QuerySchema,
  ResponseFormatSchema,
  TargetFiltersSchema,
  TargetSchema,
  TopicIdSchema,
  TopicSchema,
  type Query,
  type QueryResponse,
  type Topic,
} from "@spine-event-engine/proto/client";

/**
 * Builds the authoritative query and subscription target for one board.
 */
export class BoardView {
  constructor(private readonly board: string) {}

  /**
   * Builds an oldest-first query for this board.
   *
   * @returns The board query.
   */
  query(): Query {
    return create(QuerySchema, {
      id: create(QueryIdSchema, { value: `message-board-${this.board}` }),
      context: create(ActorContextSchema),
      target: create(TargetSchema, {
        type: TypeUrls.derive(BoardMessageViewSchema),
        criterion: {
          case: "filters",
          value: create(TargetFiltersSchema, {
            filter: [
              create(CompositeFilterSchema, {
                operator: CompositeFilter_CompositeOperator.ALL,
                filter: [
                  create(FilterSchema, {
                    fieldPath: { fieldName: ["board"] },
                    operator: Filter_Operator.EQUAL,
                    value: AnyMessages.pack(
                      BoardIdSchema,
                      create(BoardIdSchema, { value: this.board }),
                    ),
                  }),
                ],
              }),
            ],
          }),
        },
      }),
      format: create(ResponseFormatSchema, {
        orderBy: [
          create(OrderBySchema, {
            column: "posted_at",
            direction: OrderBy_Direction.ASCENDING,
          }),
        ],
      }),
    });
  }

  /**
   * Builds a Projection subscription for this board.
   *
   * @returns The board topic.
   */
  topic(): Topic {
    return create(TopicSchema, {
      id: create(TopicIdSchema, { value: `message-board-${this.board}` }),
      context: create(ActorContextSchema),
      target: this.query().target,
    });
  }

  /**
   * Reads and deterministically orders this board's rows.
   *
   * @param response The authoritative query response.
   * @returns The selected board rows from oldest to newest.
   */
  rows(response: QueryResponse): readonly BoardMessageView[] {
    return response.message
      .flatMap((entry) => {
        if (entry.state === undefined) return [];
        const row = AnyMessages.unpack(entry.state, BoardMessageViewSchema);
        return row?.board?.value === this.board ? [row] : [];
      })
      .sort(BoardRows.compare);
  }
}

/**
 * Orders message rows by creation time and identifier.
 */
const BoardRows = Object.freeze({
  /**
   * Compares two message rows for oldest-first display.
   *
   * @param left The first row.
   * @param right The second row.
   * @returns A negative number when the first row belongs before the second.
   */
  compare(left: BoardMessageView, right: BoardMessageView): number {
    const leftTime = left.postedAt?.seconds ?? 0n;
    const rightTime = right.postedAt?.seconds ?? 0n;
    const secondOrder = leftTime < rightTime ? -1 : leftTime > rightTime ? 1 : 0;
    const nanosOrder = (left.postedAt?.nanos ?? 0) - (right.postedAt?.nanos ?? 0);
    return secondOrder || nanosOrder || (left.id?.value ?? "").localeCompare(right.id?.value ?? "");
  },
});
