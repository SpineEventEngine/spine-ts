/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { create, fromBinary } from "@bufbuild/protobuf";
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

/** Private context-owned exchange coordinator. */
export class IntegrationBroker {
  readonly #input: IntegrationBrokerInput;
  readonly #wantedByOrigin = new Map<string, ReadonlySet<string>>();
  readonly #publishers = new Map<string, DomesticPublisher>();
  readonly #resources: Closeable[] = [];
  readonly #externalSchemas: readonly MessageSchema[];
  #transition = Promise.resolve();
  #open: Promise<void> | undefined;
  #close: Promise<void> | undefined;
  #closed = false;
  #lastWanted: string | undefined;

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

  /** Starts the three exchanges once; callers share the same readiness promise. */
  open(): Promise<void> {
    if (this.#closed) return Promise.reject(new Error("IntegrationBroker is closed."));
    this.#open ??= this.#openOnce();
    return this.#open;
  }

  /** Stops intake, withdraws interests, drains accepted work, and attempts every cleanup. */
  close(): Promise<void> {
    this.#close ??= this.#closeOnce();
    return this.#close;
  }

  async #openOnce(): Promise<void> {
    try {
      const factory = this.#input.transportFactory;
      const status = await this.#attach(factory, onlineType, (message) => this.#onOnline(message));
      const config = await this.#attach(factory, wantedType, (message) => this.#onWanted(message));
      this.#resources.push(status, config);
      for (const schema of this.#externalSchemas) {
        const targetType = typeUrl(schema);
        this.#resources.push(
          await this.#attach(factory, targetType, (message) => this.#onEvent(message)),
        );
      }
      await this.#publishOnline();
      await this.#publishWanted(false);
    } catch (error) {
      await closeAll(this.#resources);
      this.#resources.length = 0;
      throw error;
    }
  }

  async #attach(
    factory: TransportFactory,
    targetType: string,
    consumer: (message: ExternalMessage) => Promise<void>,
  ): Promise<Closeable> {
    const subscriber = await factory.createSubscriber(channel(targetType));
    const handle = await subscriber.addConsumer(consumer);
    return new SubscriberResource(subscriber, handle);
  }

  async #onOnline(message: ExternalMessage): Promise<void> {
    if (this.#closed) return;
    const online = unpackControl<BoundedContextOnline>(BoundedContextOnlineSchema, message);
    if (this.#ignored(online.context)) return;
    await this.#publishWanted(true);
  }

  async #onWanted(message: ExternalMessage): Promise<void> {
    if (this.#closed) return;
    if (this.#ignored(message.boundedContextName)) return;
    const wanted = unpackControl<ExternalEventsWanted>(ExternalEventsWantedSchema, message);
    const requested = new Set<string>(
      wanted.type.map((entry: { typeUrl: string }) => entry.typeUrl).filter(Boolean),
    );
    const origin = message.boundedContextName?.value;
    if (origin === undefined) return;
    await this.#enqueueTransition(async () => this.#replaceWanted(origin, requested));
  }

  async #onEvent(message: ExternalMessage): Promise<void> {
    if (this.#closed) return;
    if (this.#ignored(message.boundedContextName)) return;
    const original = unpackExternalEvent(message);
    await this.#input.postImported(toExternalEvent(original));
  }

  async #replaceWanted(origin: string, next: ReadonlySet<string>): Promise<void> {
    const previous = this.#wantedByOrigin.get(origin) ?? new Set<string>();
    const add = [...next].filter(
      (type) =>
        !previous.has(type) &&
        !this.#wantedElsewhere(type, origin) &&
        eventBusAccess.schema(this.#input.eventBus, type) !== undefined,
    );
    const remove = [...previous].filter(
      (type) => !next.has(type) && !this.#wantedElsewhere(type, origin),
    );
    const acquired: DomesticPublisher[] = [];
    try {
      for (const targetType of add) {
        const publisher = await DomesticPublisher.create(
          this.#input.eventBus,
          this.#input.transportFactory,
          targetType,
          this.#input.contextName,
        );
        acquired.push(publisher);
      }
    } catch (error) {
      await closeAll(acquired);
      throw error;
    }
    const errors: unknown[] = [];
    for (const targetType of remove) {
      const publisher = this.#publishers.get(targetType);
      if (publisher === undefined) continue;
      await collect(() => publisher.close(), errors);
    }
    if (errors.length) {
      await closeAll(acquired);
      throw new AggregateError(errors, "Failed to remove domestic publisher.");
    }
    this.#wantedByOrigin.set(origin, new Set(next));
    for (const targetType of remove) this.#publishers.delete(targetType);
    for (const publisher of acquired) this.#publishers.set(publisher.targetType, publisher);
  }

  #wantedElsewhere(targetType: string, exceptOrigin: string): boolean {
    return [...this.#wantedByOrigin.entries()].some(
      ([origin, types]) => origin !== exceptOrigin && types.has(targetType),
    );
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
      await publisher.publish(frameIdentity(frame), frame);
    } finally {
      await publisher.close();
    }
  }

  async #publishWanted(force: boolean): Promise<void> {
    const types = this.#externalSchemas.map(typeUrl).sort();
    const fingerprint = types.join("\n");
    if (!force && this.#lastWanted === fingerprint) return;
    const publisher = await this.#input.transportFactory.createPublisher(channel(wantedType));
    try {
      const frame = wrapExternalEventsWanted(
        create(ExternalEventsWantedSchema, { type: types.map((typeUrl) => ({ typeUrl })) }),
        this.#input.contextName,
      );
      await publisher.publish(frameIdentity(frame), frame);
      this.#lastWanted = fingerprint;
    } finally {
      await publisher.close();
    }
  }

  #ignored(origin: BoundedContextName | undefined): boolean {
    const value = origin?.value;
    return (
      !value ||
      value === this.#input.contextName.value ||
      value === this.#input.pairedContextName?.value
    );
  }

  async #closeOnce(): Promise<void> {
    this.#closed = true;
    const errors: unknown[] = [];
    const opening = this.#open;
    if (opening !== undefined) await collect(() => opening, errors);
    await collect(() => this.#publishEmptyWanted(), errors);
    await this.#transition;
    await Promise.all(
      [...this.#publishers.values()].map((publisher) => collect(() => publisher.close(), errors)),
    );
    this.#publishers.clear();
    await Promise.all(this.#resources.map((resource) => collect(() => resource.close(), errors)));
    if (errors.length) {
      this.#close = undefined;
      throw new AggregateError(errors, "IntegrationBroker close failed.");
    }
  }

  async #publishEmptyWanted(): Promise<void> {
    const publisher = await this.#input.transportFactory.createPublisher(channel(wantedType));
    try {
      const frame = wrapExternalEventsWanted(
        create(ExternalEventsWantedSchema),
        this.#input.contextName,
      );
      await publisher.publish(frameIdentity(frame), frame);
    } finally {
      await publisher.close();
    }
  }
}

/** Minimal internal handoff for context assembly; it is not a public application API. */
export interface IntegrationBrokerInput {
  readonly contextName: BoundedContextName;
  readonly pairedContextName?: BoundedContextName;
  readonly transportFactory: TransportFactory;
  readonly eventBus: EventBus;
  readonly externalEventSchemas: Iterable<MessageSchema>;
  readonly postImported: (event: Event) => Promise<void>;
}

class DomesticPublisher implements Closeable {
  readonly targetType: string;
  readonly #eventBus: EventBus;
  readonly #dispatcher: EventDispatcher;
  readonly #publisher: Publisher;
  #close: Promise<void> | undefined;
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
        if (event.context?.external) return;
        const frame = wrapExternalEvent(event, origin);
        await publisher.publish(frameIdentity(frame), frame);
      },
    };
  }
  static async create(
    eventBus: EventBus,
    factory: TransportFactory,
    targetType: string,
    origin: BoundedContextName,
  ): Promise<DomesticPublisher> {
    const schema = eventBusAccess.schema(eventBus, targetType);
    if (schema === undefined)
      throw new Error(`No domestic Event schema registered for "${targetType}".`);
    const publisher = await factory.createPublisher(channel(targetType));
    const domestic = new DomesticPublisher(eventBus, publisher, targetType, origin, schema);
    eventBus.register(domestic.#dispatcher);
    return domestic;
  }
  close(): Promise<void> {
    this.#close ??= (async () => {
      await this.#publisher.close();
      eventBusAccess.unregister(this.#eventBus, this.#dispatcher);
    })();
    return this.#close;
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
    await this.handle.close();
    await this.subscriber.close();
  }
}
async function closeAll(resources: readonly Closeable[]): Promise<void> {
  await Promise.all(resources.map((resource) => resource.close()));
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
function unpackControl<Output>(schema: MessageSchema, message: ExternalMessage): Output {
  if (!message.boundedContextName?.value || message.originalMessage?.typeUrl !== typeUrl(schema))
    throw new Error("Malformed integration control message.");
  try {
    return fromBinary(schema as never, message.originalMessage.value) as Output;
  } catch {
    throw new Error("Malformed integration control message.");
  }
}
function frameIdentity(frame: ExternalMessage): Any {
  if (frame.id === undefined) throw new Error("External message requires an identity.");
  return frame.id;
}
