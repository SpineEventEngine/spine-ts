import { create, fromBinary } from "@bufbuild/protobuf";
import { ActorContextSchema, CommandSchema } from "@spine-event-engine/proto";
import {
  QuerySchema,
  SubscriptionSchema,
  TargetSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import { unpackAnyUsing } from "@spine-event-engine/core";
import type { IncomingRequest, IncomingRequestInput } from "../index.js";

/** The sole public request decoder; malformed known envelopes return undefined. */
export function decodeIncomingRequest(input: IncomingRequestInput): IncomingRequest | undefined {
  try {
    switch (input.kind) {
      case "command": {
        const command = fromBinary(CommandSchema, input.value);
        return {
          kind: input.kind,
          command,
          message:
            command.message === undefined || input.registry === undefined
              ? undefined
              : unpackAnyUsing(input.registry, command.message),
          messageType: command.message?.typeUrl ?? "",
          requestedContext: command.context?.actorContext ?? create(ActorContextSchema),
          transport: input.transport,
        };
      }
      case "query": {
        const query = fromBinary(QuerySchema, input.value);
        return {
          kind: input.kind,
          query,
          target: query.target ?? create(TargetSchema),
          requestedContext: query.context ?? create(ActorContextSchema),
          transport: input.transport,
        };
      }
      case "subscribe": {
        const topic = fromBinary(TopicSchema, input.value);
        return {
          kind: input.kind,
          topic,
          target: topic.target ?? create(TargetSchema),
          requestedContext: topic.context ?? create(ActorContextSchema),
          transport: input.transport,
        };
      }
      case "activate":
      case "cancel": {
        const subscription = fromBinary(SubscriptionSchema, input.value);
        return {
          kind: input.kind,
          subscription,
          requestedContext: subscription.topic?.context ?? create(ActorContextSchema),
          transport: input.transport,
        };
      }
    }
  } catch {
    return undefined;
  }
}
