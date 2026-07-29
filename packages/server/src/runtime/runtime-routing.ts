import { TypeUrls } from "@spine-event-engine/core";
import {
  TransportSubscriptions,
  TransportTopics,
  type TransportSubscription,
  type TransportTopic,
} from "@spine-event-engine/transport";
import { BoundedContext, type BoundedContextSnapshot } from "../context/bounded-context.js";
import {
  CommandRegistrationReadiness,
  isAuthenticCommandRegistrationReadiness,
  type CommandRegistrationAssigneeMetadata,
} from "../handler/command-registration-readiness.js";
import {
  EventRegistrationReadiness,
  isAuthenticEventRegistrationReadiness,
  type EventRegistrationApplicationMetadata,
  type EventRegistrationReactorMetadata,
  type EventRegistrationSubscriberMetadata,
} from "../handler/event-registration-readiness.js";
import { compareFullTypeNames } from "../handler/registration-readiness-metadata.js";
const deterministicValidationErrorTag = Symbol("runtimeRoutingDeterministicValidation");

/** Input accepted by {@link createRoutingPlan}. */
export interface RoutingPlanInput {
  /** Built bounded-context metadata shell that owns the routing plan. */
  readonly context: BoundedContext;
  /** Optional command readiness used to derive command routing. */
  readonly commands?: CommandRegistrationReadiness;
  /** Optional event readiness used to derive event routing. */
  readonly events?: EventRegistrationReadiness;
}

/** Explicit deferred routing seam for unsupported runtime signal kinds. */
export interface DeferredRoutingSeam {
  /** Signal kind intentionally deferred in this slice. */
  readonly signalKind: "query" | "subscription" | "system";
  /** Stable status for deferred runtime seams. */
  readonly status: "deferred";
  /** Human-readable reason kept deliberately narrow and deterministic. */
  readonly reason: string;
}

/** Sanitized message descriptor exposed by public routing routes. */
export interface RouteMessage {
  /** Fully qualified message type name owned by the route. */
  readonly fullTypeName: string;
  /** Canonical transport type URL for the routed message. */
  readonly typeUrl: string;
}

interface RouteRef {
  /** Topic routing key that matches one entry in the plan's top-level topics array. */
  readonly topicRoutingKey: string;
  /** Subscription descriptor key that matches one top-level subscription entry. */
  readonly subscriptionDescriptorKey: string;
}

/** Stable public command route descriptor. */
export interface CommandRuntimeRoutingRoute extends RouteRef {
  /** Planner-local stable route identifier. */
  readonly routeId: string;
  /** Stable public receiver group marker. */
  readonly receiverGroup: "command-assignee";
  /** Planner-local worker identity shared by command routes in this plan. */
  readonly workerId: string;
  /** Sanitized message descriptor for the routed command. */
  readonly message: RouteMessage;
}

/** Command routing plan derived from command readiness. */
export interface CommandRuntimeRoutingPlan {
  /** Deterministic command topics. */
  readonly topics: readonly TransportTopic<"command">[];
  /** Deterministic competing-consumer subscriptions for the command worker. */
  readonly subscriptions: readonly TransportSubscription<"command">[];
  /** Planner-local worker ids referenced by command routes. */
  readonly workerIds: readonly string[];
  /** Sanitized command routes. */
  readonly routes: readonly CommandRuntimeRoutingRoute[];
}

/** Stable event receiver groups exposed by the runtime planner. */
export type EventRuntimeReceiverGroup = "application" | "reactor" | "subscriber";

/** Stable public event route descriptor. */
export interface EventRuntimeRoutingRoute extends RouteRef {
  /** Planner-local stable route identifier. */
  readonly routeId: string;
  /** Stable public receiver group marker. */
  readonly receiverGroup: EventRuntimeReceiverGroup;
  /** Planner-local worker identity unique within this plan. */
  readonly workerId: string;
  /** Sanitized message descriptor for the routed event. */
  readonly message: RouteMessage;
}

/** Event routing plan derived from event readiness. */
export interface EventRuntimeRoutingPlan {
  /** Deterministic event topics. */
  readonly topics: readonly TransportTopic<"event">[];
  /** Deterministic fan-out subscriptions across all event receiver groups. */
  readonly subscriptions: readonly TransportSubscription<"event">[];
  /** Planner-local worker ids referenced by event routes. */
  readonly workerIds: readonly string[];
  /** Sanitized subscriber fan-out routes. */
  readonly subscriberRoutes: readonly EventRuntimeRoutingRoute[];
  /** Sanitized reactor fan-out routes. */
  readonly reactorRoutes: readonly EventRuntimeRoutingRoute[];
  /** Sanitized event-application fan-out routes. */
  readonly applicationRoutes: readonly EventRuntimeRoutingRoute[];
}

/** Immutable runtime routing plan derived from server metadata only. */
export interface ServerRuntimeRoutingPlan {
  /** Copy-safe built bounded-context metadata that owns the routing plan. */
  readonly context: BoundedContextSnapshot;
  /** Command routing metadata derived from command readiness. */
  readonly commands: CommandRuntimeRoutingPlan;
  /** Event routing metadata derived from event readiness. */
  readonly events: EventRuntimeRoutingPlan;
  /** Explicit deferred seams for unsupported signal kinds. */
  readonly deferred: readonly DeferredRoutingSeam[];
}

interface CommandRouteDraft {
  readonly routeId: string;
  readonly receiverGroup: "command-assignee";
  readonly workerId: string;
  readonly message: RouteMessage;
  readonly topic: TransportTopic<"command">;
  readonly subscription: TransportSubscription<"command">;
}

interface EventRouteDraft {
  readonly routeId: string;
  readonly receiverGroup: EventRuntimeReceiverGroup;
  readonly workerId: string;
  readonly message: RouteMessage;
  readonly topic: TransportTopic<"event">;
  readonly subscription: TransportSubscription<"event">;
}

type EventHandlerKind = "event-application" | "event-reaction" | "event-subscription";
type SemanticTaggedReadinessMetadata =
  | CommandRegistrationAssigneeMetadata
  | EventRegistrationApplicationMetadata
  | EventRegistrationReactorMetadata
  | EventRegistrationSubscriberMetadata;

interface RoutedMessageDraft {
  readonly message: RouteMessage;
  readonly semanticTags: readonly string[];
}

const commandWorkerId = "command-worker-1";
const handlerKindByGroup = Object.freeze({
  application: "event-application",
  reactor: "event-reaction",
  subscriber: "event-subscription",
}) satisfies Record<EventRuntimeReceiverGroup, EventHandlerKind>;

class DeterministicValidationError extends TypeError {
  readonly [deterministicValidationErrorTag] = true;
}

/** Create an immutable runtime routing plan from bounded-context and readiness metadata. */
export function createRoutingPlan(input: RoutingPlanInput): ServerRuntimeRoutingPlan {
  const context = validateContext(input);
  const contextSnapshot = context.snapshot;
  const commands = createCommandPlan(input.commands);
  const events = createEventPlan(input.events);

  return Object.freeze({
    context: contextSnapshot,
    commands,
    events,
    deferred: createDeferredSeams(),
  });
}

/** @internal Create one transport intake route per type accepted by a built context. */
export function createContextRoutingPlan(context: BoundedContext): ServerRuntimeRoutingPlan {
  const validatedContext = validateContext({ context });
  const commandTypeUrls = normalizeAcceptedTypeUrls(
    validatedContext.commandBus().acceptedCommandTypes(),
  );
  const eventTypeUrls = normalizeAcceptedTypeUrls(validatedContext.eventBus().acceptedEventTypes());

  return Object.freeze({
    context: validatedContext.snapshot,
    commands: createAcceptedCommandPlan(commandTypeUrls),
    events: createAcceptedEventPlan(eventTypeUrls, validatedContext.snapshot.name.value),
    deferred: createDeferredSeams(),
  });
}

function createCommandPlan(
  readiness: CommandRegistrationReadiness | undefined,
): CommandRuntimeRoutingPlan {
  if (readiness === undefined) {
    return createEmptyCommandPlan();
  }

  const validatedReadiness = validateCommandReadiness(readiness);
  const commandFullTypeNames = normalizeRegisteredMessageNames(
    validatedReadiness.registeredCommandMessageFullTypeNames(),
    "command",
  );

  if (commandFullTypeNames.length === 0) {
    return createEmptyCommandPlan();
  }

  const routeDrafts = Object.freeze(
    commandFullTypeNames.map((commandFullTypeName, index) =>
      createCommandRouteDraft(validatedReadiness, commandFullTypeName, index + 1),
    ),
  );
  const routes = finalizeCommandRoutes(routeDrafts);

  return Object.freeze({
    topics: Object.freeze(routeDrafts.map(({ topic }) => topic)),
    subscriptions: Object.freeze(routeDrafts.map(({ subscription }) => subscription)),
    workerIds: Object.freeze([commandWorkerId]),
    routes,
  });
}

function createAcceptedCommandPlan(typeUrls: readonly string[]): CommandRuntimeRoutingPlan {
  if (typeUrls.length === 0) {
    return createEmptyCommandPlan();
  }

  const routeDrafts = Object.freeze(
    typeUrls.map((typeUrl, index) => createContextCommandRoute(typeUrl, index + 1)),
  );

  return Object.freeze({
    topics: Object.freeze(routeDrafts.map(({ topic }) => topic)),
    subscriptions: Object.freeze(routeDrafts.map(({ subscription }) => subscription)),
    workerIds: Object.freeze([commandWorkerId]),
    routes: finalizeCommandRoutes(routeDrafts),
  });
}

function createContextCommandRoute(typeUrl: string, routeOrdinal: number): CommandRouteDraft {
  const message = acceptedRouteMessage(typeUrl);
  const topic = TransportTopics.create({
    signalKind: "command",
    messageTypeUrl: message.typeUrl,
    semanticTags: [],
  });
  const subscription = TransportSubscriptions.create({
    subscriberId: commandWorkerId,
    topic,
    mode: "competing-consumer",
  });

  return Object.freeze({
    routeId: `command-route-${String(routeOrdinal)}`,
    receiverGroup: "command-assignee",
    workerId: commandWorkerId,
    message,
    topic,
    subscription,
  });
}

function finalizeCommandRoutes(
  drafts: readonly CommandRouteDraft[],
): readonly CommandRuntimeRoutingRoute[] {
  return Object.freeze(
    drafts.map((route) =>
      Object.freeze({
        routeId: route.routeId,
        receiverGroup: route.receiverGroup,
        workerId: route.workerId,
        topicRoutingKey: route.topic.routing.routingKey,
        subscriptionDescriptorKey: route.subscription.descriptorKey,
        message: route.message,
      }),
    ),
  );
}

function createCommandRouteDraft(
  readiness: CommandRegistrationReadiness,
  commandFullTypeName: string,
  routeOrdinal: number,
): CommandRouteDraft {
  const routedMessage = sanitizeCommandRouteMessage(
    readiness.findCommandAssignee(commandFullTypeName),
    commandFullTypeName,
  );
  const topic = TransportTopics.create({
    signalKind: "command",
    messageTypeUrl: routedMessage.message.typeUrl,
    semanticTags: routedMessage.semanticTags,
  });
  const subscription = TransportSubscriptions.create({
    subscriberId: commandWorkerId,
    topic,
    mode: "competing-consumer",
  });

  return Object.freeze({
    routeId: `command-route-${String(routeOrdinal)}`,
    receiverGroup: "command-assignee",
    workerId: commandWorkerId,
    message: routedMessage.message,
    topic,
    subscription,
  });
}

function createEventPlan(
  readiness: EventRegistrationReadiness | undefined,
): EventRuntimeRoutingPlan {
  if (readiness === undefined) {
    return createEmptyEventPlan();
  }

  const validatedReadiness = validateEventReadiness(readiness);
  const eventFullTypeNames = normalizeRegisteredMessageNames(
    validatedReadiness.registeredEventMessageFullTypeNames(),
    "event",
  );

  if (eventFullTypeNames.length === 0) {
    return createEmptyEventPlan();
  }

  const topicByEventName = new Map<string, TransportTopic<"event">>();
  const routeOrdinals = {
    application: 0,
    reactor: 0,
    subscriber: 0,
  } satisfies Record<EventRuntimeReceiverGroup, number>;
  const subscriberDrafts: EventRouteDraft[] = [];
  const reactorDrafts: EventRouteDraft[] = [];
  const applicationDrafts: EventRouteDraft[] = [];

  for (const eventFullTypeName of eventFullTypeNames) {
    const subscribers = sanitizeEventRouteMessages(
      validatedReadiness.findEventSubscribers(eventFullTypeName),
      eventFullTypeName,
      "subscriber",
    );
    const reactors = sanitizeEventRouteMessages(
      validatedReadiness.findEventReactors(eventFullTypeName),
      eventFullTypeName,
      "reactor",
    );
    const applications = sanitizeEventRouteMessages(
      validatedReadiness.findEventApplications(eventFullTypeName),
      eventFullTypeName,
      "application",
    );
    const firstMessage = subscribers[0] ?? reactors[0] ?? applications[0];

    if (firstMessage === undefined) {
      throw new TypeError(
        `Event registration readiness must return at least one receiver for "${eventFullTypeName}".`,
      );
    }

    const topic = TransportTopics.create({
      signalKind: "event",
      messageTypeUrl: firstMessage.message.typeUrl,
      semanticTags: collectTopicSemanticTags(subscribers, reactors, applications),
    });

    topicByEventName.set(eventFullTypeName, topic);
    subscriberDrafts.push(
      ...createEventRouteDrafts(topic, subscribers, "subscriber", routeOrdinals),
    );
    reactorDrafts.push(...createEventRouteDrafts(topic, reactors, "reactor", routeOrdinals));
    applicationDrafts.push(
      ...createEventRouteDrafts(topic, applications, "application", routeOrdinals),
    );
  }

  const allDrafts = [...subscriberDrafts, ...reactorDrafts, ...applicationDrafts];
  const subscriberRoutes = finalizeEventRoutes(subscriberDrafts);
  const reactorRoutes = finalizeEventRoutes(reactorDrafts);
  const applicationRoutes = finalizeEventRoutes(applicationDrafts);
  const subscriptions = Object.freeze(
    allDrafts
      .map(({ subscription }) => subscription)
      .sort((left, right) => compareFullTypeNames(left.descriptorKey, right.descriptorKey)),
  );
  const workerIds = Object.freeze(
    [...new Set(allDrafts.map(({ workerId }) => workerId))].sort(compareFullTypeNames),
  );

  return Object.freeze({
    topics: Object.freeze([...topicByEventName.values()]),
    subscriptions,
    workerIds,
    subscriberRoutes,
    reactorRoutes,
    applicationRoutes,
  });
}

function createAcceptedEventPlan(
  typeUrls: readonly string[],
  contextName: string,
): EventRuntimeRoutingPlan {
  if (typeUrls.length === 0) {
    return createEmptyEventPlan();
  }

  const routeDrafts = Object.freeze(
    typeUrls.map((typeUrl, index) =>
      createContextEventRoute(typeUrl, eventSubscriberId(contextName, index + 1), index + 1),
    ),
  );
  const routes = finalizeEventRoutes(routeDrafts);

  return Object.freeze({
    topics: Object.freeze(routeDrafts.map(({ topic }) => topic)),
    subscriptions: Object.freeze(routeDrafts.map(({ subscription }) => subscription)),
    workerIds: Object.freeze(routeDrafts.map(({ workerId }) => workerId)),
    subscriberRoutes: routes,
    reactorRoutes: Object.freeze([]),
    applicationRoutes: Object.freeze([]),
  });
}

function createContextEventRoute(
  typeUrl: string,
  workerId: string,
  routeOrdinal: number,
): EventRouteDraft {
  const message = acceptedRouteMessage(typeUrl);
  const topic = TransportTopics.create({
    signalKind: "event",
    messageTypeUrl: message.typeUrl,
    semanticTags: [],
  });
  const subscription = TransportSubscriptions.create({
    subscriberId: workerId,
    topic,
    mode: "fan-out",
  });

  return Object.freeze({
    routeId: `event-subscriber-route-${String(routeOrdinal)}`,
    receiverGroup: "subscriber",
    workerId,
    message,
    topic,
    subscription,
  });
}

function eventSubscriberId(contextName: string, routeOrdinal: number): string {
  const contextId = Buffer.from(contextName, "utf8").toString("base64url");

  return `event-context-${contextId}-worker-${String(routeOrdinal)}`;
}

function normalizeAcceptedTypeUrls(typeUrls: readonly string[]): readonly string[] {
  return Object.freeze(
    [...new Set(typeUrls)]
      .map((typeUrl) => acceptedRouteMessage(typeUrl).typeUrl)
      .sort(compareFullTypeNames),
  );
}

function acceptedRouteMessage(typeUrl: string): RouteMessage {
  const separator = typeUrl.lastIndexOf("/");
  const fullTypeName = typeUrl.slice(separator + 1);

  if (separator <= 0 || fullTypeName.length === 0) {
    throw new TypeError(`Built context exposed an invalid accepted type URL "${typeUrl}".`);
  }

  return Object.freeze({ fullTypeName, typeUrl });
}

function createEventRouteDrafts(
  topic: TransportTopic<"event">,
  messages: readonly RoutedMessageDraft[],
  receiverGroup: EventRuntimeReceiverGroup,
  routeOrdinals: Record<EventRuntimeReceiverGroup, number>,
): readonly EventRouteDraft[] {
  if (messages.length === 0) {
    return Object.freeze([]);
  }

  const drafts: EventRouteDraft[] = [];

  for (const message of messages) {
    routeOrdinals[receiverGroup] += 1;
    const ordinal = routeOrdinals[receiverGroup];
    const workerId = `event-${receiverGroup}-worker-${String(ordinal)}`;
    const subscription = TransportSubscriptions.create({
      subscriberId: workerId,
      topic,
      mode: "fan-out",
    });

    drafts.push(
      Object.freeze({
        routeId: `event-${receiverGroup}-route-${String(ordinal)}`,
        receiverGroup,
        workerId,
        message: message.message,
        topic,
        subscription,
      }),
    );
  }

  return Object.freeze(drafts);
}

function finalizeEventRoutes(
  drafts: readonly EventRouteDraft[],
): readonly EventRuntimeRoutingRoute[] {
  return Object.freeze(
    drafts.map((route) =>
      Object.freeze({
        routeId: route.routeId,
        receiverGroup: route.receiverGroup,
        workerId: route.workerId,
        topicRoutingKey: route.topic.routing.routingKey,
        subscriptionDescriptorKey: route.subscription.descriptorKey,
        message: route.message,
      }),
    ),
  );
}

function createDeferredSeams(): readonly DeferredRoutingSeam[] {
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
  signalKind: DeferredRoutingSeam["signalKind"],
  reason: string,
): DeferredRoutingSeam {
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
    workerIds: Object.freeze([]),
    routes: Object.freeze([]),
  });
}

function createEmptyEventPlan(): EventRuntimeRoutingPlan {
  return Object.freeze({
    topics: Object.freeze([]),
    subscriptions: Object.freeze([]),
    workerIds: Object.freeze([]),
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

function validateCommandReadiness(readiness: unknown): CommandRegistrationReadiness {
  if (!isAuthenticCommandRegistrationReadiness(readiness)) {
    throw new TypeError(
      "Server runtime routing commands must be an authentic CommandRegistrationReadiness instance.",
    );
  }

  return readiness;
}

function validateEventReadiness(readiness: unknown): EventRegistrationReadiness {
  if (!isAuthenticEventRegistrationReadiness(readiness)) {
    throw new TypeError(
      "Server runtime routing events must be an authentic EventRegistrationReadiness instance.",
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

function sanitizeCommandRouteMessage(
  assignee: unknown,
  commandFullTypeName: string,
): RoutedMessageDraft {
  const label = `Command assignee metadata for "${commandFullTypeName}"`;

  return withDeterministicValidation(
    `command metadata for "${commandFullTypeName}" is malformed`,
    () => {
      if (assignee === undefined) {
        throw new DeterministicValidationError(
          `Command registration readiness must return assignee metadata for "${commandFullTypeName}".`,
        );
      }
      if (assignee === null || typeof assignee !== "object") {
        throw new DeterministicValidationError(`${label} must be an object.`);
      }

      const candidate = assignee as {
        readonly commandFullTypeName?: unknown;
        readonly handler?: unknown;
      };

      if (candidate.commandFullTypeName !== commandFullTypeName) {
        throw new DeterministicValidationError(`${label} must preserve commandFullTypeName.`);
      }

      const handler = validateHandlerShape(
        candidate.handler,
        commandFullTypeName,
        "command-assignment",
        `${label} must expose a command-assignment handler.`,
        `${label} must preserve the requested command message type.`,
      );
      const semanticTags = copySemanticTags(candidate as CommandRegistrationAssigneeMetadata);

      return Object.freeze({
        message: createMessageDescriptor(commandFullTypeName, handler.schema, label),
        semanticTags,
      });
    },
  );
}

function sanitizeEventRouteMessages(
  values: unknown,
  eventFullTypeName: string,
  receiverGroup: EventRuntimeReceiverGroup,
): readonly RoutedMessageDraft[] {
  const expectedHandlerKind = handlerKindByGroup[receiverGroup];
  const receiverLabel = `Event ${receiverGroup} metadata for "${eventFullTypeName}"`;

  if (!Array.isArray(values)) {
    throw new TypeError(
      `Event registration readiness ${receiverGroup} receivers for "${eventFullTypeName}" must be an array.`,
    );
  }

  return Object.freeze(
    (values as readonly unknown[]).map((value) =>
      withDeterministicValidation(`event metadata for "${eventFullTypeName}" is malformed`, () => {
        if (value === null || typeof value !== "object") {
          throw new DeterministicValidationError(`${receiverLabel} must be an object.`);
        }

        const candidate = value as {
          readonly eventFullTypeName?: unknown;
          readonly handler?: unknown;
        };

        if (candidate.eventFullTypeName !== eventFullTypeName) {
          throw new DeterministicValidationError(
            `${receiverLabel} must match the requested eventFullTypeName.`,
          );
        }

        const handler = validateHandlerShape(
          candidate.handler,
          eventFullTypeName,
          expectedHandlerKind,
          `${receiverLabel} must expose an ${expectedHandlerKind} handler.`,
          `${receiverLabel} must preserve the requested event message type.`,
        );
        const semanticTags = copySemanticTags(candidate as SemanticTaggedReadinessMetadata);

        return Object.freeze({
          message: createMessageDescriptor(eventFullTypeName, handler.schema, receiverLabel),
          semanticTags,
        });
      }),
    ),
  );
}

function collectTopicSemanticTags(
  ...groups: readonly (readonly RoutedMessageDraft[])[]
): readonly string[] {
  const semanticTags = new Set<string>();

  for (const group of groups) {
    for (const entry of group) {
      for (const tag of entry.semanticTags) {
        semanticTags.add(tag);
      }
    }
  }

  return Object.freeze([...semanticTags].sort(compareSemanticTags));
}

function compareSemanticTags(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function validateHandlerShape(
  value: unknown,
  expectedMessageName: string,
  expectedKind: string,
  wrongKindMessage: string,
  wrongMessageMessage: string,
): { readonly schema: { readonly typeName: string } } {
  if (value === null || typeof value !== "object") {
    throw new DeterministicValidationError(wrongKindMessage);
  }

  const candidate = value as {
    readonly kind?: unknown;
    readonly messageFullTypeName?: unknown;
    readonly schema?: unknown;
  };

  if (candidate.kind !== expectedKind) {
    throw new DeterministicValidationError(wrongKindMessage);
  }

  if (candidate.messageFullTypeName !== expectedMessageName) {
    throw new DeterministicValidationError(wrongMessageMessage);
  }

  if (candidate.schema === null || typeof candidate.schema !== "object") {
    throw new DeterministicValidationError(wrongMessageMessage);
  }

  const schema = candidate.schema as { readonly typeName?: unknown };

  if (schema.typeName !== expectedMessageName) {
    throw new DeterministicValidationError(wrongMessageMessage);
  }

  return Object.freeze({
    schema: schema as { readonly typeName: string },
  });
}

function createMessageDescriptor(
  fullTypeName: string,
  schema: unknown,
  label: string,
): RouteMessage {
  const typeUrl = withDeterministicValidation(`${label} is malformed`, () =>
    TypeUrls.derive(schema as never),
  );

  return Object.freeze({
    fullTypeName,
    typeUrl,
  });
}

function copySemanticTags(metadata: SemanticTaggedReadinessMetadata): readonly string[] {
  return Object.freeze([...metadata.entity.semanticTags]);
}

function withDeterministicValidation<Value>(
  fallbackMessage: string,
  operation: () => Value,
): Value {
  try {
    return operation();
  } catch (error) {
    if (isDeterministicValidationError(error)) {
      throw error;
    }

    throw new TypeError(`Server runtime routing ${fallbackMessage}.`);
  }
}

function isDeterministicValidationError(error: unknown): error is TypeError {
  return (
    error instanceof TypeError &&
    deterministicValidationErrorTag in (error as unknown as Record<PropertyKey, unknown>)
  );
}
