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

import { clone, create, fromBinary } from "@bufbuild/protobuf";
import type { Any } from "@bufbuild/protobuf/wkt";
import type { MessageSchema } from "@spine-event-engine/core";
import {
  BoundedContextNameSchema,
  BoundedContextOnlineSchema,
  ChannelIdSchema,
  EventContextSchema,
  EventSchema,
  ExternalEventsWantedSchema,
  type BoundedContextName,
  type Event,
  type ExternalMessage,
} from "@spine-event-engine/proto";
import type {
  ConsumerHandle,
  Publisher,
  Subscriber,
  TransportFactory,
} from "@spine-event-engine/transport";

import { EventBus } from "../bus/event-bus.js";
import type { EventDispatcher } from "../bus/event-dispatcher.js";
import {
  unpackExternalEvent,
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
  #transition = Promise.resolve();
  #open: Promise<void> | undefined;
  #close: Promise<void> | undefined;
  #closed = false;
  #lastWanted: string | undefined;

  constructor(input: IntegrationBrokerInput) {
    this.#input = input;
  }

  /** Starts the three exchanges once; callers share the same readiness promise. */
  open(): Promise<void> {
    this.#open ??= this.#openOnce();
    return this.#open;
  }

  /** Stops intake, withdraws interests, drains accepted work, and attempts every cleanup. */
  close(): Promise<void> {
    this.#close ??= this.#closeOnce();
    return this.#close;
  }

  async #openOnce(): Promise<void> {
    const factory = this.#input.transportFactory;
    const status = await this.#attach(factory, onlineType, (message) => this.#onOnline(message));
    const config = await this.#attach(factory, wantedType, (message) => this.#onWanted(message));
    this.#resources.push(status, config);
    for (const schema of this.#input.externalEventSchemas) {
      const targetType = typeUrl(schema);
      this.#resources.push(
        await this.#attach(factory, targetType, (message) => this.#onEvent(message)),
      );
    }
    await this.#publishOnline();
    await this.#publishWanted(false);
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
    const online = unpackControl(BoundedContextOnlineSchema, message);
    if (this.#ignored(online.context)) return;
    await this.#publishWanted(true);
  }

  async #onWanted(message: ExternalMessage): Promise<void> {
    if (this.#ignored(message.boundedContextName)) return;
    const wanted = unpackControl(ExternalEventsWantedSchema, message);
    const requested = new Set<string>(
      wanted.type.map((entry: { typeUrl: string }) => entry.typeUrl).filter(Boolean),
    );
    await this.#enqueueTransition(async () =>
      this.#replaceWanted(message.boundedContextName!.value, requested),
    );
  }

  async #onEvent(message: ExternalMessage): Promise<void> {
    if (this.#ignored(message.boundedContextName)) return;
    const original = unpackExternalEvent(message);
    const imported = clone(EventSchema, original);
    imported.context = clone(EventContextSchema, imported.context ?? create(EventContextSchema));
    imported.context.external = true;
    await this.#input.postImported(imported);
  }

  async #replaceWanted(origin: string, next: ReadonlySet<string>): Promise<void> {
    const previous = this.#wantedByOrigin.get(origin) ?? new Set<string>();
    const add = [...next].filter(
      (type) => !previous.has(type) && !this.#wantedElsewhere(type, origin),
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
    this.#wantedByOrigin.set(origin, new Set(next));
    for (const publisher of acquired) this.#publishers.set(publisher.targetType, publisher);
    const errors: unknown[] = [];
    for (const targetType of remove) {
      const publisher = this.#publishers.get(targetType);
      if (publisher === undefined) continue;
      this.#publishers.delete(targetType);
      await collect(() => publisher.close(), errors);
    }
    if (errors.length) throw new AggregateError(errors, "Failed to remove domestic publisher.");
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
      await publisher.publish(frame.id!, frame);
    } finally {
      await publisher.close();
    }
  }

  async #publishWanted(force: boolean): Promise<void> {
    const types = [...new Set([...this.#input.externalEventSchemas].map(typeUrl))].sort();
    const fingerprint = types.join("\n");
    if (!force && this.#lastWanted === fingerprint) return;
    const publisher = await this.#input.transportFactory.createPublisher(channel(wantedType));
    try {
      const frame = wrapExternalEventsWanted(
        create(ExternalEventsWantedSchema, { type: types.map((typeUrl) => ({ typeUrl })) }),
        this.#input.contextName,
      );
      await publisher.publish(frame.id!, frame);
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
      await publisher.publish(frame.id!, frame);
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
        await publisher.publish(frame.id!, frame);
      },
    };
  }
  static async create(
    eventBus: EventBus,
    factory: TransportFactory,
    targetType: string,
    origin: BoundedContextName,
  ): Promise<DomesticPublisher> {
    const schema = eventBus.schema(targetType);
    if (schema === undefined)
      throw new Error(`No domestic Event schema registered for "${targetType}".`);
    const publisher = await factory.createPublisher(channel(targetType));
    const domestic = new DomesticPublisher(eventBus, publisher, targetType, origin, schema);
    eventBus.register(domestic.#dispatcher);
    return domestic;
  }
  close(): Promise<void> {
    this.#close ??= (async () => {
      this.#eventBus.unregister(this.#dispatcher);
      await this.#publisher.close();
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
function typeUrl(schema: { readonly typeName: string }): string {
  return `type.spine.io/${schema.typeName}`;
}
function unpackControl<Schema>(schema: any, message: ExternalMessage): any {
  if (!message.boundedContextName?.value || message.originalMessage?.typeUrl !== typeUrl(schema))
    throw new Error("Malformed integration control message.");
  try {
    return fromBinary(schema, message.originalMessage.value);
  } catch {
    throw new Error("Malformed integration control message.");
  }
}
