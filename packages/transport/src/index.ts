/** Transport-owned signal kinds for local routing contracts. */
export type TransportSignalKind =
  "command" | "delivery" | "event" | "query" | "subscription" | "system";

const transportSignalKinds = [
  "command",
  "delivery",
  "event",
  "query",
  "subscription",
  "system",
] as const;
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

/** Logical participant kinds supported by the transport lifecycle seam. */
export type TransportParticipantKind = "broker" | "worker";

const transportParticipantKinds = ["broker", "worker"] as const;
const transportParticipantKindSet = new Set<string>(transportParticipantKinds);

/** Stable logical worker roles for local transport participants. */
export type TransportWorkerRole =
  | "command-worker"
  | "delivery-worker"
  | "event-worker"
  | "projection-worker"
  | "query-worker"
  | "subscription-worker"
  | "system-worker";

const transportWorkerRoles = [
  "command-worker",
  "delivery-worker",
  "event-worker",
  "projection-worker",
  "query-worker",
  "subscription-worker",
  "system-worker",
] as const;
const transportWorkerRoleSet = new Set<string>(transportWorkerRoles);

/** Deterministic lifecycle state for one broker or worker participant. */
export type TransportLifecycleState = "created" | "starting" | "running" | "closing" | "closed";

const transportLifecycleStates = ["created", "starting", "running", "closing", "closed"] as const;
const transportLifecycleStateSet = new Set<string>(transportLifecycleStates);

/** Readiness state derived from lifecycle/registration evidence. */
export type TransportReadinessState = "pending" | "ready";

const transportReadinessStates = ["pending", "ready"] as const;
const transportReadinessStateSet = new Set<string>(transportReadinessStates);

/** Input for one stable transport participant identity. */
export type TransportParticipantIdentityInput<
  Kind extends TransportParticipantKind = TransportParticipantKind,
> = Kind extends "broker"
  ? {
      /** Stable logical participant kind. */
      readonly participantKind: "broker";
      /** Stable logical participant identity. */
      readonly participantId: string;
      /** Brokers do not have worker roles. */
      readonly workerRole?: never;
    }
  : Kind extends "worker"
    ? {
        /** Stable logical participant kind. */
        readonly participantKind: "worker";
        /** Stable logical participant identity. */
        readonly participantId: string;
        /** Stable logical worker role. */
        readonly workerRole: TransportWorkerRole;
      }
    : never;

/** Immutable transport participant identity. */
export interface TransportParticipantIdentity<
  Kind extends TransportParticipantKind = TransportParticipantKind,
> {
  /** Stable logical participant kind. */
  readonly participantKind: Kind;
  /** Stable logical participant identity. */
  readonly participantId: string;
  /** Stable deterministic participant key. */
  readonly participantKey: string;
  /** Worker role when `participantKind` is `worker`. */
  readonly workerRole?: Kind extends "worker" ? TransportWorkerRole : never;
}

/** Immutable worker registration owned by the transport lifecycle seam. */
export interface TransportWorkerRegistration {
  /** Stable worker identity. */
  readonly worker: TransportParticipantIdentity<"worker">;
  /** Logical subscriptions owned by this worker. */
  readonly subscriptions: readonly TransportSubscription[];
  /** Deterministic sorted signal kinds covered by the subscriptions. */
  readonly signalKinds: readonly TransportSignalKind[];
  /** Deterministic worker registration key. */
  readonly registrationKey: string;
}

/** Input for one worker registration. */
export interface TransportWorkerRegistrationInput {
  /** Stable worker identity in canonical input form. */
  readonly worker: TransportParticipantIdentityInput<"worker">;
  /** Logical subscriptions covered by the worker. */
  readonly subscriptions: readonly (TransportSubscriptionInput | TransportSubscription)[];
}

/** Immutable lifecycle snapshot for one broker or worker participant. */
export interface TransportLifecycleSnapshot<
  Kind extends TransportParticipantKind = TransportParticipantKind,
> {
  /** Stable logical participant identity. */
  readonly participant: TransportParticipantIdentity<Kind>;
  /** Current deterministic lifecycle state. */
  readonly state: TransportLifecycleState;
  /** Current readiness state. */
  readonly readiness: TransportReadinessState;
  /** Worker registrations attached to this snapshot. Empty for brokers. */
  readonly workerRegistrations: readonly TransportWorkerRegistration[];
}

/** Input for one lifecycle snapshot. */
export interface TransportLifecycleSnapshotInput<
  Kind extends TransportParticipantKind = TransportParticipantKind,
> {
  /** Stable logical participant identity in canonical input form. */
  readonly participant: TransportParticipantIdentityInput<Kind>;
  /** Current deterministic lifecycle state. */
  readonly state: TransportLifecycleState;
  /** Current readiness state. */
  readonly readiness: TransportReadinessState;
  /** Worker registrations attached to this snapshot. */
  readonly workerRegistrations?: readonly (
    TransportWorkerRegistrationInput | TransportWorkerRegistration
  )[];
}

/** Runtime-facing lifecycle participant contract. */
export interface TransportLifecycleParticipant<
  Kind extends TransportParticipantKind = TransportParticipantKind,
> extends AsyncCloseable {
  /** Stable logical participant identity. */
  readonly identity: TransportParticipantIdentity<Kind>;
  /** Current lifecycle state. */
  readonly state: TransportLifecycleState;
  /** Current readiness state. */
  readonly readiness: TransportReadinessState;
}

/** Transport-visible delivery state, not a durable inbox record state machine. */
export type TransportDeliveryStatus = "to-deliver" | "delivered" | "failed";

const transportDeliveryStatuses = ["to-deliver", "delivered", "failed"] as const;
const transportDeliveryStatusSet = new Set<string>(transportDeliveryStatuses);

/** Terminal observation reported for one delivery attempt. */
export type TransportDeliveryOutcome = "delivered" | "failed";

const transportDeliveryOutcomes = ["delivered", "failed"] as const;
const transportDeliveryOutcomeSet = new Set<string>(transportDeliveryOutcomes);

/** Adapter-agnostic delivery failure taxonomy. */
export type TransportDeliveryFailureKind =
  "duplicate" | "permanent" | "resource-exhausted" | "transient" | "unknown";

const transportDeliveryFailureKinds = [
  "duplicate",
  "permanent",
  "resource-exhausted",
  "transient",
  "unknown",
] as const;
const transportDeliveryFailureKindSet = new Set<string>(transportDeliveryFailureKinds);

/** Retry boundary data for policy consumers. Transport helpers do not execute retries. */
export type TransportRetryEligibility = "eligible" | "ineligible";

/** Scalar diagnostic value safe to expose at the transport boundary. */
export type TransportDeliveryFailureDetailValue = string | number | boolean | null;

/** Redacted, copy-safe failure details. */
export type TransportDeliveryFailureDetails = Readonly<
  Record<string, TransportDeliveryFailureDetailValue>
>;

const safeFailureDetailKeys = new Set(["attempt", "code", "reason", "retryable", "stage"]);

/** Input for classifying one delivery failure. */
export interface TransportDeliveryFailureClassificationInput {
  /** Stable transport-level failure kind. */
  readonly failureKind: TransportDeliveryFailureKind;
  /** Stable framework-owned code, not an exception message. */
  readonly failureCode: string;
  /** Optional raw diagnostic data; helpers keep only safe scalar fields. */
  readonly details?: unknown;
}

/** Immutable delivery failure classification and retry eligibility. */
export interface TransportDeliveryFailureClassification {
  /** Stable transport-level failure kind. */
  readonly failureKind: TransportDeliveryFailureKind;
  /** Boundary signal for later retry policy. */
  readonly retryEligibility: TransportRetryEligibility;
  /** Stable framework-owned code, not an exception message. */
  readonly failureCode: string;
  /** Redacted, scalar-only details. */
  readonly details: TransportDeliveryFailureDetails;
}

/** Input for one delivery attempt boundary value. */
export interface TransportDeliveryAttemptInput<
  Kind extends TransportSignalKind = TransportSignalKind,
> {
  /** Stable signal/delivery identity supplied by an upstream package. */
  readonly deliveryId: string;
  /** Logical target identity within the subscription boundary. */
  readonly targetId: string;
  /** Positive 1-based attempt number. */
  readonly attemptNumber: number;
  /** Logical transport subscription for the attempted delivery. */
  readonly subscription: TransportSubscriptionInput<Kind> | TransportSubscription<Kind>;
  /** Worker identity associated with the attempt. */
  readonly worker:
    TransportParticipantIdentityInput<"worker"> | TransportParticipantIdentity<"worker">;
  /** Optional prebuilt key; rejected when it does not match semantic fields. */
  readonly attemptKey?: string;
}

/** Immutable delivery attempt evidence over transport subscriptions and workers. */
export interface TransportDeliveryAttempt<Kind extends TransportSignalKind = TransportSignalKind> {
  /** Stable signal/delivery identity supplied by an upstream package. */
  readonly deliveryId: string;
  /** Logical target identity within the subscription boundary. */
  readonly targetId: string;
  /** Positive 1-based attempt number. */
  readonly attemptNumber: number;
  /** Copy-safe transport subscription. */
  readonly subscription: TransportSubscription<Kind>;
  /** Copy-safe worker identity. */
  readonly worker: TransportParticipantIdentity<"worker">;
  /** Deterministic key derived from subscription, worker, delivery, target, and attempt. */
  readonly attemptKey: string;
}

interface TransportDeliveryResultInputBase<Kind extends TransportSignalKind> {
  /** Attempt evidence being classified. */
  readonly attempt: TransportDeliveryAttemptInput<Kind> | TransportDeliveryAttempt<Kind>;
  /** Optional prebuilt key; rejected when it does not match semantic fields. */
  readonly resultKey?: string;
}

/** Input for deriving one immutable delivered result. */
type TransportDeliveredResultInput<Kind extends TransportSignalKind = TransportSignalKind> =
  TransportDeliveryResultInputBase<Kind> & {
    /** Attempt outcome observed at the boundary. */
    readonly outcome: "delivered";
    /** Failure data is forbidden for delivered outcomes. */
    readonly failure?: never;
    /** Optional prebuilt status; rejected when it does not match outcome data. */
    readonly status?: Extract<TransportDeliveryStatus, "delivered">;
  };

/** Input for deriving one immutable failed result. */
type TransportFailedResultInput<Kind extends TransportSignalKind = TransportSignalKind> =
  TransportDeliveryResultInputBase<Kind> & {
    /** Attempt outcome observed at the boundary. */
    readonly outcome: "failed";
    /** Failure data required for failed outcomes. */
    readonly failure:
      TransportDeliveryFailureClassificationInput | TransportDeliveryFailureClassification;
    /** Optional prebuilt status; rejected when it does not match outcome data. */
    readonly status?: Extract<TransportDeliveryStatus, "failed">;
  };

/** Input for deriving one immutable delivery result. */
export type TransportDeliveryResultInput<Kind extends TransportSignalKind = TransportSignalKind> =
  TransportDeliveredResultInput<Kind> | TransportFailedResultInput<Kind>;

/** Immutable delivery result with derived retry eligibility. */
export interface TransportDeliveryResult<Kind extends TransportSignalKind = TransportSignalKind> {
  /** Attempt evidence being classified. */
  readonly attempt: TransportDeliveryAttempt<Kind>;
  /** Attempt outcome observed at the boundary. */
  readonly outcome: TransportDeliveryOutcome;
  /** Status derived from the delivery outcome. */
  readonly status: TransportDeliveryStatus;
  /** Retry boundary data for later policy consumers. */
  readonly retryEligibility: TransportRetryEligibility;
  /** Failure classification for failed outcomes. */
  readonly failure?: TransportDeliveryFailureClassification;
  /** Deterministic key derived from the attempt key and result status. */
  readonly resultKey: string;
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

/** Create an immutable transport participant identity. */
export function createTransportParticipantIdentity(
  input: TransportParticipantIdentityInput<"broker">,
): TransportParticipantIdentity<"broker">;
/** Create an immutable transport participant identity. */
export function createTransportParticipantIdentity(
  input: TransportParticipantIdentityInput<"worker">,
): TransportParticipantIdentity<"worker">;
/** Create an immutable transport participant identity. */
export function createTransportParticipantIdentity(
  input: TransportParticipantIdentityInput,
): TransportParticipantIdentity;
/** Create an immutable transport participant identity. */
export function createTransportParticipantIdentity(
  input: TransportParticipantIdentityInput,
): TransportParticipantIdentity {
  const participantKind = normalizeTransportParticipantKind(input.participantKind);
  const participantId = normalizeLogicalTransportId(input.participantId, "participantId");

  if (participantKind === "worker") {
    const workerRole = normalizeTransportWorkerRole(input.workerRole);

    return Object.freeze({
      participantKind,
      participantId,
      participantKey: `${participantKind}#${encodeRoutingSegment(workerRole)}#${encodeRoutingSegment(participantId)}`,
      workerRole,
    });
  }

  if (input.workerRole !== undefined) {
    throw new Error("Transport broker participants must not declare workerRole.");
  }

  return Object.freeze({
    participantKind,
    participantId,
    participantKey: `${participantKind}#${encodeRoutingSegment(participantId)}`,
  });
}

/** Create an immutable worker registration over transport subscriptions. */
export function createTransportWorkerRegistration(
  input: TransportWorkerRegistrationInput,
): TransportWorkerRegistration {
  const worker = normalizeWorkerParticipant(input.worker);
  const subscriptions = normalizeWorkerSubscriptions(input.subscriptions, worker.participantId);
  const signalKinds = Object.freeze(
    [...new Set(subscriptions.map((subscription) => subscription.topic.signalKind))].sort(
      compareTransportStrings,
    ),
  );

  return Object.freeze({
    worker,
    subscriptions,
    signalKinds,
    registrationKey: `${worker.participantKey}#${subscriptions
      .map((subscription) => subscription.descriptorKey)
      .join("|")}`,
  });
}

/** Create an immutable lifecycle snapshot for one broker or worker participant. */
export function createTransportLifecycleSnapshot<Kind extends TransportParticipantKind>(
  input: TransportLifecycleSnapshotInput<Kind>,
): TransportLifecycleSnapshot<Kind> {
  const participant = normalizeTransportLifecycleParticipant(input.participant);
  const state = normalizeTransportLifecycleState(input.state);
  const readiness = normalizeTransportReadinessState(input.readiness);
  const workerRegistrations = normalizeWorkerRegistrations(input.workerRegistrations);

  if (readiness === "ready" && state !== "running") {
    throw new Error("Transport ready participants must be running.");
  }

  if (participant.participantKind === "broker") {
    if (workerRegistrations.length > 0) {
      throw new Error("Transport brokers must not include worker registrations.");
    }
  } else {
    if (readiness === "ready" && workerRegistrations.length === 0) {
      throw new Error("Transport ready workers must include at least one worker registration.");
    }

    for (const registration of workerRegistrations) {
      if (registration.worker.participantKey !== participant.participantKey) {
        throw new Error(
          "Transport worker registration participant must match snapshot participant.",
        );
      }
    }
  }

  return Object.freeze({
    participant,
    state,
    readiness,
    workerRegistrations,
  }) as TransportLifecycleSnapshot<Kind>;
}

/** Create immutable delivery attempt evidence from logical transport fields. */
export function createTransportDeliveryAttempt<Kind extends TransportSignalKind>(
  input: TransportDeliveryAttemptInput<Kind>,
): TransportDeliveryAttempt<Kind> {
  const deliveryId = normalizeDeliveryBoundaryId(input.deliveryId, "deliveryId");
  const targetId = normalizeDeliveryBoundaryId(input.targetId, "targetId");
  const attemptNumber = normalizeAttemptNumber(input.attemptNumber);
  const subscription = normalizeDeliverySubscription(input.subscription);
  const worker = normalizeDeliveryWorker(input.worker);

  if (worker.participantId !== subscription.subscriberId) {
    throw new Error(
      "Transport delivery worker participantId must match subscription subscriberId.",
    );
  }

  const attemptKey = createDeliveryAttemptKey({
    subscription,
    worker,
    deliveryId,
    targetId,
    attemptNumber,
  });

  if (input.attemptKey !== undefined && input.attemptKey !== attemptKey) {
    throw new Error("Transport delivery attemptKey must match semantic delivery fields.");
  }

  return Object.freeze({
    deliveryId,
    targetId,
    attemptNumber,
    subscription,
    worker,
    attemptKey,
  });
}

/** Classify a delivery failure without exposing raw exception or process details. */
export function classifyTransportDeliveryFailure(
  input: TransportDeliveryFailureClassificationInput,
): TransportDeliveryFailureClassification {
  const failureKind = normalizeTransportDeliveryFailureKind(input.failureKind);
  const failureCode = normalizeFailureCode(input.failureCode);
  const retryEligibility = deriveRetryEligibility(failureKind);
  const details = sanitizeFailureDetails(input.details);

  return Object.freeze({
    failureKind,
    retryEligibility,
    failureCode,
    details,
  });
}

/** Derive an immutable delivery result and validate any supplied derived status/key. */
export function createTransportDeliveryResult<Kind extends TransportSignalKind>(
  input: TransportDeliveryResultInput<Kind>,
): TransportDeliveryResult<Kind> {
  const attempt = createTransportDeliveryAttempt(input.attempt);
  const outcome = normalizeTransportDeliveryOutcome(input.outcome);
  const failure = normalizeDeliveryResultFailure(outcome, input.failure);
  const retryEligibility = failure?.retryEligibility ?? "ineligible";
  const status = deriveDeliveryResultStatus(outcome);
  const resultKey = `${attempt.attemptKey}#${status}`;

  if (input.status !== undefined && normalizeTransportDeliveryStatus(input.status) !== status) {
    throw new Error("Transport delivery status must match delivery outcome.");
  }

  if (input.resultKey !== undefined && input.resultKey !== resultKey) {
    throw new Error("Transport delivery resultKey must match semantic result fields.");
  }

  return Object.freeze({
    attempt,
    outcome,
    status,
    retryEligibility,
    ...(failure === undefined ? {} : { failure }),
    resultKey,
  });
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

function normalizeTransportParticipantKind<Kind extends TransportParticipantKind>(
  value: Kind,
): Kind {
  const participantKind = normalizeRequiredText(value, "participantKind");

  if (!transportParticipantKindSet.has(participantKind)) {
    throw new Error(
      `Transport participantKind must be one of: ${transportParticipantKinds.join(", ")}.`,
    );
  }

  return participantKind as Kind;
}

function normalizeTransportWorkerRole(value: string | undefined): TransportWorkerRole {
  if (value === undefined) {
    throw new Error(`Transport workerRole must be one of: ${transportWorkerRoles.join(", ")}.`);
  }

  const workerRole = normalizeRequiredText(value, "workerRole");

  if (!transportWorkerRoleSet.has(workerRole)) {
    throw new Error(`Transport workerRole must be one of: ${transportWorkerRoles.join(", ")}.`);
  }

  return workerRole as TransportWorkerRole;
}

function normalizeTransportLifecycleState(value: string): TransportLifecycleState {
  const state = normalizeRequiredText(value, "state");

  if (!transportLifecycleStateSet.has(state)) {
    throw new Error(`Transport state must be one of: ${transportLifecycleStates.join(", ")}.`);
  }

  return state as TransportLifecycleState;
}

function normalizeTransportReadinessState(value: string): TransportReadinessState {
  const readiness = normalizeRequiredText(value, "readiness");

  if (!transportReadinessStateSet.has(readiness)) {
    throw new Error(`Transport readiness must be one of: ${transportReadinessStates.join(", ")}.`);
  }

  return readiness as TransportReadinessState;
}

function normalizeTransportSubscriptionMode(value: string): TransportSubscriptionMode {
  const mode = normalizeRequiredText(value, "mode");

  if (!transportSubscriptionModeSet.has(mode)) {
    throw new Error(`Transport mode must be one of: ${transportSubscriptionModes.join(", ")}.`);
  }

  return mode as TransportSubscriptionMode;
}

function normalizeTransportDeliveryStatus(value: string): TransportDeliveryStatus {
  const status = normalizeRequiredText(value, "status");

  if (!transportDeliveryStatusSet.has(status)) {
    throw new Error(`Transport status must be one of: ${transportDeliveryStatuses.join(", ")}.`);
  }

  return status as TransportDeliveryStatus;
}

function normalizeTransportDeliveryOutcome(value: string): TransportDeliveryOutcome {
  const outcome = normalizeRequiredText(value, "outcome");

  if (!transportDeliveryOutcomeSet.has(outcome)) {
    throw new Error(`Transport outcome must be one of: ${transportDeliveryOutcomes.join(", ")}.`);
  }

  return outcome as TransportDeliveryOutcome;
}

function normalizeTransportDeliveryFailureKind(value: string): TransportDeliveryFailureKind {
  const failureKind = normalizeRequiredText(value, "failureKind");

  if (!transportDeliveryFailureKindSet.has(failureKind)) {
    throw new Error(
      `Transport failureKind must be one of: ${transportDeliveryFailureKinds.join(", ")}.`,
    );
  }

  return failureKind as TransportDeliveryFailureKind;
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

function normalizeTransportLifecycleParticipant(
  value: TransportParticipantIdentityInput,
): TransportParticipantIdentity {
  return createTransportParticipantIdentity(value);
}

function normalizeWorkerParticipant(
  value: TransportParticipantIdentityInput,
): TransportParticipantIdentity<"worker"> {
  const participant = createTransportParticipantIdentity(value);

  if (!isTransportWorkerParticipant(participant)) {
    throw new Error("Transport worker must be a worker participant.");
  }

  return participant;
}

function isTransportWorkerParticipant(
  participant: TransportParticipantIdentity,
): participant is TransportParticipantIdentity<"worker"> {
  return participant.participantKind === "worker";
}

function normalizeWorkerSubscriptions(
  subscriptions: readonly (TransportSubscriptionInput | TransportSubscription)[],
  workerId: string,
): readonly TransportSubscription[] {
  if (subscriptions.length === 0) {
    throw new Error("Transport subscriptions must not be empty.");
  }

  return Object.freeze(
    subscriptions
      .map((subscription) => {
        const normalized = createTransportSubscription({
          subscriberId: subscription.subscriberId,
          ...(subscription.mode === undefined ? {} : { mode: subscription.mode }),
          topic: subscription.topic,
        });

        if (normalized.subscriberId !== workerId) {
          throw new Error(
            "Transport worker registration subscriptions must use the worker participantId as subscriberId.",
          );
        }

        return normalized;
      })
      .sort((left, right) => compareTransportStrings(left.descriptorKey, right.descriptorKey)),
  );
}

function normalizeWorkerRegistrations(
  registrations:
    readonly (TransportWorkerRegistrationInput | TransportWorkerRegistration)[] | undefined,
): readonly TransportWorkerRegistration[] {
  if (registrations === undefined || registrations.length === 0) {
    return Object.freeze([]);
  }

  return Object.freeze(
    registrations.map((registration) => {
      const workerRole = normalizeTransportWorkerRole(registration.worker.workerRole);

      return createTransportWorkerRegistration({
        worker: {
          participantKind: "worker",
          participantId: registration.worker.participantId,
          workerRole,
        },
        subscriptions: registration.subscriptions,
      });
    }),
  );
}

function normalizeDeliverySubscription<Kind extends TransportSignalKind>(
  value: TransportSubscriptionInput<Kind> | TransportSubscription<Kind>,
): TransportSubscription<Kind> {
  const subscription = createTransportSubscription({
    subscriberId: value.subscriberId,
    ...(value.mode === undefined ? {} : { mode: value.mode }),
    topic: value.topic,
  });

  if ("descriptorKey" in value && value.descriptorKey !== subscription.descriptorKey) {
    throw new Error("Transport delivery subscription descriptorKey must match semantic fields.");
  }

  return subscription;
}

function normalizeDeliveryWorker(
  value: TransportParticipantIdentityInput<"worker"> | TransportParticipantIdentity<"worker">,
): TransportParticipantIdentity<"worker"> {
  const workerRole = normalizeTransportWorkerRole(value.workerRole);
  const worker = createTransportParticipantIdentity({
    participantKind: "worker",
    participantId: value.participantId,
    workerRole,
  });

  if ("participantKey" in value && value.participantKey !== worker.participantKey) {
    throw new Error("Transport delivery worker participantKey must match semantic fields.");
  }

  return worker;
}

function normalizeAttemptNumber(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Transport attemptNumber must be a safe positive integer.");
  }

  return value;
}

function normalizeDeliveryBoundaryId(value: string, name: string): string {
  const normalized = normalizeRequiredText(value, name);

  if (/\s/u.test(normalized) || normalized.includes("://") || /[/@]/u.test(normalized)) {
    throw new Error(
      `Transport ${name} must be a compact delivery identity, not an endpoint, path, hostname, or payload.`,
    );
  }

  return normalized;
}

function normalizeFailureCode(value: string): string {
  const failureCode = normalizeRequiredText(value, "failureCode");

  if (!/^[A-Za-z][A-Za-z0-9_-]*$/u.test(failureCode)) {
    throw new Error("Transport failureCode must use stable code format.");
  }

  return failureCode;
}

function deriveRetryEligibility(
  failureKind: TransportDeliveryFailureKind,
): TransportRetryEligibility {
  return failureKind === "transient" || failureKind === "resource-exhausted"
    ? "eligible"
    : "ineligible";
}

function sanitizeFailureDetails(details: unknown): TransportDeliveryFailureDetails {
  if (details === undefined || details === null || typeof details !== "object") {
    return Object.freeze({});
  }

  const sanitized: Record<string, TransportDeliveryFailureDetailValue> = {};

  for (const key of Object.keys(details).sort(compareTransportStrings)) {
    if (!isSafeFailureDetailKey(key)) {
      continue;
    }

    const descriptor = Object.getOwnPropertyDescriptor(details, key);

    if (descriptor === undefined || !("value" in descriptor)) {
      continue;
    }

    const value = descriptor.value as unknown;

    if (isTransportDeliveryFailureDetailValue(value)) {
      sanitized[key] = value;
    }
  }

  return Object.freeze(sanitized);
}

function isSafeFailureDetailKey(key: string): boolean {
  return safeFailureDetailKeys.has(key);
}

function isTransportDeliveryFailureDetailValue(
  value: unknown,
): value is TransportDeliveryFailureDetailValue {
  return value === null || ["boolean", "number", "string"].includes(typeof value);
}

function normalizeDeliveryResultFailure(
  outcome: TransportDeliveryOutcome,
  failure:
    | TransportDeliveryFailureClassificationInput
    | TransportDeliveryFailureClassification
    | undefined,
): TransportDeliveryFailureClassification | undefined {
  if (outcome === "delivered") {
    if (failure !== undefined) {
      throw new Error("Transport delivered results must not include failure data.");
    }

    return undefined;
  }

  if (failure === undefined) {
    throw new Error("Transport failed delivery results must include failure data.");
  }

  return classifyTransportDeliveryFailure(failure);
}

function deriveDeliveryResultStatus(outcome: TransportDeliveryOutcome): TransportDeliveryStatus {
  if (outcome === "delivered") {
    return "delivered";
  }

  return "failed";
}

function createDeliveryAttemptKey(input: {
  readonly subscription: TransportSubscription;
  readonly worker: TransportParticipantIdentity<"worker">;
  readonly deliveryId: string;
  readonly targetId: string;
  readonly attemptNumber: number;
}): string {
  return [
    input.subscription.descriptorKey,
    input.worker.participantKey,
    encodeRoutingSegment(input.deliveryId),
    encodeRoutingSegment(input.targetId),
    String(input.attemptNumber),
  ].join("#");
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
