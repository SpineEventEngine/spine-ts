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

import { clone, create, fromBinary, type Message, type MessageShape } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { Code, ConnectError } from "@connectrpc/connect";
import { AnyPacker, TypeUrls, Validate } from "@spine-event-engine/core";
import type { AppQueryResponseFor } from "@spine-event-engine/core";
import {
  snapshotTrustedReader,
  type TrustedReaderContext,
} from "@spine-event-engine/core/spi/trusted-reader";
import {
  ActorContextSchema,
  ResponseSchema,
  StatusSchema,
  type ActorContext,
  type TenantId,
} from "@spine-event-engine/proto";
import {
  AppQuerySchema,
  AppQueryResponseSchema,
  QueryIdSchema,
  type AppQuery,
  type AppQueryResponse,
} from "@spine-event-engine/proto/client";
import { randomUUID } from "node:crypto";

import { AppQueryHandler, type AppQueryContext } from "../handler/app-query-handler.js";
import {
  SpineMetadataInventory,
  type AppQueryDescription,
} from "../handler/spine-metadata-inventory.js";
import { ReadRequestStatus } from "./read-request-status.js";
import type { EntityQueryDescription } from "@spine-event-engine/core/codegen";
import { processManagerQueryAccess } from "../entity/entity.js";
import type { DescriptorMessageSchema } from "../entity/entity-metadata.js";
import type { EntityQueryPlan } from "@spine-event-engine/core/spi/entity-query-plan";
import type { Query } from "@spine-event-engine/proto/client";
import { RegisteredTargets, type RegisteredTarget } from "./registered-targets.js";
import { QueryReader } from "./query-reader.js";
import { EffectiveTenants } from "../context/effective-tenant.js";
import { TenantAdmissions, TenantUnknownError } from "../context/tenant-unknown-error.js";
import { boundedContextAccess } from "../context/bounded-context.js";
import { ReadSideFilterEngine } from "../stand/read-side-filter-engine.js";
import type { ReadSideContext } from "../stand/read-side-filter.js";

/**
 * One explicitly selected application query implementation.
 */
interface QueryRoute {
  readonly handler: AppQueryHandler<never, Message>;
  readonly description: AppQueryDescription;
}

/**
 * Dispatches only the App Query handlers selected for one Server assembly.
 */
export class AppQueryExecution {
  readonly #active = new Set<Promise<unknown>>();

  #closing = false;

  readonly #routes = new Map<string, QueryRoute>();

  readonly #typedRoutes = new Map<string, QueryRoute>();

  readonly #targets: RegisteredTargets;

  readonly #serverFilters: ReadSideFilterEngine | undefined;

  readonly #readStatuses = new WeakSet<ConnectError>();

  /**
   * Resolves exact-class generated metadata before the Server listener opens.
   *
   * @param handlers Explicit handler instances selected by this Server.
   * @param targets Entity state routes installed in this Server.
   * @param serverFilters Policies applied only when the result crosses gRPC.
   */
  constructor(
    handlers: readonly AppQueryHandler<never, Message>[],
    targets: RegisteredTargets,
    serverFilters?: ReadSideFilterEngine,
  ) {
    this.#targets = targets;
    this.#serverFilters = serverFilters;
    const descriptions = SpineMetadataInventory.selectQueries(
      handlers.map((handler) => handler.constructor as AppQueryDescription["handlerType"]),
    );
    for (let index = 0; index < handlers.length; index++) {
      const handler = handlers[index];
      const description = descriptions[index];
      if (handler === undefined || description === undefined) continue;
      const typeUrl = TypeUrls.derive(description.querySchema);
      if (this.#routes.has(typeUrl))
        throw new Error(`Two App Query handlers are registered for ${typeUrl}.`);
      this.#routes.set(typeUrl, { handler, description });
      this.#typedRoutes.set(description.querySchema.typeName, { handler, description });
    }
  }

  /**
   * Executes one detached and validated App Query through its selected handler.
   *
   * @param input App Query envelope captured at the Server boundary.
   * @param reader Verified current invocation facts.
   * @param signal Current invocation cancellation, when available.
   * @returns One paired result in a successful response envelope.
   */
  execute(
    input: AppQuery,
    reader: TrustedReaderContext,
    signal?: AbortSignal,
  ): Promise<AppQueryResponse> {
    return this.#execute(input, reader, signal, true);
  }

  /**
   * Tracks one accepted handler call while selecting its outward boundary.
   *
   * @param input Captured application request.
   * @param reader Verified caller facts.
   * @param signal Current cancellation.
   * @param outward Whether the result leaves this Server over gRPC.
   * @returns Paired result and successful envelope.
   */
  #execute(
    input: AppQuery,
    reader: TrustedReaderContext,
    signal: AbortSignal | undefined,
    outward: boolean,
  ): Promise<AppQueryResponse> {
    if (this.#closing)
      return Promise.reject(new ConnectError("App Query execution is closed.", Code.Unavailable));
    const work = this.#run(input, reader, signal, outward);
    this.#active.add(work);
    void work.then(
      () => this.#active.delete(work),
      () => this.#active.delete(work),
    );
    return work;
  }

  /**
   * Stops accepting App Queries while allowing admitted work to settle.
   */
  beginClose(): void {
    this.#closing = true;
  }

  /**
   * Waits for admitted work without treating request failure as a close failure.
   *
   * @returns Completion after every admitted handler settles.
   */
  async drain(): Promise<void> {
    await Promise.allSettled(this.#active);
  }

  /**
   * Validates and invokes one admitted query inside a releasable read scope.
   *
   * @param input Captured application query envelope.
   * @param reader Verified current invocation facts.
   * @param signal Current invocation cancellation, when available.
   * @param outward Whether the final result crosses gRPC.
   * @returns One paired result in a successful response envelope.
   */
  async #run(
    input: AppQuery,
    reader: TrustedReaderContext,
    signal?: AbortSignal,
    outward = true,
  ): Promise<AppQueryResponse> {
    this.#checkCanceled(signal);
    const { query, route, request } = this.#validated(input);
    const { context, release } = this.#scope(query, reader, signal);
    try {
      const result = await this.#invoke(route, request, context);
      this.#checkCanceled(signal);
      return await this.#response(route, result, query, reader, signal, outward);
    } finally {
      release();
    }
  }

  /**
   * Wraps a generated application request and returns its paired generated result.
   *
   * @typeParam Q Generated request associated with a declared response.
   * @param request Request from trusted application code.
   * @param actor Current effective actor and tenant context.
   * @param reader Verified current identity and authority facts.
   * @param signal Current invocation cancellation, when available.
   * @returns The selected handler's paired generated result.
   */
  async executeTyped<Q extends Message>(
    request: Q,
    actor: ActorContext,
    reader: TrustedReaderContext,
    signal?: AbortSignal,
  ): Promise<AppQueryResponseFor<Q>> {
    this.#checkCanceled(signal);
    const route = this.#typedRoutes.get(request.$typeName);
    if (route === undefined)
      throw ReadRequestStatus.invalid("query", true, "App Query target is unsupported.");
    let message;
    try {
      message = AnyPacker.pack(route.description.querySchema, request);
    } catch {
      throw ReadRequestStatus.invalid("query", false, "App Query payload is malformed.");
    }
    const envelope = create(AppQuerySchema, {
      id: create(QueryIdSchema, { value: randomUUID() }),
      context: clone(ActorContextSchema, actor),
      message,
    });
    const response = await this.#execute(envelope, reader, signal, false);
    const packed = response.message[0];
    if (packed === undefined)
      throw new ConnectError("App Query response is missing.", Code.Internal);
    return AnyPacker.unpack(packed, route.description.responseSchema) as AppQueryResponseFor<Q>;
  }

  /**
   * Resolves the selected handler only after both envelope and root Q validation.
   *
   * @param input Captured application query envelope.
   * @returns Detached envelope, handler route, and decoded request.
   */
  #validated(input: AppQuery): { query: AppQuery; route: QueryRoute; request: Message } {
    const query = clone(AppQuerySchema, input);
    ReadRequestStatus.check("query", () => Validate.check(AppQuerySchema, query));
    const route = this.#routes.get(query.message?.typeUrl ?? "");
    if (route === undefined)
      throw ReadRequestStatus.invalid("query", true, "App Query target is unsupported.");
    const request = this.#decode(route, query);
    ReadRequestStatus.check("query", () => Validate.check(route.description.querySchema, request));
    return { query, route, request };
  }

  /**
   * Binds one invocation's actor and verified reader to its Entity read scope.
   *
   * @param query Validated detached envelope.
   * @param reader Verified facts for this operation.
   * @param signal Current invocation cancellation, when available.
   * @returns Context and release callback for this invocation only.
   */
  #scope(
    query: AppQuery,
    reader: TrustedReaderContext,
    signal?: AbortSignal,
  ): { context: AppQueryContext; release: () => void } {
    const scope = {};
    if (query.context === undefined)
      throw ReadRequestStatus.invalid("query", false, "App Query context is required.");
    const actor = clone(ActorContextSchema, query.context);
    const context = this.#context(scope, actor, reader, signal);
    const release = processManagerQueryAccess.bind(
      scope,
      (plan, schema, wire) => this.#read(plan, schema, wire, query, reader, signal),
      actor,
    );
    return { context, release };
  }

  /**
   * Builds the immutable handler view over one active read scope.
   *
   * @param scope Invocation binding used by the existing Entity read facade.
   * @param actor Detached effective actor and tenant.
   * @param reader Verified current identity and authority facts.
   * @param signal Current invocation cancellation, when available.
   * @returns A handler-facing capability that fails after release.
   */
  #context(
    scope: object,
    actor: ActorContext,
    reader: TrustedReaderContext,
    signal?: AbortSignal,
  ): AppQueryContext {
    const trusted = snapshotTrustedReader(reader);
    return Object.freeze({
      actorContext: actor,
      ...(trusted.principal === undefined ? {} : { principal: trusted.principal }),
      ...(trusted.authorityFacts === undefined ? {} : { authorityFacts: trusted.authorityFacts }),
      ...(signal === undefined ? {} : { signal }),

      /**
       * Selects an Entity read using this invocation's actor and registered targets.
       *
       * @typeParam Schema Generated state schema of the target Entity.
       * @typeParam Id Identifier type used by the Entity query description.
       * @param description Registered description of the target Entity.
       * @returns A typed read builder bound to this invocation.
       */
      select<Schema extends GenMessage<Message>, Id>(
        description: EntityQueryDescription<Schema, Id>,
      ) {
        return processManagerQueryAccess.select(scope, description);
      },
    });
  }

  /**
   * Calls one selected handler while mapping private failures to safe statuses.
   *
   * @param route Handler selected by exact Q type URL.
   * @param request Validated generated Q message.
   * @param context Current read and authority scope.
   * @returns Handler-produced paired response message.
   */
  async #invoke(route: QueryRoute, request: Message, context: AppQueryContext): Promise<Message> {
    try {
      return await route.handler.execute(request as never, context);
    } catch (error) {
      this.#checkCanceled(context.signal);
      if (error instanceof ConnectError && this.#readStatuses.has(error)) throw error;
      throw ReadRequestStatus.technical(error, "App Query execution failed.");
    }
  }

  /**
   * Checks the paired generated R type and serializes one successful result.
   *
   * @param route Selected handler's generated response schema.
   * @param result Handler-produced result message.
   * @param query Original validated application envelope.
   * @param reader Verified current reader facts.
   * @param signal Current cancellation, when supplied.
   * @param outward Whether the response crosses gRPC.
   * @returns Transport response with zero or one packed R.
   */
  async #response(
    route: QueryRoute,
    result: Message,
    query: AppQuery,
    reader: TrustedReaderContext,
    signal: AbortSignal | undefined,
    outward: boolean,
  ): Promise<AppQueryResponse> {
    if ((result as Message | undefined)?.$typeName !== route.description.responseSchema.typeName)
      throw new ConnectError("App Query response type is invalid.", Code.Internal);
    const visible = await this.#visibleResponse(route, result, query, reader, signal, outward);
    try {
      return create(AppQueryResponseSchema, {
        response: create(ResponseSchema, {
          status: create(StatusSchema, { status: { case: "ok", value: {} } }),
        }),
        message:
          visible === null ? [] : [AnyPacker.pack(route.description.responseSchema, visible)],
      });
    } catch {
      throw new ConnectError("App Query response is invalid.", Code.Internal);
    }
  }

  /**
   * Applies Server egress policy and maps policy faults to safe transport statuses.
   * @param route Selected Q/R pairing.
   * @param result Handler-produced response.
   * @param query Validated application query.
   * @param reader Verified invocation facts.
   * @param signal Current cancellation.
   * @param outward Whether this result crosses gRPC.
   * @returns Visible response or null when removed.
   */
  async #visibleResponse(
    route: QueryRoute,
    result: Message,
    query: AppQuery,
    reader: TrustedReaderContext,
    signal: AbortSignal | undefined,
    outward: boolean,
  ): Promise<Message | null> {
    if (!outward || this.#serverFilters === undefined) return result;
    try {
      return await this.#serverFilters.apply(route.description.responseSchema, result, {
        operation: { kind: "app-query", appQuery: query },
        ...(query.context === undefined ? {} : { actorContext: query.context }),
        ...(query.context?.tenantId === undefined
          ? {}
          : { effectiveTenant: query.context.tenantId }),
        ...reader,
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error) {
      throw ReadRequestStatus.technical(error, "App Query execution failed.");
    }
  }

  /**
   * Routes a handler's scoped Entity read through this Server's registered target.
   *
   * @typeParam Schema Generated Entity state schema selected by the handler.
   * @param plan Existing Entity query predicates and ordering.
   * @param schema Generated target state schema.
   * @param wire Query with the current trusted actor and tenant context.
   * @param enclosing Original application query using this child read.
   * @param reader Verified current reader facts.
   * @param signal Current invocation cancellation, checked before and after the read.
   * @returns Detached matching state snapshots.
   */
  async #read<Schema extends DescriptorMessageSchema>(
    plan: EntityQueryPlan,
    schema: Schema,
    wire: Query,
    enclosing: AppQuery,
    reader: TrustedReaderContext,
    signal?: AbortSignal,
  ): Promise<readonly MessageShape<Schema>[]> {
    this.#checkCanceled(signal);
    const target = this.#targets.find(TypeUrls.derive(schema));
    if (target === undefined)
      throw this.#readStatus(
        ReadRequestStatus.invalid("query", true, "Entity query target is unsupported."),
      );
    const visibility = target.repository.metadata.visibility;
    if (visibility !== "query" && visibility !== "full")
      throw this.#readStatus(
        new ConnectError("Entity query target is not visible.", Code.PermissionDenied),
      );
    this.#targets.validate(target, plan);
    const effective = await this.#admitTenant(target, wire);
    const destination = EffectiveTenants.destination(effective, target.context.isMultitenant);
    const result = await QueryReader.read(
      target.context.stand(),
      schema,
      plan,
      destination,
      1_000,
      wire,
      this.#childReadContext(wire, enclosing, target, reader, destination, signal),
    );
    this.#checkCanceled(signal);
    return Object.freeze(result.map((entry) => entry.state));
  }

  /**
   * Describes one handler-scoped Entity read with its actual target and reader.
   *
   * @param wire Current child Query.
   * @param enclosing Application Query using this read.
   * @param target Registered producing Entity route.
   * @param reader Verified invocation facts.
   * @param tenant Admitted destination tenant, if multitenant.
   * @param signal Current cancellation signal.
   * @returns Detached policy context for the producing Bounded Context.
   */
  #childReadContext(
    wire: Query,
    enclosing: AppQuery,
    target: RegisteredTarget,
    reader: TrustedReaderContext,
    tenant: TenantId | undefined,
    signal?: AbortSignal,
  ): ReadSideContext {
    return {
      operation: { kind: "query", query: wire },
      enclosingAppQuery: enclosing,
      ...(wire.context === undefined ? {} : { actorContext: wire.context }),
      ...(tenant === undefined ? {} : { effectiveTenant: tenant }),
      producingContext: target.context,
      ...reader,
      ...(signal === undefined ? {} : { signal }),
    };
  }

  /**
   * Checks target tenancy before a scoped Entity read.
   *
   * @param target Registered target selected by state schema.
   * @param wire Query carrying the effective actor and tenant.
   * @returns The resolved tenant scope for destination lookup.
   */
  async #admitTenant(target: RegisteredTarget, wire: Query) {
    const tenantId = wire.context?.tenantId;
    if (target.context.isMultitenant && tenantId === undefined)
      throw this.#readStatus(
        ReadRequestStatus.tenant("TENANT_REQUIRED", "Tenant is required for this query."),
      );
    if (!target.context.isMultitenant && tenantId !== undefined)
      throw this.#readStatus(
        ReadRequestStatus.tenant("TENANT_INAPPLICABLE", "Tenant is not applicable for this query."),
      );
    const effective = EffectiveTenants.current(target.context.isMultitenant, tenantId);
    try {
      await boundedContextAccess.admitServiceInput(target.context, tenantId, () =>
        TenantAdmissions.require(
          target.context.tenantIndex,
          target.context.name.value,
          target.context.isMultitenant,
          tenantId,
        ),
      );
    } catch (error) {
      if (error instanceof TenantUnknownError)
        throw this.#readStatus(ReadRequestStatus.unknownTenant(error));
      throw error;
    }
    return effective;
  }

  /**
   * Marks a status produced by Server read admission for safe propagation.
   *
   * @param error Structured read failure from this execution scope.
   * @returns The same status for throwing through the handler boundary.
   */
  #readStatus(error: ConnectError): ConnectError {
    this.#readStatuses.add(error);
    return error;
  }

  /**
   * Stops a canceled invocation before more handler or read work occurs.
   *
   * @param signal Current cancellation signal, when supplied.
   */
  #checkCanceled(signal?: AbortSignal): void {
    if (signal?.aborted) throw new ConnectError("App Query was canceled.", Code.Canceled);
  }

  /**
   * Rejects malformed known request bytes before invoking a handler.
   *
   * @param route Selected handler and generated request schema.
   * @param query Validated App Query envelope.
   * @returns Decoded generated Q message.
   */
  #decode(route: QueryRoute, query: AppQuery): Message {
    try {
      if (query.message === undefined) throw new Error("Missing App Query message.");
      return fromBinary(route.description.querySchema, query.message.value);
    } catch {
      throw ReadRequestStatus.invalid("query", false, "App Query payload is malformed.");
    }
  }
}
