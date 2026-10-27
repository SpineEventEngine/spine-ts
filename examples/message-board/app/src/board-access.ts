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

import { create, equals } from "@bufbuild/protobuf";
import type {
  AuthenticatedPrincipal,
  AuthorizationPolicy,
  AuthorizedRequestContext,
  Clock,
  ContextResolver,
  IncomingRequest,
} from "@spine-event-engine/auth";
import {
  CommandIdSchema,
  OriginSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
} from "@spine-event-engine/proto";
import {
  BoardMessageViewSchema,
  BoardIdSchema,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import { TypeUrls, AnyPacker } from "@spine-event-engine/core";
import type { CompositeFilter, Filter, Target } from "@spine-event-engine/proto/client";
import {
  CompositeFilter_CompositeOperator,
  Filter_Operator,
} from "@spine-event-engine/proto/client";
import {
  PostMessageSchema,
  type PostMessage,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/commands_pb.js";
import { MessagePostedSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/events_pb.js";
import { MessageAlreadyPostedSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/rejections_pb.js";

const MAX_AUTHORIZATION_COMPOSITE_FILTERS = 8;
const MAX_AUTHORIZATION_SIMPLE_FILTERS = 16;

/**
 * Authorizes public-demo requests against their declared board and actor facts.
 */
export class BoardAccessPolicy implements AuthorizationPolicy {
  // prettier-ignore

  /**
   * Checks whether a public-demo request keeps its message author and board consistent.
   *
   * @param principal Supplies the Gateway-owned admission principal.
   * @param request Describes the command, query, subscription, or lifecycle call to authorize.
   * @returns A promise that resolves to `true` when allowed and `false` otherwise.
   */
  authorize(principal: AuthenticatedPrincipal, request: IncomingRequest): Promise<boolean> {
    if (principal.id === "spine-gateway-public" && !this.hasPublicActor(request))
      return Promise.resolve(false);
    if (request.kind === "activate" || request.kind === "cancel") return Promise.resolve(true);
    try {
      const boards = this.boardNames(principal);
      if (request.kind === "command" && request.message?.$typeName === PostMessageSchema.typeName) {
        const message = request.message as PostMessage;
        return Promise.resolve(
          message.author?.value === this.actorFor(principal, request) &&
          message.board !== undefined &&
          boards.includes(message.board.value),
        );
      }
      if (request.kind !== "query" && request.kind !== "subscribe") return Promise.resolve(false);
      if (request.kind === "subscribe" && this.authorizesPostOutcome(
        request.target, request.requestedContext, this.actorFor(principal, request),
      )) return Promise.resolve(true);
      return Promise.resolve(this.authorizesBoard(request.target, boards));
    } catch {
      return Promise.resolve(false);
    }
  }

  /**
   * Returns the actor allowed for this request.
   * @param principal The admitted principal.
   * @param request The decoded request.
   * @returns The authenticated or public-demo actor.
   */
  private actorFor(
    principal: AuthenticatedPrincipal,
    request: IncomingRequest,
  ): string | undefined {
    return principal.id === "spine-gateway-public"
      ? request.requestedContext.actor?.value
      : principal.id;
  }

  /**
   * Checks that a public request declares an actor.
   * @param request The decoded request.
   * @returns Whether a nonempty actor was declared.
   */
  private hasPublicActor(request: IncomingRequest): boolean {
    const actor = request.requestedContext.actor?.value;
    return actor !== undefined && actor.trim().length > 0;
  }

  /**
   * Returns the boards available to the admitted principal.
   * @param principal The admitted principal.
   * @returns Authorized board names.
   */
  private boardNames(principal: AuthenticatedPrincipal): readonly string[] {
    return principal.id === "spine-gateway-public"
      ? ["general"]
      : (principal.attributes?.boards?.split(",").filter(Boolean) ?? []);
  }

  /**
   * Checks a self-origin PostMessage outcome topic without broad Event visibility.
   * @param target The selected Event or rejection target.
   * @param context The subscription request context.
   * @param actor The authenticated or public-demo actor.
   * @returns Whether the topic is constrained to that actor's exact Command origin.
   */
  private authorizesPostOutcome(
    target: Target,
    context: ActorContext,
    actor: string | undefined,
  ): boolean {
    if (
      target.type !== TypeUrls.derive(MessagePostedSchema) &&
      target.type !== TypeUrls.derive(MessageAlreadyPostedSchema)
    )
      return false;
    if (actor === undefined || target.criterion.case !== "filters") return false;
    const filters = target.criterion.value;
    if (filters.idFilter !== undefined || filters.filter.length !== 1) return false;
    const composite = filters.filter[0];
    if (
      composite?.operator !== CompositeFilter_CompositeOperator.ALL ||
      composite.filter.length !== 1 ||
      composite.compositeFilter.length !== 0
    )
      return false;
    const filter = composite.filter[0];
    if (
      filter?.fieldPath?.fieldName.join(".") !== "context.past_message" ||
      filter.operator !== Filter_Operator.EQUAL
    )
      return false;
    return this.matchesPostOrigin(filter, context, actor);
  }

  /**
   * Checks the packed Command identity and actor for one allowed Event filter.
   * @param filter The exact Origin equality criterion.
   * @param context The subscription request context.
   * @param actor The admitted actor.
   * @returns Whether this is a self-origin PostMessage outcome.
   */
  private matchesPostOrigin(filter: Filter, context: ActorContext, actor: string): boolean {
    const origin =
      filter.value === undefined ? undefined : AnyPacker.tryUnpack(filter.value, OriginSchema);
    const id =
      origin?.message?.id === undefined
        ? undefined
        : AnyPacker.tryUnpack(origin.message.id, CommandIdSchema);
    return (
      id !== undefined &&
      id.uuid.trim().length > 0 &&
      origin?.message?.typeUrl === TypeUrls.derive(PostMessageSchema) &&
      origin.actorContext?.actor?.value === actor &&
      context.actor?.value === actor &&
      ((origin.actorContext.tenantId === undefined && context.tenantId === undefined) ||
        (origin.actorContext.tenantId !== undefined &&
          context.tenantId !== undefined &&
          equals(TenantIdSchema, origin.actorContext.tenantId, context.tenantId)))
    );
  }

  /**
   * Checks that a target remains within an allowed board.
   * @param target The query or subscription target.
   * @param boards The allowed board names.
   * @returns Whether every visible result is confined to an allowed board.
   */
  private authorizesBoard(target: Target, boards: readonly string[]): boolean {
    if (target.type !== TypeUrls.derive(BoardMessageViewSchema)) return false;
    if (target.criterion.case !== "filters") return false;
    const budget = {
      compositeFilters: MAX_AUTHORIZATION_COMPOSITE_FILTERS,
      simpleFilters: MAX_AUTHORIZATION_SIMPLE_FILTERS,
    };
    let authorized = false;
    for (const filter of target.criterion.value.filter) {
      authorized = this.guaranteesAuthorizedBoard(filter, boards, budget) || authorized;
      if (budget.compositeFilters < 0 || budget.simpleFilters < 0) return false;
    }
    return authorized;
  }

  /**
   * Checks whether a composite filter guarantees an authorized board.
   * @param composite The filter subtree.
   * @param boards The allowed board names.
   * @param budget The remaining bounded traversal count.
   * @returns Whether the subtree confines results to an allowed board.
   */
  private guaranteesAuthorizedBoard(
    composite: CompositeFilter,
    boards: readonly string[],
    budget: { compositeFilters: number; simpleFilters: number },
  ): boolean {
    budget.compositeFilters -= 1;
    budget.simpleFilters -= composite.filter.length;
    if (budget.compositeFilters < 0 || budget.simpleFilters < 0) return false;
    const guaranteed = composite.filter.map((filter) =>
      this.matchesAuthorizedBoard(filter, boards),
    );
    for (const child of composite.compositeFilter) {
      guaranteed.push(this.guaranteesAuthorizedBoard(child, boards, budget));
      if (budget.compositeFilters < 0 || budget.simpleFilters < 0) return false;
    }
    if (guaranteed.length === 0) return false;
    return composite.operator === CompositeFilter_CompositeOperator.ALL
      ? guaranteed.some(Boolean)
      : composite.operator === CompositeFilter_CompositeOperator.EITHER &&
          guaranteed.every(Boolean);
  }

  /**
   * Checks whether a simple filter selects one allowed board.
   * @param filter The simple filter.
   * @param boards The allowed board names.
   * @returns Whether the filter limits results to an allowed board.
   */
  private matchesAuthorizedBoard(
    filter: CompositeFilter["filter"][number],
    boards: readonly string[],
  ): boolean {
    if (
      filter.fieldPath?.fieldName.join(".") !== "board" ||
      filter.operator !== Filter_Operator.EQUAL
    ) {
      return false;
    }
    const board =
      filter.value === undefined ? undefined : AnyPacker.tryUnpack(filter.value, BoardIdSchema);
    return board !== undefined && boards.includes(board.value);
  }
}

/**
 * Rebuilds trusted public-demo actor context from a decoded request.
 */
export class BoardContextResolver implements ContextResolver {
  // prettier-ignore

  /**
   * Resolves trusted context for a gateway request.
   *
   * @param _principal Supplies the Gateway-owned admission principal.
   * @param request Supplies the decoded gateway request containing the chosen actor.
   * @param clock Supplies the gateway-owned timestamp.
   * @returns A promise that resolves to trusted actor, tenant, and timestamp context.
   */
  async resolve(
    _principal: AuthenticatedPrincipal,
    request: IncomingRequest,
    clock: Clock,
  ): Promise<AuthorizedRequestContext> {
    if (_principal.id !== "spine-gateway-public") return this.resolveContext(_principal, clock);
    const actor = request.requestedContext.actor?.value;
    if (actor === undefined || actor.length === 0) throw new Error("Public demo actor is required.");
    return Promise.resolve({ actor: create(UserIdSchema, { value: actor }), timestamp: clock.now() });
  }

  /**
   * Resolves the display-only public-demo context when no request is present.
   *
   * @param principal Identifies the authenticated MessageBoard actor.
   * @param clock Supplies the gateway-owned timestamp.
   * @returns A promise that resolves to trusted actor, tenant, and timestamp context.
   */
  resolveContext(
    principal: AuthenticatedPrincipal,
    clock: Clock,
  ): Promise<AuthorizedRequestContext> {
    const tenant = principal.attributes?.tenant;
    return Promise.resolve({
      actor: create(UserIdSchema, { value: principal.id }),
      ...(tenant === undefined
        ? {}
        : { tenant: create(TenantIdSchema, { kind: { case: "value", value: tenant } }) }),
      timestamp: clock.now(),
    });
  }
}
