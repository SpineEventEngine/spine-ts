import type { Command, Event } from "@spine-ts/proto";

/** Transport-owned signal kinds for local routing contracts. */
export type TransportSignalKind = "command" | "event" | "query" | "subscription" | "system";

/** Envelope carried by a signal kind, with caller-owned shapes for non-Proto kinds. */
export type TransportSignalEnvelope<
  Kind extends TransportSignalKind,
  OtherEnvelope = unknown,
> = Kind extends "command" ? Command : Kind extends "event" ? Event : OtherEnvelope;

const transportSignalKinds = ["command", "event", "query", "subscription", "system"] as const;
const transportSignalKindSet = new Set<string>(transportSignalKinds);

/** Semantic tag copied from descriptor metadata for later adapter matching. */
export type TransportSemanticTag = string;

/** Immutable routing descriptor owned by the transport package. */
export interface TransportRoutingDescriptor<
  Kind extends TransportSignalKind = TransportSignalKind,
> {
  /** High-level signal category used for transport-owned routing. */
  readonly signalKind: Kind;
  /** Canonical type URL of the routed message payload. */
  readonly messageTypeUrl: string;
  /** Deterministic sorted semantic tags associated with the topic. */
  readonly semanticTags: readonly TransportSemanticTag[];
  /** Deterministic adapter-agnostic routing key. */
  readonly routingKey: string;
}

/** Input for defining one transport topic. */
export interface TransportTopicInput<Kind extends TransportSignalKind = TransportSignalKind> {
  /** High-level signal category used for transport-owned routing. */
  readonly signalKind: Kind;
  /** Canonical type URL of the routed message payload. */
  readonly messageTypeUrl: string;
  /** Optional semantic tags copied from descriptor metadata. */
  readonly semanticTags?: readonly TransportSemanticTag[];
}

/** Immutable transport topic that exposes both topic data and its routing descriptor. */
export interface TransportTopic<
  Kind extends TransportSignalKind = TransportSignalKind,
> extends TransportTopicInput<Kind> {
  /** Deterministic sorted semantic tags associated with the topic. */
  readonly semanticTags: readonly TransportSemanticTag[];
  /** Transport-owned routing descriptor for later adapter mapping. */
  readonly routing: TransportRoutingDescriptor<Kind>;
}

/** Subscription behavior expected by the transport adapter, without socket details. */
export type TransportSubscriptionMode = "competing-consumer" | "fan-out";

const transportSubscriptionModes = ["competing-consumer", "fan-out"] as const;
const transportSubscriptionModeSet = new Set<string>(transportSubscriptionModes);

/** Input for defining one immutable transport subscription descriptor. */
export interface TransportSubscriptionInput<
  Kind extends TransportSignalKind = TransportSignalKind,
> {
  /** Stable logical subscriber identity, not a process, endpoint, or socket name. */
  readonly subscriberId: string;
  /** Topic to subscribe to. */
  readonly topic: TransportTopicInput<Kind> | TransportTopic<Kind>;
  /** Delivery behavior expected by the subscriber. Defaults to `fan-out`. */
  readonly mode?: TransportSubscriptionMode;
}

/** Immutable transport subscription descriptor. */
export interface TransportSubscription<Kind extends TransportSignalKind = TransportSignalKind> {
  /** Stable logical subscriber identity, not a process, endpoint, or socket name. */
  readonly subscriberId: string;
  /** Delivery behavior expected by the subscriber. */
  readonly mode: TransportSubscriptionMode;
  /** Copy-safe transport topic. */
  readonly topic: TransportTopic<Kind>;
  /** Deterministic descriptor key derived from topic, subscriber, and mode. */
  readonly descriptorKey: string;
}

/** Publish-style transport operation contract. */
export type PublishTransportOperation<
  Envelope = unknown,
  Kind extends TransportSignalKind = TransportSignalKind,
> = Kind extends TransportSignalKind
  ? {
      /** Transport-owned topic/routing contract. */
      readonly topic: TransportTopic<Kind>;
      /** Caller-owned envelope already shaped by an upstream package. */
      readonly envelope: TransportSignalEnvelope<Kind, Envelope>;
    }
  : never;

/** Request-style transport operation contract. */
export type RequestTransportOperation<
  RequestEnvelope = unknown,
  Kind extends TransportSignalKind = TransportSignalKind,
> = Kind extends TransportSignalKind
  ? {
      /** Transport-owned topic/routing contract. */
      readonly topic: TransportTopic<Kind>;
      /** Caller-owned request envelope already shaped by an upstream package. */
      readonly envelope: TransportSignalEnvelope<Kind, RequestEnvelope>;
    }
  : never;

/** Handler for one publish-style operation. */
export type PublishTransportHandler<
  Envelope = unknown,
  Kind extends TransportSignalKind = TransportSignalKind,
> = (operation: PublishTransportOperation<Envelope, Kind>) => void | Promise<void>;

/** Handler for one request-style operation. */
export type RequestTransportHandler<
  RequestEnvelope = unknown,
  ResponseEnvelope = unknown,
  Kind extends TransportSignalKind = TransportSignalKind,
> = (
  operation: RequestTransportOperation<RequestEnvelope, Kind>,
) => ResponseEnvelope | Promise<ResponseEnvelope>;

/** Common async close contract for transport-owned resources. */
export interface AsyncCloseable {
  /** Start graceful asynchronous shutdown. */
  close(): Promise<void>;
}

/** Async handle returned from a transport subscription. */
export interface TransportSubscriptionHandle<
  Kind extends TransportSignalKind = TransportSignalKind,
> extends AsyncCloseable {
  /** Descriptor associated with this active subscription. */
  readonly subscription: TransportSubscription<Kind>;
}

/** Adapter-agnostic transport contract for later runtime integration. */
export interface SignalTransport extends AsyncCloseable {
  /** Publish one envelope to a transport-owned topic. */
  publish<Envelope, Kind extends TransportSignalKind>(
    operation: PublishTransportOperation<Envelope, Kind>,
  ): Promise<void>;
  /** Register one publish-style handler for a topic subscription. */
  subscribe<Envelope, Kind extends TransportSignalKind>(
    subscription: TransportSubscription<Kind>,
    handler: PublishTransportHandler<Envelope, Kind>,
  ): Promise<TransportSubscriptionHandle<Kind>>;
  /** Send one request-style envelope and await a typed response. */
  request<RequestEnvelope, ResponseEnvelope, Kind extends TransportSignalKind>(
    operation: RequestTransportOperation<RequestEnvelope, Kind>,
  ): Promise<ResponseEnvelope>;
  /** Register one request-style handler for a topic subscription. */
  respond<RequestEnvelope, ResponseEnvelope, Kind extends TransportSignalKind>(
    subscription: TransportSubscription<Kind>,
    handler: RequestTransportHandler<RequestEnvelope, ResponseEnvelope, Kind>,
  ): Promise<TransportSubscriptionHandle<Kind>>;
}

/** Create an immutable transport topic with a deterministic routing key. */
export function createTransportTopic<Kind extends TransportSignalKind>(
  input: TransportTopicInput<Kind>,
): TransportTopic<Kind> {
  const signalKind = normalizeTransportSignalKind(input.signalKind);
  const messageTypeUrl = normalizeMessageTypeUrl(input.messageTypeUrl);
  const semanticTags = normalizeSemanticTags(input.semanticTags);
  const routing = Object.freeze({
    signalKind,
    messageTypeUrl,
    semanticTags,
    routingKey: createRoutingKey(signalKind, messageTypeUrl, semanticTags),
  });

  return Object.freeze({
    signalKind,
    messageTypeUrl,
    semanticTags,
    routing,
  });
}

/** Create an immutable subscription descriptor over a copy-safe topic. */
export function createTransportSubscription<Kind extends TransportSignalKind>(
  input: TransportSubscriptionInput<Kind>,
): TransportSubscription<Kind> {
  const subscriberId = normalizeLogicalTransportId(input.subscriberId, "subscriberId");
  const mode = normalizeTransportSubscriptionMode(input.mode ?? "fan-out");
  const topic = createTransportTopic(input.topic);

  return Object.freeze({
    subscriberId,
    mode,
    topic,
    descriptorKey: `${topic.routing.routingKey}#${encodeRoutingSegment(mode)}#${encodeRoutingSegment(subscriberId)}`,
  });
}

/** Narrow a transport operation to the selected canonical topic kind. */
export function hasTransportSignalKind<
  Operation extends {
    readonly topic: TransportTopic;
    readonly envelope: unknown;
    readonly signalKind?: never;
  },
  Kind extends Operation["topic"]["signalKind"],
>(
  value: Operation,
  signalKind: Kind & NoInfer<Operation["topic"]["signalKind"]>,
): value is Extract<Operation, { readonly topic: TransportTopic<Kind> }>;

/** Narrow a transport topic to the selected canonical kind. */
export function hasTransportSignalKind<
  TopicKind extends TransportSignalKind,
  Kind extends TopicKind,
>(
  value: TransportTopic<TopicKind> & { readonly topic?: never },
  signalKind: Kind & NoInfer<TopicKind>,
): value is TransportTopic<Kind> & { readonly topic?: never };

export function hasTransportSignalKind(
  value:
    | TransportTopic
    | {
        readonly topic: TransportTopic;
        readonly envelope: unknown;
      },
  signalKind: TransportSignalKind,
): boolean {
  const topic = "signalKind" in value ? value : value.topic;
  return topic.signalKind === signalKind;
}

function normalizeRequiredText(value: string, name: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`Transport ${name} must not be empty.`);
  }

  return normalized;
}

function normalizeLogicalTransportId(value: string, name: string): string {
  const normalized = normalizeRequiredText(value, name);

  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(normalized) || /^\d+$/u.test(normalized)) {
    throw new Error(
      `Transport ${name} must use logical-name format (letters/digits followed by ` +
        "letters/digits/underscores/hyphens, not endpoints, paths, hostnames, or PIDs).",
    );
  }

  return normalized;
}

function normalizeTransportSignalKind<Kind extends TransportSignalKind>(value: Kind): Kind {
  const signalKind = normalizeRequiredText(value, "signalKind");

  if (!transportSignalKindSet.has(signalKind)) {
    throw new Error(`Transport signalKind must be one of: ${transportSignalKinds.join(", ")}.`);
  }

  return signalKind as Kind;
}

function normalizeTransportSubscriptionMode(value: string): TransportSubscriptionMode {
  const mode = normalizeRequiredText(value, "mode");

  if (!transportSubscriptionModeSet.has(mode)) {
    throw new Error(`Transport mode must be one of: ${transportSubscriptionModes.join(", ")}.`);
  }

  return mode as TransportSubscriptionMode;
}

function normalizeMessageTypeUrl(value: string): string {
  const messageTypeUrl = normalizeRequiredText(value, "messageTypeUrl");
  const separatorIndex = messageTypeUrl.indexOf("/");

  if (
    separatorIndex <= 0 ||
    separatorIndex === messageTypeUrl.length - 1 ||
    /\s/u.test(messageTypeUrl)
  ) {
    throw new Error("Transport messageTypeUrl must use canonical 'prefix/type.name' format.");
  }

  return messageTypeUrl;
}

function normalizeSemanticTags(
  semanticTags: readonly TransportSemanticTag[] | undefined,
): readonly TransportSemanticTag[] {
  if (semanticTags === undefined || semanticTags.length === 0) {
    return Object.freeze([]);
  }

  const normalized = [
    ...new Set(semanticTags.map((tag) => normalizeRequiredText(tag, "semanticTag"))),
  ].sort(compareTransportStrings);

  return Object.freeze(normalized);
}

function createRoutingKey(
  signalKind: TransportSignalKind,
  messageTypeUrl: string,
  semanticTags: readonly TransportSemanticTag[],
): string {
  const topicSegment = `${signalKind}:${encodeRoutingSegment(messageTypeUrl)}`;

  if (semanticTags.length === 0) {
    return topicSegment;
  }

  return `${topicSegment}:${semanticTags.map(encodeRoutingSegment).join(",")}`;
}

function encodeRoutingSegment(value: string): string {
  return encodeURIComponent(value);
}

function compareTransportStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}
