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
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import type { Any } from "@bufbuild/protobuf/wkt";
import { TypeUrls, type MessageSchema } from "@spine-event-engine/core";
import {
  BoundedContextOnlineSchema,
  ChannelIdSchema,
  ExternalEventsWantedSchema,
  type BoundedContextName,
  type BoundedContextOnline,
  type Event,
  type ExternalEventsWanted,
  type ExternalMessage,
} from "@spine-event-engine/proto";
import type {
  ConsumerHandle,
  Publisher,
  Subscriber,
  TransportFactory,
} from "@spine-event-engine/transport";

import { eventBusAccess, EventBus } from "../bus/event-bus.js";
import { emitServerError } from "../server/server-log.js";
import { ServerEnvironment, serverEnvironmentAccess } from "../server/server-environment.js";
import type { EventDispatcher } from "../bus/event-dispatcher.js";
import {
  unpackExternalEvent,
  toExternalEvent,
  wrapBoundedContextOnline,
  wrapExternalEvent,
  wrapExternalEventsWanted,
} from "./external-messages.js";

const onlineType = typeUrl(BoundedContextOnlineSchema);
const wantedType = typeUrl(ExternalEventsWantedSchema);

/**
 * Coordinates private context-owned integration exchanges.
 *
 * @internal
 */
export class IntegrationBroker {
  readonly #input: IntegrationBrokerInput;
  readonly #wantedByOrigin = new Map<string, ReadonlySet<string>>();
  readonly #publishers = new Map<string, DomesticPublisher>();
  readonly #resources: Closeable[] = [];
  readonly #retainedCloseables: Closeable[] = [];
  readonly #externalSchemas: readonly MessageSchema[];
  readonly #acceptedCallbacks = new Set<Promise<void>>();
  #transition = Promise.resolve();
  #open: Promise<void> | undefined;
  #close: Promise<void> | undefined;
  #closed = false;
  #emptyWantedPublished = false;

  /**
   * Creates an exchange coordinator from context-owned integration resources.
   *
   * @param input Provides the context assembly inputs.
   */
  constructor(input: IntegrationBrokerInput) {
    this.#input = input;
    this.#externalSchemas = Object.freeze(
      [...input.externalEventSchemas].filter(
        (schema, index, schemas) =>
          schemas.findIndex(
            (candidate) => TypeUrls.derive(candidate) === TypeUrls.derive(schema),
          ) === index,
      ),
    );
  }

  /**
   * Starts the three exchanges once; callers share the same readiness promise.
   *
   * @returns Completes when all exchanges are ready.
   */
  open(): Promise<void> {
    if (this.#closed) return Promise.reject(new Error("IntegrationBroker is closed."));
    this.#open ??= this.#openOnce();
    return this.#open;
  }

  /**
   * Stops intake, withdraws interests, drains accepted work, and attempts every cleanup.
   *
   * @returns Completes when all retained resources close.
   */
  close(): Promise<void> {
    this.#close ??= this.#closeOnce();
    return this.#close;
  }

  /**
   * Publishes a third-party imported event through this context's private broker.
   *
   * @param event Contains the original event envelope to publish.
   * @returns Completes after publication is accepted or rejects when the broker is closed or the
   * event has no message type URL.
   * @internal
   */
  async publishImported(event: Event): Promise<void> {
    if (this.#closed) throw new Error("IntegrationBroker is closed.");
    const targetType = event.message?.typeUrl;
    if (targetType === undefined || targetType.length === 0) {
      throw new Error("Imported event requires event.message.typeUrl.");
    }
    if (![...this.#wantedByOrigin.values()].some((types) => types.has(targetType))) {
      return;
    }
    const publisher = await this.#input.transportFactory.createPublisher(channel(targetType));
    try {
      const frame = wrapExternalEvent(event, this.#input.contextName);
      await publisher.publish(frame.id, frame);
    } finally {
      await this.#closeEphemeral(publisher);
    }
  }

  async #openOnce(): Promise<void> {
    try {
      const factory = this.#input.transportFactory;
      const status = await this.#attach(factory, onlineType, (message) => this.#onOnline(message));
      this.#resources.push(status);
      const config = await this.#attach(factory, wantedType, (message) => this.#onWanted(message));
      this.#resources.push(config);
      for (const schema of this.#externalSchemas) {
        const targetType = typeUrl(schema);
        this.#resources.push(
          await this.#attach(factory, targetType, (message) => this.#onEvent(message)),
        );
      }
      await this.#publishOnline();
      await this.#publishWanted();
    } catch (error) {
      const failures = await closeRetained(this.#resources);
      this.#open = undefined;
      if (failures.length)
        throw new AggregateError([error, ...failures], "IntegrationBroker open failed.");
      throw error;
    }
  }

  async #attach(
    factory: TransportFactory,
    targetType: string,
    consumer: (message: ExternalMessage) => Promise<void>,
  ): Promise<Closeable> {
    const subscriber = await factory.createSubscriber(channel(targetType));
    try {
      const handle = await subscriber.addConsumer((message) =>
        this.#acceptCallback(() => consumer(message)),
      );
      return new SubscriberResource(subscriber, handle);
    } catch (error) {
      try {
        await subscriber.close();
      } catch (closeError) {
        throw new AggregateError([error, closeError], "Integration subscriber setup failed.");
      }
      throw error;
    }
  }

  #acceptCallback(work: () => Promise<void>): Promise<void> {
    if (this.#closed) return Promise.resolve();
    const accepted = Promise.resolve().then(work);
    this.#acceptedCallbacks.add(accepted);
    void accepted.then(
      () => this.#acceptedCallbacks.delete(accepted),
      () => this.#acceptedCallbacks.delete(accepted),
    );
    return accepted;
  }

  async #onOnline(message: ExternalMessage): Promise<void> {
    if (this.#closed) return;
    const online = unpackOnline(message);
    if (!this.#accepts(online.context)) return;
    await this.#publishWanted();
  }

  async #onWanted(message: ExternalMessage): Promise<void> {
    if (this.#closed) return;
    if (!this.#accepts(message.boundedContextName)) return;
    const wanted = unpackWanted(message);
    const requested = new Set<string>(
      wanted.type.map((entry: { typeUrl: string }) => entry.typeUrl).filter(Boolean),
    );
    const origin = message.boundedContextName.value;
    await this.#enqueueTransition(async () => this.#replaceWanted(origin, requested));
  }

  async #onEvent(message: ExternalMessage): Promise<void> {
    if (this.#closed) return;
    if (!this.#accepts(message.boundedContextName)) return;
    let imported: Event;
    try {
      const original = unpackExternalEvent(message);
      const typeUrl = original.message?.typeUrl;
      const schema =
        typeUrl === undefined
          ? undefined
          : (eventBusAccess.schema(this.#input.eventBus, typeUrl) ??
            (typeUrl === TypeUrls.derive(StringValueSchema) ? StringValueSchema : undefined));
      if (schema === undefined || original.message === undefined)
        throw new Error("External event message type is not accepted.");
      fromBinary(schema, original.message.value);
      imported = toExternalEvent(original);
    } catch {
      emitServerError(
        serverEnvironmentAccess.loggerFor(ServerEnvironment.instance()),
        "Dropped corrupt external event.",
        {
          contextName: message.boundedContextName.value,
          eventType: message.originalMessage?.typeUrl ?? "unknown",
          operation: "external-event-intake",
          reasonCode: "CORRUPT_EXTERNAL_EVENT",
        },
      );
      return;
    }
    await this.#input.postImported(imported);
  }

  async #replaceWanted(origin: string, next: ReadonlySet<string>): Promise<void> {
    const previous = this.#wantedByOrigin.get(origin) ?? new Set<string>();
    const add = [...next].flatMap((type) => {
      const schema = eventBusAccess.schema(this.#input.eventBus, type);
      if (previous.has(type) || this.#wantedElsewhere(type, origin) || schema === undefined)
        return [];
      return [[type, schema] as const];
    });
    const removals = [...this.#publishers].filter(
      ([type]) => previous.has(type) && !next.has(type) && !this.#wantedElsewhere(type, origin),
    );
    const acquired: DomesticPublisher[] = [];
    try {
      for (const [targetType, schema] of add) {
        const publisher = await DomesticPublisher.create(
          this.#input.eventBus,
          this.#input.transportFactory,
          targetType,
          this.#input.contextName,
          schema,
        );
        acquired.push(publisher);
      }
    } catch (error) {
      const failures = await this.#rollbackAcquired(acquired);
      if (failures.length)
        throw new AggregateError([error, ...failures], "Integration publisher acquisition failed.");
      throw error;
    }
    const errors: unknown[] = [];
    for (const [, publisher] of removals) {
      await collect(() => publisher.close(), errors);
    }
    if (errors.length) {
      const failures = await this.#rollbackAcquired(acquired);
      throw new AggregateError([...errors, ...failures], "Failed to remove domestic publisher.");
    }
    this.#wantedByOrigin.set(origin, new Set(next));
    for (const [targetType] of removals) this.#publishers.delete(targetType);
    for (const publisher of acquired) this.#publishers.set(publisher.targetType, publisher);
  }

  #wantedElsewhere(targetType: string, exceptOrigin: string): boolean {
    return [...this.#wantedByOrigin.entries()].some(
      ([origin, types]) => origin !== exceptOrigin && types.has(targetType),
    );
  }

  async #rollbackAcquired(acquired: readonly DomesticPublisher[]): Promise<unknown[]> {
    const settled = await Promise.all(
      acquired.map(async (publisher) => {
        try {
          await publisher.rollback();
        } catch (reason) {
          return { publisher, reason };
        }
        return undefined;
      }),
    );
    const failures: unknown[] = [];
    for (const failure of settled) {
      if (failure === undefined) continue;
      this.#retainedCloseables.push(failure.publisher);
      failures.push(failure.reason);
    }
    return failures;
  }

  #enqueueTransition(work: () => Promise<void>): Promise<void> {
    const accepted = this.#transition.then(work);
    this.#transition = accepted.catch(() => undefined);
    return accepted;
  }

  async #publishOnline(): Promise<void> {
    const publisher = await this.#input.transportFactory.createPublisher(channel(onlineType));
    try {
      const frame = wrapBoundedContextOnline(
        create(BoundedContextOnlineSchema, { context: this.#input.contextName }),
      );
      await publisher.publish(frame.id, frame);
    } finally {
      await this.#closeEphemeral(publisher);
    }
  }

  async #publishWanted(): Promise<void> {
    const types = this.#externalSchemas.map(typeUrl).sort();
    const publisher = await this.#input.transportFactory.createPublisher(channel(wantedType));
    try {
      const frame = wrapExternalEventsWanted(
        create(ExternalEventsWantedSchema, { type: types.map((typeUrl) => ({ typeUrl })) }),
        this.#input.contextName,
      );
      await publisher.publish(frame.id, frame);
    } finally {
      await this.#closeEphemeral(publisher);
    }
  }

  #accepts(
    origin: BoundedContextName | undefined,
  ): origin is BoundedContextName & { readonly value: string } {
    const value = origin?.value;
    return Boolean(
      value &&
      value !== this.#input.contextName.value &&
      value !== this.#input.pairedContextName?.value,
    );
  }

  async #closeOnce(): Promise<void> {
    this.#closed = true;
    const errors: unknown[] = [];
    const opening = this.#open;
    if (opening !== undefined) await collect(() => opening, errors);
    await Promise.allSettled([...this.#acceptedCallbacks]);
    await this.#transition;
    await collect(() => this.#publishEmptyWanted(), errors);
    const publisherFailures = await closeRetained(this.#retainedCloseables);
    errors.push(...publisherFailures);
    for (const [type, publisher] of this.#publishers) {
      const failures: unknown[] = [];
      await collect(() => publisher.close(), failures);
      if (failures.length === 0) this.#publishers.delete(type);
      else errors.push(...failures);
    }
    errors.push(...(await closeRetained(this.#resources)));
    if (errors.length) {
      this.#close = undefined;
      throw new AggregateError(errors, "IntegrationBroker close failed.");
    }
  }

  async #publishEmptyWanted(): Promise<void> {
    if (this.#emptyWantedPublished) return;
    const publisher = await this.#input.transportFactory.createPublisher(channel(wantedType));
    try {
      const frame = wrapExternalEventsWanted(
        create(ExternalEventsWantedSchema),
        this.#input.contextName,
      );
      await publisher.publish(frame.id, frame);
      this.#emptyWantedPublished = true;
    } finally {
      await this.#closeEphemeral(publisher);
    }
  }

  async #closeEphemeral(publisher: Publisher): Promise<void> {
    try {
      await publisher.close();
    } catch (error) {
      this.#retainedCloseables.push(publisher);
      throw error;
    }
  }
}

/**
 * Provides the minimal context-assembly handoff; it is not a public application API.
 *
 * @internal
 */
export interface IntegrationBrokerInput {
  // prettier-ignore

  /**
   * Name of the owning bounded context.
   */
  readonly contextName: BoundedContextName;

  /**
   * Optional system context whose frames share this broker's transport.
   */
  readonly pairedContextName?: BoundedContextName;

  /**
   * Transport resource factory owned by the context environment.
   */
  readonly transportFactory: TransportFactory;

  /**
   * Local EventBus used for domestic publication and schema lookup.
   */
  readonly eventBus: EventBus;

  /**
   * Schemas whose external event channels this context consumes.
   */
  readonly externalEventSchemas: Iterable<MessageSchema>;

  /**
   * Posts a validated imported Event through the owning context.
   *
   * @param event Provides the imported Event.
   * @returns Completes when the context has accepted the Event.
   */
  readonly postImported: (event: Event) => Promise<void>;
}

class DomesticPublisher implements Closeable {
  readonly targetType: string;
  readonly #eventBus: EventBus;
  readonly #dispatcher: EventDispatcher;
  readonly #publisher: Publisher;
  #detached = false;
  private constructor(
    eventBus: EventBus,
    publisher: Publisher,
    targetType: string,
    origin: BoundedContextName,
    schema: MessageSchema,
  ) {
    this.#eventBus = eventBus;
    this.#publisher = publisher;
    this.targetType = targetType;
    this.#dispatcher = {
      messageSchemas: () => [schema],
      dispatch: async (event) => {
        const frame = wrapExternalEvent(event, origin);
        await publisher.publish(frame.id, frame);
      },
    };
  }
  static async create(
    eventBus: EventBus,
    factory: TransportFactory,
    targetType: string,
    origin: BoundedContextName,
    schema: MessageSchema,
  ): Promise<DomesticPublisher> {
    const publisher = await factory.createPublisher(channel(targetType));
    const domestic = new DomesticPublisher(eventBus, publisher, targetType, origin, schema);
    eventBus.register(domestic.#dispatcher);
    return domestic;
  }
  async close(): Promise<void> {
    await this.#publisher.close();
    this.#detach();
  }
  async rollback(): Promise<void> {
    this.#detach();
    await this.#publisher.close();
  }
  #detach(): void {
    if (this.#detached) return;
    this.#detached = true;
    eventBusAccess.unregister(this.#eventBus, this.#dispatcher);
  }
}

interface Closeable {
  close(): Promise<void>;
}
class SubscriberResource implements Closeable {
  constructor(
    readonly subscriber: Subscriber,
    readonly handle: ConsumerHandle,
  ) {}
  async close(): Promise<void> {
    const errors: unknown[] = [];
    await collect(() => this.handle.close(), errors);
    await collect(() => this.subscriber.close(), errors);
    if (errors.length) throw new AggregateError(errors, "Integration subscriber close failed.");
  }
}
async function closeRetained(resources: Closeable[]): Promise<unknown[]> {
  const settled = await Promise.allSettled(resources.map((resource) => resource.close()));
  const retained = resources.filter((_, index) => settled[index]?.status === "rejected");
  resources.splice(0, resources.length, ...retained);
  const failures: unknown[] = [];
  for (const result of settled) if (result.status === "rejected") failures.push(result.reason);
  return failures;
}
async function collect(work: () => Promise<void>, errors: unknown[]): Promise<void> {
  try {
    await work();
  } catch (error) {
    errors.push(error);
  }
}
function channel(targetType: string) {
  return create(ChannelIdSchema, { targetType });
}
function typeUrl(schema: MessageSchema): string {
  return TypeUrls.derive(schema);
}
function unpackOnline(message: ExternalMessage): BoundedContextOnline {
  const originalMessage = controlPayload(BoundedContextOnlineSchema, message);
  try {
    return fromBinary(BoundedContextOnlineSchema, originalMessage.value);
  } catch {
    throw new Error("Malformed integration control message.");
  }
}
function unpackWanted(message: ExternalMessage): ExternalEventsWanted {
  try {
    return fromBinary(
      ExternalEventsWantedSchema,
      controlPayload(ExternalEventsWantedSchema, message).value,
    );
  } catch {
    throw new Error("Malformed integration control message.");
  }
}
function controlPayload(schema: MessageSchema, message: ExternalMessage): Any {
  const originalMessage = message.originalMessage;
  if (!message.boundedContextName?.value || originalMessage?.typeUrl !== typeUrl(schema))
    throw new Error("Malformed integration control message.");
  return originalMessage;
}
