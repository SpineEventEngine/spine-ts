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
import { create } from "@bufbuild/protobuf";
import type {
  AuthenticatedPrincipal,
  AuthorizationPolicy,
  AuthorizedRequestContext,
  Clock,
  ContextResolver,
  IncomingRequest,
} from "@spine-event-engine/auth";
import { TenantIdSchema, UserIdSchema } from "@spine-event-engine/proto";
import {
  BoardMessageViewSchema,
  BoardIdSchema,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import { TypeUrls, AnyMessages } from "@spine-event-engine/core";
import type { CompositeFilter, Target } from "@spine-event-engine/proto/client";
import {
  CompositeFilter_CompositeOperator,
  Filter_Operator,
} from "@spine-event-engine/proto/client";
import {
  PostMessageSchema,
  type PostMessage,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/commands_pb.js";

const MAX_AUTHORIZATION_COMPOSITE_FILTERS = 8;
const MAX_AUTHORIZATION_SIMPLE_FILTERS = 16;

/**
 * Authorizes MessageBoard requests against the authenticated actor's board access.
 */
export class BoardAccessPolicy implements AuthorizationPolicy {
  // prettier-ignore

  /**
   * Checks whether an authenticated principal may make a MessageBoard request.
   *
   * @param principal Identifies the authenticated actor and permitted boards.
   * @param request Describes the command, query, subscription, or lifecycle call to authorize.
   * @returns A promise that resolves to `true` when allowed and `false` otherwise.
   */
  authorize(principal: AuthenticatedPrincipal, request: IncomingRequest): Promise<boolean> {
    if (request.kind === "activate" || request.kind === "cancel") return Promise.resolve(true);
    try {
      const boards = this.boardNames(principal);
      if (request.kind === "command" && request.message?.$typeName === PostMessageSchema.typeName) {
        const message = request.message as PostMessage;
        return Promise.resolve(
          message.author?.value === principal.id &&
            message.board !== undefined &&
            boards.includes(message.board.value),
        );
      }
      if (request.kind !== "query" && request.kind !== "subscribe") return Promise.resolve(false);
      return Promise.resolve(this.authorizesBoard(request.target, boards));
    } catch {
      return Promise.resolve(false);
    }
  }

  private boardNames(principal: AuthenticatedPrincipal): readonly string[] {
    return principal.attributes?.boards?.split(",").filter(Boolean) ?? [];
  }

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
      filter.value === undefined ? undefined : AnyMessages.unpack(filter.value, BoardIdSchema);
    return board !== undefined && boards.includes(board.value);
  }
}

/**
 * Resolves trusted actor context for an authenticated MessageBoard principal.
 */
export class BoardContextResolver implements ContextResolver {
  // prettier-ignore

  /**
   * Resolves trusted context for a gateway request.
   *
   * @param principal Identifies the authenticated MessageBoard actor.
   * @param _request Supplies the gateway request whose context is being resolved.
   * @param clock Supplies the gateway-owned timestamp.
   * @returns A promise that resolves to trusted actor, tenant, and timestamp context.
   */
  async resolve(
    principal: AuthenticatedPrincipal,
    _request: IncomingRequest,
    clock: Clock,
  ): Promise<AuthorizedRequestContext> {
    return this.resolveContext(principal, clock);
  }

  /**
   * Resolves trusted context from an authenticated principal.
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
