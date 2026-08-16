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

import type { Command, Event } from "@spine-event-engine/proto";

/**
 * Defines transport-owned signal kinds for local routing contracts.
 */
export type TransportSignalKind = "command" | "event" | "query" | "subscription" | "system";

/**
 * Defines the envelope carried by a signal kind.
 */
export type TransportSignalEnvelope<
  Kind extends TransportSignalKind,
  OtherEnvelope = unknown,
> = Kind extends "command" ? Command : Kind extends "event" ? Event : OtherEnvelope;

/**
 * Defines an immutable routing descriptor owned by transport.
 */
export interface TransportRoutingDescriptor<
  Kind extends TransportSignalKind = TransportSignalKind,
> {
  // prettier-ignore

  /**
   * Identifies the high-level signal category.
   */
  readonly signalKind: Kind;

  /**
   * Identifies the canonical payload type URL.
   */
  readonly messageTypeUrl: string;

  /**
   * Identifies the deterministic adapter-agnostic routing key.
   */
  readonly routingKey: string;
}

/**
 * Defines input for one transport topic.
 */
export interface TransportTopicInput<Kind extends TransportSignalKind = TransportSignalKind> {
  // prettier-ignore

  /**
   * Identifies the high-level signal category.
   */
  readonly signalKind: Kind;

  /**
   * Identifies the canonical payload type URL.
   */
  readonly messageTypeUrl: string;
}

/**
 * Defines an immutable transport topic and routing descriptor.
 */
export interface TransportTopic<
  Kind extends TransportSignalKind = TransportSignalKind,
> extends TransportTopicInput<Kind> {
  // prettier-ignore

  /**
   * Provides transport-owned routing for adapter mapping.
   */
  readonly routing: TransportRoutingDescriptor<Kind>;
}

/**
 * Defines subscription behavior without socket details.
 */
export type TransportSubscriptionMode = "competing-consumer" | "fan-out";

/**
 * Defines input for one immutable subscription descriptor.
 */
export interface TransportSubscriptionInput<
  Kind extends TransportSignalKind = TransportSignalKind,
> {
  // prettier-ignore

  /**
   * Identifies the stable logical subscriber.
   */
  readonly subscriberId: string;

  /**
   * Specifies the topic to subscribe to.
   */
  readonly topic: TransportTopicInput<Kind> | TransportTopic<Kind>;

  /**
   * Specifies delivery behavior and defaults to `fan-out`.
   */
  readonly mode?: TransportSubscriptionMode;
}

/**
 * Defines an immutable transport subscription descriptor.
 */
export interface TransportSubscription<Kind extends TransportSignalKind = TransportSignalKind> {
  // prettier-ignore

  /**
   * Identifies the stable logical subscriber.
   */
  readonly subscriberId: string;

  /**
   * Identifies the delivery behavior.
   */
  readonly mode: TransportSubscriptionMode;

  /**
   * Provides a copy-safe transport topic.
   */
  readonly topic: TransportTopic<Kind>;

  /**
   * Identifies the deterministic topic, subscriber, and mode key.
   */
  readonly descriptorKey: string;
}

/**
 * Defines a publish-style transport operation.
 */
export type PublishTransportOperation<
  Envelope = unknown,
  Kind extends TransportSignalKind = TransportSignalKind,
> = Kind extends TransportSignalKind
  ? {
      readonly topic: TransportTopic<Kind>;
      readonly envelope: TransportSignalEnvelope<Kind, Envelope>;
    }
  : never;

/**
 * Defines a request-style transport operation.
 */
export type RequestTransportOperation<
  RequestEnvelope = unknown,
  Kind extends TransportSignalKind = TransportSignalKind,
> = Kind extends TransportSignalKind
  ? {
      readonly topic: TransportTopic<Kind>;
      readonly envelope: TransportSignalEnvelope<Kind, RequestEnvelope>;
    }
  : never;

/**
 * Accepts one publish-style operation.
 *
 * @param operation Specifies the published operation.
 * @returns Returns when handling completes.
 */
export type PublishTransportHandler<
  Envelope = unknown,
  Kind extends TransportSignalKind = TransportSignalKind,
> = (operation: PublishTransportOperation<Envelope, Kind>) => void | Promise<void>;

/**
 * Accepts one request-style operation.
 *
 * @param operation Specifies the received operation.
 * @returns Returns the response envelope.
 */
export type RequestTransportHandler<
  RequestEnvelope = unknown,
  ResponseEnvelope = unknown,
  Kind extends TransportSignalKind = TransportSignalKind,
> = (
  operation: RequestTransportOperation<RequestEnvelope, Kind>,
) => ResponseEnvelope | Promise<ResponseEnvelope>;

/**
 * Defines a common asynchronous close contract.
 */
export interface AsyncCloseable {
  // prettier-ignore

  /**
   * Closes the resource gracefully.
   * @returns Completes after the resource closes.
   */
  close(): Promise<void>;
}

/**
 * Defines the handle returned from a subscription.
 */
export interface TransportSubscriptionHandle<
  Kind extends TransportSignalKind = TransportSignalKind,
> extends AsyncCloseable {
  // prettier-ignore

  /**
   * Provides the descriptor associated with this subscription.
   */
  readonly subscription: TransportSubscription<Kind>;
}

/**
 * Defines adapter-agnostic transport operations.
 */
export interface SignalTransport extends AsyncCloseable {
  // prettier-ignore

  /**
   * Publishes one envelope to a topic.
   * @param operation Specifies the operation to publish.
   * @returns Completes after the operation is published.
   */
  publish<Envelope, Kind extends TransportSignalKind>(
    operation: PublishTransportOperation<Envelope, Kind>,
  ): Promise<void>;

  /**
   * Subscribes a handler to a topic.
   * @param subscription Specifies the subscribed topic and mode.
   * @param handler Specifies the handler for published operations.
   * @returns Returns the closeable subscription handle.
   */
  subscribe<Envelope, Kind extends TransportSignalKind>(
    subscription: TransportSubscription<Kind>,
    handler: PublishTransportHandler<Envelope, Kind>,
  ): Promise<TransportSubscriptionHandle<Kind>>;

  /**
   * Returns a typed response from a topic.
   * @param operation Specifies the request operation.
   * @returns Returns the response envelope.
   */
  request<RequestEnvelope, ResponseEnvelope, Kind extends TransportSignalKind>(
    operation: RequestTransportOperation<RequestEnvelope, Kind>,
  ): Promise<ResponseEnvelope>;

  /**
   * Registers a request handler for a topic.
   * @param subscription Specifies the subscribed topic and mode.
   * @param handler Specifies the handler for request operations.
   * @returns Returns the closeable subscription handle.
   */
  respond<RequestEnvelope, ResponseEnvelope, Kind extends TransportSignalKind>(
    subscription: TransportSubscription<Kind>,
    handler: RequestTransportHandler<RequestEnvelope, ResponseEnvelope, Kind>,
  ): Promise<TransportSubscriptionHandle<Kind>>;
}

const transportTopics = {
  // prettier-ignore

  /**
   * Creates an immutable topic with deterministic routing.
   * @param input Specifies the topic data.
   * @returns Returns the immutable transport topic.
   */
  create<Kind extends TransportSignalKind>(input: TransportTopicInput<Kind>): TransportTopic<Kind> {
    const signalKind = TransportTopicParts.normalizeKind(input.signalKind);
    const messageTypeUrl = TransportTopicParts.normalizeTypeUrl(input.messageTypeUrl);
    const routing = Object.freeze({
      signalKind,
      messageTypeUrl,
      routingKey: TransportTopicParts.routingKey(signalKind, messageTypeUrl),
    });
    return Object.freeze({ signalKind, messageTypeUrl, routing });
  },

  /**
   * Checks a topic's top-level signal kind.
   * @param topic Specifies the topic to inspect.
   * @param signalKind Specifies the expected signal kind.
   * @returns Returns whether the top-level kind matches.
   */
  hasKind<Topic extends TransportTopic, Kind extends Topic["signalKind"]>(
    topic: Topic,
    signalKind: Kind & NoInfer<Topic["signalKind"]>,
  ): topic is Topic & { readonly signalKind: Kind } {
    return topic.signalKind === signalKind;
  },
};
type TransportTopicsOwner = Readonly<typeof transportTopics>;

/**
 * Constructs normalized transport topics and checks their signal kinds.
 */
export const TransportTopics: TransportTopicsOwner = Object.freeze(transportTopics);

const transportKinds = new Set<string>(["command", "event", "query", "subscription", "system"]);

const TransportTopicParts = {
  requiredText(value: string, name: string): string {
    const normalized = value.trim();
    if (normalized.length === 0) throw new Error(`Transport ${name} must not be empty.`);
    return normalized;
  },
  normalizeKind<Kind extends TransportSignalKind>(value: Kind): Kind {
    const kind = TransportTopicParts.requiredText(value, "signalKind");
    if (!transportKinds.has(kind))
      throw new Error(`Transport signalKind must be one of: ${[...transportKinds].join(", ")}.`);
    return kind as Kind;
  },
  normalizeTypeUrl(value: string): string {
    const typeUrl = TransportTopicParts.requiredText(value, "messageTypeUrl");
    const separator = typeUrl.indexOf("/");
    if (separator <= 0 || separator === typeUrl.length - 1 || /\s/u.test(typeUrl))
      throw new Error("Transport messageTypeUrl must use canonical 'prefix/type.name' format.");
    return typeUrl;
  },
  routingKey(kind: TransportSignalKind, typeUrl: string): string {
    return `${kind}:${encodeURIComponent(typeUrl)}`;
  },
};

const transportSubscriptions = {
  // prettier-ignore

  /**
   * Creates an immutable subscription descriptor.
   * @param input Specifies the subscriber, topic, and mode.
   * @returns Returns the immutable subscription descriptor.
   */
  create<Kind extends TransportSignalKind>(
    input: TransportSubscriptionInput<Kind>,
  ): TransportSubscription<Kind> {
    const subscriberId = TransportSubscriptionParts.normalizeId(input.subscriberId);
    const mode = TransportSubscriptionParts.normalizeMode(input.mode ?? "fan-out");
    const topic = TransportTopics.create(input.topic);
    return Object.freeze({
      subscriberId,
      mode,
      topic,
      descriptorKey: `${topic.routing.routingKey}#${encodeURIComponent(mode)}#${encodeURIComponent(subscriberId)}`,
    });
  },
};
type TransportSubscriptionsOwner = Readonly<typeof transportSubscriptions>;

/**
 * Constructs and validates transport subscriptions.
 */
export const TransportSubscriptions: TransportSubscriptionsOwner =
  Object.freeze(transportSubscriptions);
const TransportSubscriptionParts = {
  normalizeId(value: string): string {
    const id = TransportTopicParts.requiredText(value, "subscriberId");
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(id) || /^\d+$/u.test(id))
      throw new Error(
        "Transport subscriberId must use logical-name format (letters/digits followed by " +
          "letters/digits/underscores/hyphens, not endpoints, paths, hostnames, or PIDs).",
      );
    return id;
  },
  normalizeMode(value: string): TransportSubscriptionMode {
    const mode = TransportTopicParts.requiredText(value, "mode");
    if (mode !== "competing-consumer" && mode !== "fan-out")
      throw new Error("Transport mode must be one of: competing-consumer, fan-out.");
    return mode;
  },
};

const transportOperations = {
  // prettier-ignore

  /**
   * Checks an operation's nested topic kind.
   * @param operation Specifies the operation to inspect.
   * @param signalKind Specifies the expected signal kind.
   * @returns Returns whether the nested topic kind matches.
   */
  hasKind<
    Operation extends PublishTransportOperation | RequestTransportOperation,
    Kind extends Operation["topic"]["signalKind"],
  >(
    operation: Operation,
    signalKind: Kind & NoInfer<Operation["topic"]["signalKind"]>,
  ): operation is Extract<Operation, { readonly topic: TransportTopic<Kind> }> {
    return operation.topic.signalKind === signalKind;
  },
};
type TransportOperationsOwner = Readonly<typeof transportOperations>;

/**
 * Checks transport operation kinds.
 */
export const TransportOperations: TransportOperationsOwner = Object.freeze(transportOperations);

export type {
  ConsumerHandle,
  ExternalMessageConsumer,
  MessageChannel,
  Publisher,
  Subscriber,
  TransportFactory,
} from "./internal/message-channel.js";
export { InMemoryTransportFactory } from "./memory/message-transport.js";
