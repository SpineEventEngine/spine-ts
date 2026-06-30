/** Transport-owned signal kinds for local routing contracts. */
export type TransportSignalKind =
  "command" | "delivery" | "event" | "query" | "subscription" | "system";

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
export interface PublishTransportOperation<
  Envelope = unknown,
  Kind extends TransportSignalKind = TransportSignalKind,
> {
  /** Transport-owned topic/routing contract. */
  readonly topic: TransportTopic<Kind>;
  /** Caller-owned envelope already shaped by an upstream package. */
  readonly envelope: Envelope;
}

/** Request-style transport operation contract. */
export interface RequestTransportOperation<
  RequestEnvelope = unknown,
  Kind extends TransportSignalKind = TransportSignalKind,
> {
  /** Transport-owned topic/routing contract. */
  readonly topic: TransportTopic<Kind>;
  /** Caller-owned request envelope already shaped by an upstream package. */
  readonly envelope: RequestEnvelope;
  /**
   * Optional response topic hint for adapters that need a stable return route.
   *
   * Omitting it leaves reply addressing to the concrete adapter implementation.
   */
  readonly responseTopic?: TransportTopic;
}

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
  const signalKind = input.signalKind;
  const messageTypeUrl = normalizeRequiredText(input.messageTypeUrl, "messageTypeUrl");
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
  const subscriberId = normalizeRequiredText(input.subscriberId, "subscriberId");
  const topic = createTransportTopic(input.topic);
  const mode = input.mode ?? "fan-out";

  return Object.freeze({
    subscriberId,
    mode,
    topic,
    descriptorKey: `${topic.routing.routingKey}#${encodeRoutingSegment(mode)}#${encodeRoutingSegment(subscriberId)}`,
  });
}

function normalizeRequiredText(value: string, name: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`Transport ${name} must not be empty.`);
  }

  return normalized;
}

function normalizeSemanticTags(
  semanticTags: readonly TransportSemanticTag[] | undefined,
): readonly TransportSemanticTag[] {
  if (semanticTags === undefined || semanticTags.length === 0) {
    return Object.freeze([]);
  }

  const normalized = [
    ...new Set(semanticTags.map((tag) => normalizeRequiredText(tag, "semanticTag"))),
  ].sort((left, right) => left.localeCompare(right));

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
