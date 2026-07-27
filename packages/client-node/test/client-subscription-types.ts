import type { Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { UserIdSchema } from "@spine-event-engine/proto";

import type {
  EntityColumn,
  EntityPredicate,
  StateSubscriptionUpdate,
  StateSubscriptionOptions,
  SubscriptionEvent,
} from "../src/index.js";
import {
  AggregateStateSchema,
  ProjectionStateSchema,
} from "../test-fixtures/entity-column-fixtures.js";

declare const projectionPredicate: EntityPredicate<EntityColumn<typeof ProjectionStateSchema>>;
declare const aggregatePredicate: EntityPredicate<EntityColumn<typeof AggregateStateSchema>>;

const valid: StateSubscriptionOptions<typeof ProjectionStateSchema, typeof UserIdSchema> = {
  ids: [],
  where: projectionPredicate,
  mask: ["id", "title"],
};
void valid;

const wrongPredicate: StateSubscriptionOptions<typeof ProjectionStateSchema, typeof UserIdSchema> =
  {
    // @ts-expect-error A predicate column must belong to the subscribed state schema.
    where: aggregatePredicate,
  };
void wrongPredicate;

const wrongMask: StateSubscriptionOptions<typeof ProjectionStateSchema, typeof UserIdSchema> = {
  // @ts-expect-error Masks are constrained to declared top-level state fields.
  mask: ["missing"],
};
void wrongMask;

type PublicStateOptions<Schema extends GenMessage<Message>> = StateSubscriptionOptions<
  Schema,
  typeof UserIdSchema
>;
const inferred: PublicStateOptions<typeof ProjectionStateSchema> = valid;
void inferred;

declare const update: StateSubscriptionUpdate<typeof ProjectionStateSchema, typeof UserIdSchema>;
if (update.kind === "state") {
  // @ts-expect-error Decoded state is recursively readonly.
  update.state.title = "changed";
  // @ts-expect-error Decoded bytes expose readonly indices.
  update.state.fingerprint[0] = 9;
}

declare const event: SubscriptionEvent<typeof ProjectionStateSchema>;
// @ts-expect-error Decoded event messages are recursively readonly.
event.message.title = "changed";
// @ts-expect-error Decoded event context is recursively readonly.
event.context.external = true;
