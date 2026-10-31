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

import { create, fromBinary } from "@bufbuild/protobuf";
import { ActorContextSchema, CommandSchema } from "@spine-event-engine/proto";
import {
  QuerySchema,
  AppQuerySchema,
  SubscriptionSchema,
  TargetSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import { AnyPacker } from "@spine-event-engine/core";
import type { IncomingRequest, IncomingRequestInput } from "../index.js";

interface IncomingRequestDecoder {
  /**
   * Decodes one accepted wire request.
   * @param input Wire envelope and transport context.
   * @returns Decoded request facts, if valid.
   */
  decode(input: IncomingRequestInput): IncomingRequest | undefined;
}

/**
 * Decodes the public request envelopes accepted by authentication gateways.
 */
export const IncomingRequests: Readonly<IncomingRequestDecoder> = Object.freeze({
  // prettier-ignore

  /**
   * Decodes one known wire envelope and omits malformed data.
   * @param input Supplies the wire envelope and its transport context.
   * @returns Returns decoded request facts or `undefined` for malformed input.
   */
  decode(input: IncomingRequestInput): IncomingRequest | undefined {
    try {
      switch (input.kind) {
        case "command": return IncomingRequestValues.command(input);
        case "query": return IncomingRequestValues.query(input);
        case "app-query": return IncomingRequestValues.appQuery(input);
        case "subscribe": return IncomingRequestValues.subscribe(input);
        case "activate":
        case "cancel": return IncomingRequestValues.subscription(input);
      }
    } catch {
      return undefined;
    }
  },
});

/**
 * Decodes each supported request envelope after the caller selects its kind.
 */
const IncomingRequestValues = Object.freeze({
  /**
   * Decodes a Command request.
   *
   * @param input Command wire request.
   * @returns Decoded command facts.
   */
  command(input: Extract<IncomingRequestInput, { kind: "command" }>): IncomingRequest {
    const command = fromBinary(CommandSchema, input.value);
    return {
      kind: "command",
      command,
      message:
        command.message === undefined || input.registry === undefined
          ? undefined
          : AnyPacker.tryUnpackUsing(input.registry, command.message),
      messageType: command.message?.typeUrl ?? "",
      requestedContext: command.context?.actorContext ?? create(ActorContextSchema),
      transport: input.transport,
    };
  },

  /**
   * Decodes a Query request.
   *
   * @param input Query wire request.
   * @returns Decoded query facts.
   */
  query(input: IncomingRequestInput): IncomingRequest {
    const query = fromBinary(QuerySchema, input.value);
    return {
      kind: "query",
      query,
      target: query.target ?? create(TargetSchema),
      requestedContext: query.context ?? create(ActorContextSchema),
      transport: input.transport,
    };
  },

  /**
   * Decodes an App Query without interpreting its domain payload at the gateway.
   *
   * @param input Serialized application query and safe transport facts.
   * @returns Actor context and the original domain request envelope.
   */
  appQuery(input: IncomingRequestInput): IncomingRequest {
    const query = fromBinary(AppQuerySchema, input.value);
    return {
      kind: "app-query",
      query,
      requestedContext: query.context ?? create(ActorContextSchema),
      transport: input.transport,
    };
  },

  /**
   * Decodes a subscription topic request.
   *
   * @param input Subscription topic wire request.
   * @returns Decoded topic facts.
   */
  subscribe(input: IncomingRequestInput): IncomingRequest {
    const topic = fromBinary(TopicSchema, input.value);
    return {
      kind: "subscribe",
      topic,
      target: topic.target ?? create(TargetSchema),
      requestedContext: topic.context ?? create(ActorContextSchema),
      transport: input.transport,
    };
  },

  /**
   * Decodes a subscription activation or cancellation request.
   *
   * @param input Subscription activation or cancellation.
   * @returns Decoded subscription facts.
   */
  subscription(input: IncomingRequestInput): IncomingRequest {
    const subscription = fromBinary(SubscriptionSchema, input.value);
    return {
      kind: input.kind as "activate" | "cancel",
      subscription,
      requestedContext: subscription.topic?.context ?? create(ActorContextSchema),
      transport: input.transport,
    };
  },
});
