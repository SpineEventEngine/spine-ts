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
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { AnyMessages, TypeUrls } from "@spine-event-engine/core";
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
import { ServerEnvironment } from "../server/server-environment.js";

/**
 * Represents a hidden bounded context that imports third-party events through its private broker.
 *
 * The JVM-owned integration lifecycle remains private: this facade only creates the context,
 * publishes generated events, observes availability, and closes it.
 */
export class ThirdPartyContext {
  readonly #context: BoundedContext;
  readonly #multitenant: boolean;
  #closed = false;

  private constructor(context: BoundedContext, multitenant: boolean) {
    this.#context = context;
    this.#multitenant = multitenant;
  }

  /**
   * Creates a third-party context that forbids actor tenants.
   *
   * @param name Identifies the hidden bounded context.
   * @returns Resolves to an open single-tenant context.
   */
  static async singleTenant(name: string): Promise<ThirdPartyContext> {
    return new ThirdPartyContext(await BoundedContext.singleTenant(name).buildAsync(), false);
  }

  /**
   * Creates a third-party context that requires actor tenants.
   *
   * @param name Identifies the hidden bounded context.
   * @returns Resolves to an open multitenant context.
   */
  static async multitenant(name: string): Promise<ThirdPartyContext> {
    return new ThirdPartyContext(await BoundedContext.multitenant(name).buildAsync(), true);
  }

  /**
   * Publishes one generated event with its importing actor identity.
   *
   * @param event Supplies the generated event message to import unchanged.
   * @param actor Supplies a user or actor context that satisfies this context's tenancy policy.
   * @returns Completes when the private broker accepts the imported event, or rejects for a closed
   * context, an unsupported message, or incompatible actor tenancy.
   */
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
        typeUrl: this.#schema(typeName).typeUrl,
        value: toBinary(this.#schema(typeName).schema, event as never),
      },
      context: create(EventContextSchema, {
        timestamp: actorContext.timestamp ?? create(TimestampSchema),
        origin: { case: "importContext", value: actorContext },
        producerId: AnyMessages.pack(
          BoundedContextNameSchema,
          create(BoundedContextNameSchema, { value: this.#context.name.value }),
        ),
      }),
    });
    await boundedContextIntegrationAccess.publishImported(this.#context, envelope);
  }

  /**
   * Returns whether the hidden bounded context remains available for imports.
   *
   * @returns `true` until a successful close; `false` after it closes.
   */
  isOpen(): boolean {
    return !this.#closed;
  }

  /**
   * Closes the hidden bounded context and its private broker resources.
   *
   * @returns Completes after shutdown; repeated calls after a successful close do nothing.
   */
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

  #schema(typeName: string) {
    const metadata = ServerEnvironment.instance().typeRegistry.findByFullName(typeName);
    if (metadata === undefined) throw new TypeError(`ThirdPartyContext does not know ${typeName}.`);
    return { schema: metadata.schema, typeUrl: TypeUrls.derive(metadata.schema) };
  }
}
