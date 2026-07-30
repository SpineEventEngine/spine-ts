import { create, fromBinary } from "@bufbuild/protobuf";
import { ActorContextSchema, CommandSchema } from "@spine-event-engine/proto";
import {
  QuerySchema,
  SubscriptionSchema,
  TargetSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import { AnyMessages } from "@spine-event-engine/core";
import type { IncomingRequest, IncomingRequestInput } from "../index.js";

interface IncomingRequestDecoder {
  decode(input: IncomingRequestInput): IncomingRequest | undefined;
}

/** Decodes the public request envelopes accepted by authentication gateways. */
export const IncomingRequests: Readonly<IncomingRequestDecoder> = Object.freeze({
  /** Decodes one known wire envelope and omits malformed data.
   * @param input Supplies the wire envelope and its transport context.
   * @returns Returns decoded request facts or `undefined` for malformed input.
   */
  decode(input: IncomingRequestInput): IncomingRequest | undefined {
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
                : AnyMessages.unpackUsing(input.registry, command.message),
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
  },
});
