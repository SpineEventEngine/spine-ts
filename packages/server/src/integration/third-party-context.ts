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

import { create, toBinary, type Message } from "@bufbuild/protobuf";
import { StringValueSchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { AnyMessages } from "@spine-event-engine/core";
import {
  ActorContextSchema,
  BoundedContextNameSchema,
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  UserIdSchema,
  type ActorContext,
  type UserId,
} from "@spine-event-engine/proto";

import { BoundedContext, boundedContextIntegrationAccess } from "../context/bounded-context.js";

/**
 * A hidden bounded context that imports third-party events through its broker.
 */
export class ThirdPartyContext {
  readonly #context: BoundedContext;
  readonly #multitenant: boolean;
  #closed = false;

  private constructor(context: BoundedContext, multitenant: boolean) {
    this.#context = context;
    this.#multitenant = multitenant;
  }

  /** Creates a third-party context that forbids actor tenants. */
  static singleTenant(name: string): Promise<ThirdPartyContext> {
    return Promise.resolve(new ThirdPartyContext(BoundedContext.singleTenant(name).build(), false));
  }

  /** Creates a third-party context that requires actor tenants. */
  static multitenant(name: string): Promise<ThirdPartyContext> {
    return Promise.resolve(new ThirdPartyContext(BoundedContext.multitenant(name).build(), true));
  }

  /** Publishes one imported event with the supplied actor identity. */
  async emittedEvent(event: Message, actor: ActorContext | UserId): Promise<void> {
    if (this.#closed) throw new Error("ThirdPartyContext is closed.");
    const actorContext = this.#actorContext(actor);
    const typeName = event.$typeName;
    if (typeof typeName !== "string" || typeName.length === 0) {
      throw new TypeError("ThirdPartyContext requires a generated event message.");
    }
    const envelope = create(EventSchema, {
      id: create(EventIdSchema, { value: crypto.randomUUID() }),
      message: {
        typeUrl: `type.googleapis.com/${typeName}`,
        value: ThirdPartyContext.#encodeMessage(event),
      },
      context: create(EventContextSchema, {
        timestamp: create(TimestampSchema),
        origin: { case: "importContext", value: actorContext },
        producerId: AnyMessages.pack(
          BoundedContextNameSchema,
          create(BoundedContextNameSchema, { value: this.#context.name.value }),
        ),
      }),
    });
    await boundedContextIntegrationAccess.publishImported(this.#context, envelope);
  }

  /** Returns whether the hidden bounded context is still available. */
  isOpen(): boolean {
    return !this.#closed;
  }

  /** Closes the hidden bounded context. */
  async close(): Promise<void> {
    if (this.#closed) return;
    await this.#context.close();
    this.#closed = true;
  }

  #actorContext(actor: ActorContext | UserId): ActorContext {
    const isUser = actor.$typeName === UserIdSchema.typeName;
    if (isUser) {
      if (this.#multitenant)
        throw new Error("Multitenant ThirdPartyContext requires ActorContext.");
      return create(ActorContextSchema, { actor });
    }
    const hasTenant = actor.tenantId?.kind.case !== undefined;
    if (this.#multitenant !== hasTenant) {
      throw new Error(
        this.#multitenant
          ? "Multitenant ThirdPartyContext requires actor tenantId."
          : "Single-tenant ThirdPartyContext forbids actor tenantId.",
      );
    }
    return actor;
  }

  static #encodeMessage(message: Message): Uint8Array {
    if (message.$typeName === StringValueSchema.typeName) {
      return toBinary(StringValueSchema, message as never);
    }
    throw new TypeError(
      "ThirdPartyContext cannot encode this message without its generated schema descriptor.",
    );
  }
}
