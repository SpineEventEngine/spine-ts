import { deriveTypeUrl } from "@spine-ts/core";
import {
  createTransportSubscription,
  createTransportTopic,
  createTransportWorkerRegistration,
  type TransportSubscription,
  type TransportTopic,
  type TransportWorkerRegistration,
} from "@spine-ts/transport";
import { type BuiltBoundedContextSnapshot, BoundedContext } from "./bounded-context.js";
import {
  type CommandRegistrationAssigneeMetadata,
  type CommandRegistrationReadinessLookup,
} from "./command-registration-readiness.js";
import {
  type EventRegistrationApplicationMetadata,
  type EventRegistrationReadinessLookup,
  type EventRegistrationReactorMetadata,
  type EventRegistrationSubscriberMetadata,
} from "./event-registration-readiness.js";
import { compareFullTypeNames } from "./registration-readiness-metadata.js";

/** Input accepted by {@link createServerRuntimeRoutingPlan}. */
export interface ServerRuntimeRoutingPlanInput {
  /** Built bounded-context metadata shell that owns the routing plan. */
  readonly context: BoundedContext;
  /** Optional command readiness lookup used to derive command routing. */
  readonly commands?: CommandRegistrationReadinessLookup;
  /** Optional event readiness lookup used to derive event routing. */
  readonly events?: EventRegistrationReadinessLookup;
}

/** Explicit deferred routing seam for unsupported runtime signal kinds. */
export interface DeferredServerRuntimeRoutingSeam {
  /** Signal kind intentionally deferred in this slice. */
  readonly signalKind: "query" | "subscription" | "system";
  /** Stable status for deferred runtime seams. */
  readonly status: "deferred";
  /** Human-readable reason kept deliberately narrow and deterministic. */
  readonly reason: string;
}

/** Command routing entry owned by the server runtime planner. */
export interface CommandRuntimeRoutingRoute {
  /** Registered command message full type name. */
  readonly commandFullTypeName: string;
  /** Command transport topic for the message type. */
  readonly topic: TransportTopic<"command">;
  /** Competing-consumer command worker subscription. */
  readonly subscription: TransportSubscription<"command">;
  /** Command worker registration that owns the subscription. */
  readonly worker: TransportWorkerRegistration;
  /** Copy-safe command readiness metadata for the unique assignee. */
  readonly assignee: CommandRegistrationAssigneeMetadata;
}

/** Command routing plan derived from command readiness. */
export interface CommandRuntimeRoutingPlan {
  /** Deterministic command topics. */
  readonly topics: readonly TransportTopic<"command">[];
  /** Deterministic competing-consumer subscriptions for the command worker. */
  readonly subscriptions: readonly TransportSubscription<"command">[];
  /** Worker registrations suitable for later command-worker wiring. */
  readonly workers: readonly TransportWorkerRegistration[];
  /** Command routes retaining assignee metadata without invoking handlers. */
  readonly routes: readonly CommandRuntimeRoutingRoute[];
}

interface BaseEventRuntimeRoutingRoute<Receiver> {
  /** Registered event message full type name. */
  readonly eventFullTypeName: string;
  /** Event transport topic for the message type. */
  readonly topic: TransportTopic<"event">;
  /** Fan-out subscription for one logical event receiver. */
  readonly subscription: TransportSubscription<"event">;
  /** Event worker registration that owns the subscription. */
  readonly worker: TransportWorkerRegistration;
  /** Copy-safe readiness metadata for the logical event receiver. */
  readonly receiver: Receiver;
}

/** Subscriber fan-out route owned by the server runtime planner. */
export interface EventSubscriberRuntimeRoutingRoute extends BaseEventRuntimeRoutingRoute<EventRegistrationSubscriberMetadata> {
  /** Stable receiver group marker. */
  readonly group: "subscriber";
}

/** Reactor fan-out route owned by the server runtime planner. */
export interface EventReactorRuntimeRoutingRoute extends BaseEventRuntimeRoutingRoute<EventRegistrationReactorMetadata> {
  /** Stable receiver group marker. */
  readonly group: "reactor";
}

/** Event-application fan-out route owned by the server runtime planner. */
export interface EventApplicationRuntimeRoutingRoute extends BaseEventRuntimeRoutingRoute<EventRegistrationApplicationMetadata> {
  /** Stable receiver group marker. */
  readonly group: "application";
}

/** Event routing plan derived from event readiness. */
export interface EventRuntimeRoutingPlan {
  /** Deterministic event topics. */
  readonly topics: readonly TransportTopic<"event">[];
  /** Deterministic fan-out subscriptions across all event receiver groups. */
  readonly subscriptions: readonly TransportSubscription<"event">[];
  /** Worker registrations suitable for later event-worker wiring. */
  readonly workers: readonly TransportWorkerRegistration[];
  /** Subscriber fan-out routes. */
  readonly subscriberRoutes: readonly EventSubscriberRuntimeRoutingRoute[];
  /** Reactor fan-out routes. */
  readonly reactorRoutes: readonly EventReactorRuntimeRoutingRoute[];
  /** Event-application fan-out routes. */
  readonly applicationRoutes: readonly EventApplicationRuntimeRoutingRoute[];
}

/** Immutable runtime routing plan derived from server metadata only. */
export interface ServerRuntimeRoutingPlan {
  /** Copy-safe built bounded-context metadata that owns the routing plan. */
  readonly context: BuiltBoundedContextSnapshot;
  /** Command routing metadata derived from command readiness. */
  readonly commands: CommandRuntimeRoutingPlan;
  /** Event routing metadata derived from event readiness. */
  readonly events: EventRuntimeRoutingPlan;
  /** Explicit deferred seams for unsupported signal kinds. */
  readonly deferred: readonly DeferredServerRuntimeRoutingSeam[];
}

interface CommandRouteDraft {
  readonly commandFullTypeName: string;
  readonly topic: TransportTopic<"command">;
  readonly subscription: TransportSubscription<"command">;
  readonly assignee: CommandRegistrationAssigneeMetadata;
}

interface EventRouteDraft<Receiver> {
  readonly eventFullTypeName: string;
  readonly topic: TransportTopic<"event">;
  readonly subscription: TransportSubscription<"event">;
  readonly receiver: Receiver;
  readonly workerId: string;
}

type EventRouteGroup = "application" | "reactor" | "subscriber";
type EventReceiver =
  | EventRegistrationApplicationMetadata
  | EventRegistrationReactorMetadata
  | EventRegistrationSubscriberMetadata;

/** Create an immutable runtime routing plan from bounded-context and readiness metadata. */
export function createServerRuntimeRoutingPlan(
  input: ServerRuntimeRoutingPlanInput,
): ServerRuntimeRoutingPlan {
  const context = validateContext(input);
  const contextSnapshot = context.snapshot;
  const commands = createCommandRuntimeRoutingPlan(contextSnapshot, input.commands);
  const events = createEventRuntimeRoutingPlan(contextSnapshot, input.events);

  return Object.freeze({
    context: contextSnapshot,
    commands,
    events,
    deferred: createDeferredSeams(),
  });
}

function createCommandRuntimeRoutingPlan(
  context: BuiltBoundedContextSnapshot,
  readiness: CommandRegistrationReadinessLookup | undefined,
): CommandRuntimeRoutingPlan {
  if (readiness === undefined) {
    return createEmptyCommandPlan();
  }

  validateCommandReadinessLookup(readiness);
  const workerId = createLogicalName(context.name.value, "command", "worker");
  const commandFullTypeNames = normalizeRegisteredMessageNames(
    readiness.registeredCommandMessageFullTypeNames(),
    "command",
  );
  const routeDrafts = commandFullTypeNames.map((commandFullTypeName) => {
    const assignee = readiness.findCommandAssignee(commandFullTypeName);

    if (assignee === undefined) {
      throw new TypeError(
        `Command registration readiness must return assignee metadata for "${commandFullTypeName}".`,
      );
    }
    if (assignee.commandFullTypeName !== commandFullTypeName) {
      throw new TypeError(
        `Command assignee metadata for "${commandFullTypeName}" must preserve commandFullTypeName.`,
      );
    }

    const topic = createTransportTopic({
      signalKind: "command",
      messageTypeUrl: deriveTypeUrl(assignee.handler.schema),
    });
    const subscription = createTransportSubscription({
      subscriberId: workerId,
      topic,
      mode: "competing-consumer",
    });

    return Object.freeze({
      commandFullTypeName,
      topic,
      subscription,
      assignee,
    }) satisfies CommandRouteDraft;
  });

  if (routeDrafts.length === 0) {
    return createEmptyCommandPlan();
  }

  const worker = createTransportWorkerRegistration({
    worker: {
      participantKind: "worker",
      participantId: workerId,
      workerRole: "command-worker",
    },
    subscriptions: routeDrafts.map(({ subscription }) => subscription),
  });
  const routes = Object.freeze(
    routeDrafts.map((route) =>
      Object.freeze({
        ...route,
        worker,
      }),
    ),
  );

  return Object.freeze({
    topics: Object.freeze(routeDrafts.map(({ topic }) => topic)),
    subscriptions: Object.freeze(routeDrafts.map(({ subscription }) => subscription)),
    workers: Object.freeze([worker]),
    routes,
  });
}

function createEventRuntimeRoutingPlan(
  context: BuiltBoundedContextSnapshot,
  readiness: EventRegistrationReadinessLookup | undefined,
): EventRuntimeRoutingPlan {
  if (readiness === undefined) {
    return createEmptyEventPlan();
  }

  validateEventReadinessLookup(readiness);
  const eventFullTypeNames = normalizeRegisteredMessageNames(
    readiness.registeredEventMessageFullTypeNames(),
    "event",
  );
  const topicByEventFullTypeName = new Map<string, TransportTopic<"event">>();
  const subscriberDrafts: EventRouteDraft<EventRegistrationSubscriberMetadata>[] = [];
  const reactorDrafts: EventRouteDraft<EventRegistrationReactorMetadata>[] = [];
  const applicationDrafts: EventRouteDraft<EventRegistrationApplicationMetadata>[] = [];

  for (const eventFullTypeName of eventFullTypeNames) {
    const subscribers = normalizeEventReceivers(
      readiness.findEventSubscribers(eventFullTypeName),
      eventFullTypeName,
      "subscriber",
    ) as readonly EventRegistrationSubscriberMetadata[];
    const reactors = normalizeEventReceivers(
      readiness.findEventReactors(eventFullTypeName),
      eventFullTypeName,
      "reactor",
    ) as readonly EventRegistrationReactorMetadata[];
    const applications = normalizeEventReceivers(
      readiness.findEventApplications(eventFullTypeName),
      eventFullTypeName,
      "application",
    ) as readonly EventRegistrationApplicationMetadata[];
    const firstReceiver = subscribers[0] ?? reactors[0] ?? applications[0];

    if (firstReceiver === undefined) {
      throw new TypeError(
        `Event registration readiness must return at least one receiver for "${eventFullTypeName}".`,
      );
    }

    const topic = createTransportTopic({
      signalKind: "event",
      messageTypeUrl: deriveTypeUrl(firstReceiver.handler.schema),
    });

    topicByEventFullTypeName.set(eventFullTypeName, topic);
    subscriberDrafts.push(
      ...(createEventRouteDrafts(
        context,
        topic,
        eventFullTypeName,
        subscribers,
      ) as readonly EventRouteDraft<EventRegistrationSubscriberMetadata>[]),
    );
    reactorDrafts.push(
      ...(createEventRouteDrafts(
        context,
        topic,
        eventFullTypeName,
        reactors,
      ) as readonly EventRouteDraft<EventRegistrationReactorMetadata>[]),
    );
    applicationDrafts.push(
      ...(createEventRouteDrafts(
        context,
        topic,
        eventFullTypeName,
        applications,
      ) as readonly EventRouteDraft<EventRegistrationApplicationMetadata>[]),
    );
  }

  if (
    subscriberDrafts.length === 0 &&
    reactorDrafts.length === 0 &&
    applicationDrafts.length === 0 &&
    topicByEventFullTypeName.size === 0
  ) {
    return createEmptyEventPlan();
  }

  const workersById = createEventWorkersById([
    ...subscriberDrafts,
    ...reactorDrafts,
    ...applicationDrafts,
  ]);
  const subscriberRoutes = Object.freeze(
    subscriberDrafts.map((route) =>
      Object.freeze({
        ...route,
        group: "subscriber" as const,
        worker: getWorkerRegistration(workersById, route.workerId),
      }),
    ),
  );
  const reactorRoutes = Object.freeze(
    reactorDrafts.map((route) =>
      Object.freeze({
        ...route,
        group: "reactor" as const,
        worker: getWorkerRegistration(workersById, route.workerId),
      }),
    ),
  );
  const applicationRoutes = Object.freeze(
    applicationDrafts.map((route) =>
      Object.freeze({
        ...route,
        group: "application" as const,
        worker: getWorkerRegistration(workersById, route.workerId),
      }),
    ),
  );
  const subscriptions = Object.freeze(
    [...subscriberRoutes, ...reactorRoutes, ...applicationRoutes]
      .map(({ subscription }) => subscription)
      .sort((left, right) => compareFullTypeNames(left.descriptorKey, right.descriptorKey)),
  );
  const workers = Object.freeze(
    [...workersById.values()].sort((left, right) =>
      compareFullTypeNames(left.registrationKey, right.registrationKey),
    ),
  );

  return Object.freeze({
    topics: Object.freeze([...topicByEventFullTypeName.values()]),
    subscriptions,
    workers,
    subscriberRoutes,
    reactorRoutes,
    applicationRoutes,
  });
}

function createDeferredSeams(): readonly DeferredServerRuntimeRoutingSeam[] {
  return Object.freeze([
    createDeferredSeam(
      "query",
      "Query routing remains deferred until server query-readiness metadata exists.",
    ),
    createDeferredSeam(
      "subscription",
      "Subscription routing remains deferred until server subscription-readiness metadata exists.",
    ),
    createDeferredSeam(
      "system",
      "System routing remains deferred until server system-readiness metadata exists.",
    ),
  ]);
}

function createDeferredSeam(
  signalKind: DeferredServerRuntimeRoutingSeam["signalKind"],
  reason: string,
): DeferredServerRuntimeRoutingSeam {
  return Object.freeze({
    signalKind,
    status: "deferred",
    reason,
  });
}

function createEmptyCommandPlan(): CommandRuntimeRoutingPlan {
  return Object.freeze({
    topics: Object.freeze([]),
    subscriptions: Object.freeze([]),
    workers: Object.freeze([]),
    routes: Object.freeze([]),
  });
}

function createEmptyEventPlan(): EventRuntimeRoutingPlan {
  return Object.freeze({
    topics: Object.freeze([]),
    subscriptions: Object.freeze([]),
    workers: Object.freeze([]),
    subscriberRoutes: Object.freeze([]),
    reactorRoutes: Object.freeze([]),
    applicationRoutes: Object.freeze([]),
  });
}

function validateContext(input: unknown): BoundedContext {
  if (input === null || typeof input !== "object" || !("context" in input)) {
    throw new TypeError("Server runtime routing requires an input object.");
  }
  const { context } = input as { readonly context: unknown };

  if (!(context instanceof BoundedContext)) {
    throw new TypeError("Server runtime routing requires a built BoundedContext.");
  }

  return context;
}

function validateCommandReadinessLookup(
  readiness: CommandRegistrationReadinessLookup,
): CommandRegistrationReadinessLookup {
  if (
    typeof readiness.registeredCommandMessageFullTypeNames !== "function" ||
    typeof readiness.findCommandAssignee !== "function"
  ) {
    throw new TypeError(
      "Server runtime routing commands must implement CommandRegistrationReadinessLookup.",
    );
  }

  return readiness;
}

function validateEventReadinessLookup(
  readiness: EventRegistrationReadinessLookup,
): EventRegistrationReadinessLookup {
  if (
    typeof readiness.registeredEventMessageFullTypeNames !== "function" ||
    typeof readiness.findEventSubscribers !== "function" ||
    typeof readiness.findEventReactors !== "function" ||
    typeof readiness.findEventApplications !== "function"
  ) {
    throw new TypeError(
      "Server runtime routing events must implement EventRegistrationReadinessLookup.",
    );
  }

  return readiness;
}

function normalizeRegisteredMessageNames(
  values: unknown,
  label: "command" | "event",
): readonly string[] {
  if (!Array.isArray(values)) {
    throw new TypeError(
      `Server runtime routing ${label} readiness must return an array of registered message names.`,
    );
  }

  const messageNames = values as readonly unknown[];

  return Object.freeze(
    [...new Set(messageNames.map((value) => normalizeMessageName(value, label)))].sort(
      compareFullTypeNames,
    ),
  );
}

function normalizeMessageName(value: unknown, label: "command" | "event"): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(
      `Server runtime routing ${label} readiness message names must be non-empty strings.`,
    );
  }

  return value.trim();
}

function normalizeEventReceivers(
  values: unknown,
  eventFullTypeName: string,
  group: EventRouteGroup,
): readonly EventReceiver[] {
  if (!Array.isArray(values)) {
    throw new TypeError(
      `Event registration readiness ${group} receivers for "${eventFullTypeName}" must be an array.`,
    );
  }

  const normalized: EventReceiver[] = [];

  for (const value of values as readonly unknown[]) {
    normalized.push(validateEventReceiver(value, eventFullTypeName, group));
  }

  normalized.sort((left, right) => compareFullTypeNames(receiverKey(left), receiverKey(right)));

  return Object.freeze(normalized);
}

function validateEventReceiver(
  value: unknown,
  eventFullTypeName: string,
  group: EventRouteGroup,
): EventReceiver {
  if (value === null || typeof value !== "object") {
    throw new TypeError(
      `Event registration readiness ${group} receiver for "${eventFullTypeName}" must be an object.`,
    );
  }
  const candidate = value as { readonly eventFullTypeName?: unknown };

  if (candidate.eventFullTypeName !== eventFullTypeName) {
    throw new TypeError(
      `Event ${group} metadata for "${eventFullTypeName}" must match the requested eventFullTypeName.`,
    );
  }

  return value as EventReceiver;
}

function createEventRouteDrafts(
  context: BuiltBoundedContextSnapshot,
  topic: TransportTopic<"event">,
  eventFullTypeName: string,
  receivers: readonly EventReceiver[],
): readonly EventRouteDraft<EventReceiver>[] {
  return Object.freeze(
    receivers.map((receiver) => {
      const workerId = createEventWorkerId(context, receiver);
      const subscription = createTransportSubscription({
        subscriberId: workerId,
        topic,
        mode: "fan-out",
      });

      return Object.freeze({
        eventFullTypeName,
        topic,
        subscription,
        receiver,
        workerId,
      });
    }),
  );
}

function createEventWorkersById(
  routes: readonly EventRouteDraft<EventReceiver>[],
): ReadonlyMap<string, TransportWorkerRegistration> {
  const subscriptionsByWorkerId = new Map<string, TransportSubscription<"event">[]>();

  for (const route of routes) {
    const subscriptions = subscriptionsByWorkerId.get(route.workerId) ?? [];

    subscriptions.push(route.subscription);
    subscriptionsByWorkerId.set(route.workerId, subscriptions);
  }

  const workersById = new Map<string, TransportWorkerRegistration>();

  for (const [workerId, subscriptions] of subscriptionsByWorkerId) {
    workersById.set(
      workerId,
      createTransportWorkerRegistration({
        worker: {
          participantKind: "worker",
          participantId: workerId,
          workerRole: "event-worker",
        },
        subscriptions,
      }),
    );
  }

  return workersById;
}

function getWorkerRegistration(
  workersById: ReadonlyMap<string, TransportWorkerRegistration>,
  workerId: string,
): TransportWorkerRegistration {
  const worker = workersById.get(workerId);

  if (worker === undefined) {
    throw new TypeError(`Missing worker registration for runtime routing worker "${workerId}".`);
  }

  return worker;
}

function createEventWorkerId(
  context: BuiltBoundedContextSnapshot,
  receiver: EventReceiver,
): string {
  return createLogicalName(
    context.name.value,
    "event",
    receiverGroup(receiver),
    receiver.entity.fullTypeName,
    receiver.handler.methodName,
  );
}

function receiverGroup(receiver: EventReceiver): EventRouteGroup {
  switch (receiver.handler.kind) {
    case "event-subscription":
      return "subscriber";
    case "event-reaction":
      return "reactor";
    case "event-application":
      return "application";
  }
}

function receiverKey(receiver: EventReceiver): string {
  return [
    receiverGroup(receiver),
    receiver.entity.fullTypeName,
    receiver.handler.methodName,
    receiver.eventFullTypeName,
  ].join("#");
}

function createLogicalName(...parts: readonly string[]): string {
  const normalized = parts
    .map((part) =>
      part
        .trim()
        .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
        .replace(/[^A-Za-z0-9]+/gu, "-")
        .replace(/^-+|-+$/gu, "")
        .toLowerCase(),
    )
    .filter((part) => part.length > 0);
  const joined = normalized.join("-");

  if (joined.length === 0) {
    throw new TypeError("Runtime routing logical identifiers must not be empty.");
  }

  return /^\d/u.test(joined) ? `runtime-${joined}` : joined;
}
