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

import { create, type Message } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { AnyPacker, Time } from "@spine-event-engine/core";
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

import {
  BoundedContext,
  boundedContextAccess,
  boundedContextIntegrationAccess,
  type BoundedContextBuilder,
} from "../context/bounded-context.js";
import { ServerEnvironment } from "../server/server-environment.js";
import { InMemorySubscriptionRegistry } from "../stand/subscription-registry.js";

const declarations = new WeakMap<
  ThirdPartyContext,
  {
    readonly builder: BoundedContextBuilder;
    readonly attach: (context: BoundedContext, environment: ServerEnvironment) => void;
    readonly isAttached: () => boolean;
  }
>();

/**
 * Represents a hidden bounded context that imports third-party events through its private broker.
 *
 * The JVM-owned integration lifecycle remains private: this facade only creates the context,
 * publishes generated events, observes availability, and closes it.
 */
export class ThirdPartyContext {
  #context: BoundedContext | undefined;

  #environment: ServerEnvironment | undefined;

  readonly #multitenant: boolean;

  #closed = false;

  /**
   * Stores the declaration builder and tenant policy until Application assembly.
   * @param builder Builds the hidden Bounded Context after attachment.
   * @param multitenant Whether importing actors must include a tenant.
   */
  private constructor(builder: BoundedContextBuilder, multitenant: boolean) {
    this.#multitenant = multitenant;
    declarations.set(this, {
      builder,
      attach: (context, environment) => {
        if (this.#context !== undefined) throw new Error("ThirdPartyContext is already attached.");
        this.#context = context;
        this.#environment = environment;
      },
      isAttached: () => this.#context !== undefined,
    });
  }

  /**
   * Creates a third-party context that forbids actor tenants.
   *
   * @param name Identifies the hidden bounded context.
   * @returns An unattached single-tenant declaration.
   */
  static singleTenant(name: string): ThirdPartyContext {
    return new ThirdPartyContext(
      BoundedContext.singleTenant(name).withSubscriptionRegistry(
        new InMemorySubscriptionRegistry(),
      ),
      false,
    );
  }

  /**
   * Creates an unattached declaration requiring tenant identities on imported Events.
   *
   * @param name Names the hidden Bounded Context.
   * @returns A declaration to add to an Application.
   */
  static multiTenant(name: string): ThirdPartyContext {
    return new ThirdPartyContext(
      BoundedContext.multiTenant(name).withSubscriptionRegistry(new InMemorySubscriptionRegistry()),
      true,
    );
  }

  /* eslint-disable @typescript-eslint/unified-signatures --
   * Frozen JVM public contract requires distinct actor overloads.
   */

  /**
   * Publishes one generated event with its importing actor identity.
   *
   * @param event Supplies the generated event message to import unchanged.
   * @param actor Supplies a user or actor context that satisfies this context's tenancy policy.
   * @returns Completes when the private broker accepts the imported event, or rejects for a closed
   * context, an unsupported message, or incompatible actor tenancy.
   */
  emittedEvent(event: Message, actor: ActorContext): Promise<void>;

  /**
   * Publishes one generated event with a user identity in a single-tenant context.
   *
   * @param event Supplies the generated event message to import unchanged.
   * @param actor Supplies the importing user identity.
   * @returns Completes when the private broker accepts the imported event.
   */
  emittedEvent(event: Message, actor: UserId): Promise<void>;

  /**
   * Publishes one generated event with its importing actor identity.
   *
   * @param event Supplies the generated event message to import unchanged.
   * @param actor Supplies a user or actor context that satisfies this context's tenancy policy.
   * @returns Completes when the private broker accepts the imported event.
   */
  async emittedEvent(event: Message, actor: ActorContext | UserId): Promise<void> {
    const context = this.#context;
    if (context === undefined)
      throw new Error("ThirdPartyContext is not attached to an Application.");
    if (!this.isOpen()) throw new Error("ThirdPartyContext is closed.");
    const actorContext = this.#actorContext(actor);
    const typeName = event.$typeName;
    if (typeof typeName !== "string" || typeName.length === 0) {
      throw new TypeError("ThirdPartyContext requires a generated event message.");
    }
    const envelope = create(EventSchema, {
      id: create(EventIdSchema, { value: crypto.randomUUID() }),
      message: AnyPacker.pack(this.#schema(typeName), event as never),
      context: create(EventContextSchema, {
        timestamp: actorContext.timestamp ?? create(TimestampSchema),
        origin: { case: "importContext", value: actorContext },
        producerId: AnyPacker.pack(
          BoundedContextNameSchema,
          create(BoundedContextNameSchema, { value: context.name.value }),
        ),
      }),
    });
    await boundedContextIntegrationAccess.publishImported(context, envelope);
  }
  /* eslint-enable @typescript-eslint/unified-signatures */

  /**
   * Returns whether the hidden bounded context remains available for imports.
   *
   * @returns `true` until a successful close; `false` after it closes.
   */
  isOpen(): boolean {
    return (
      this.#context !== undefined && !this.#closed && !boundedContextAccess.isClosing(this.#context)
    );
  }

  /**
   * Closes the hidden bounded context and its private broker resources.
   *
   * @returns Completes after shutdown; repeated calls after a successful close do nothing.
   */
  async close(): Promise<void> {
    if (this.#closed) return;
    if (this.#context === undefined) return;
    await this.#context.close();
    this.#closed = true;
  }

  #actorContext(actor: ActorContext | UserId): ActorContext {
    const isUser = actor.$typeName === UserIdSchema.typeName;
    if (isUser) {
      if (this.#multitenant)
        throw new Error("Multitenant ThirdPartyContext requires ActorContext.");
      return create(ActorContextSchema, {
        actor,
        timestamp: Time.currentTime(),
      });
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
    const metadata = this.#environment?.typeRegistry.findByFullName(typeName);
    if (metadata === undefined) throw new TypeError(`ThirdPartyContext does not know ${typeName}.`);
    return metadata.schema;
  }
}

/**
 * Exposes declaration attachment only to Application assembly.
 *
 * @internal
 */
export const thirdPartyAccess: Readonly<{
  /**
   * Returns the hidden Bounded Context builder.
   */
  builder(context: ThirdPartyContext): BoundedContextBuilder;

  /**
   * Reports whether an Application has attached the declaration.
   */
  isAttached(context: ThirdPartyContext): boolean;

  /**
   * Attaches a hidden context after successful Application startup.
   */
  attach(context: ThirdPartyContext, built: BoundedContext, environment: ServerEnvironment): void;
}> = Object.freeze({
  /**
   * Returns the hidden Bounded Context builder.
   */
  builder(context: ThirdPartyContext): BoundedContextBuilder {
    const declaration = declarations.get(context);
    if (declaration === undefined) throw new TypeError("Expected a ThirdPartyContext.");
    return declaration.builder;
  },

  /**
   * Reports whether an Application has attached the declaration.
   */
  isAttached(context: ThirdPartyContext): boolean {
    return declarations.get(context)?.isAttached() ?? false;
  },

  /**
   * Attaches a hidden context after successful Application startup.
   */
  attach(context: ThirdPartyContext, built: BoundedContext, environment: ServerEnvironment): void {
    const declaration = declarations.get(context);
    if (declaration === undefined) throw new TypeError("Expected a ThirdPartyContext.");
    declaration.attach(built, environment);
  },
});
