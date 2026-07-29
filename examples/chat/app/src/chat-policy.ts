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
  ChatMessageViewSchema,
  ChatRoomIdSchema,
} from "@spine-event-engine/example-chat-model/generated/spine/example/chat/v1/chat_pb.js";
import { TypeUrls, AnyMessages } from "@spine-event-engine/core";
import type { CompositeFilter, Target } from "@spine-event-engine/proto/client";
import {
  CompositeFilter_CompositeOperator,
  Filter_Operator,
} from "@spine-event-engine/proto/client";
import {
  PostMessageSchema,
  type PostMessage,
} from "@spine-event-engine/example-chat-model/generated/spine/example/chat/v1/commands_pb.js";

const MAX_AUTHORIZATION_COMPOSITE_FILTERS = 8;
const MAX_AUTHORIZATION_SIMPLE_FILTERS = 16;

/** Application-owned Chat room and actor policy for the public auth gateway. */
export class ChatAuthorizationPolicy implements AuthorizationPolicy {
  authorize(principal: AuthenticatedPrincipal, request: IncomingRequest): Promise<boolean> {
    if (request.kind === "activate" || request.kind === "cancel") return Promise.resolve(true);
    const rooms = principal.attributes?.rooms?.split(",").filter(Boolean) ?? [];
    if (request.kind === "command" && request.message?.$typeName === PostMessageSchema.typeName) {
      const message = request.message as PostMessage;
      return Promise.resolve(
        message.author?.value === principal.id &&
          message.room !== undefined &&
          rooms.includes(message.room.value),
      );
    }
    if (request.kind !== "query" && request.kind !== "subscribe") return Promise.resolve(false);
    return Promise.resolve(roomIsAuthorized(request.target, rooms));
  }
}

function roomIsAuthorized(target: Target, rooms: readonly string[]): boolean {
  if (target.type !== TypeUrls.derive(ChatMessageViewSchema)) return false;
  if (target.criterion.case !== "filters") return false;
  const budget = {
    compositeFilters: MAX_AUTHORIZATION_COMPOSITE_FILTERS,
    simpleFilters: MAX_AUTHORIZATION_SIMPLE_FILTERS,
  };
  let authorized = false;
  for (const filter of target.criterion.value.filter) {
    authorized = guaranteesAuthorizedRoom(filter, rooms, budget) || authorized;
    if (budget.compositeFilters < 0 || budget.simpleFilters < 0) return false;
  }
  return authorized;
}

function guaranteesAuthorizedRoom(
  composite: CompositeFilter,
  rooms: readonly string[],
  budget: { compositeFilters: number; simpleFilters: number },
): boolean {
  budget.compositeFilters -= 1;
  budget.simpleFilters -= composite.filter.length;
  if (budget.compositeFilters < 0 || budget.simpleFilters < 0) return false;
  const guaranteed: boolean[] = [];
  for (const filter of composite.filter) {
    if (
      filter.fieldPath?.fieldName.join(".") !== "room" ||
      filter.operator !== Filter_Operator.EQUAL
    ) {
      guaranteed.push(false);
      continue;
    }
    const room =
      filter.value === undefined ? undefined : AnyMessages.unpack(filter.value, ChatRoomIdSchema);
    guaranteed.push(room !== undefined && rooms.includes(room.value));
  }
  for (const child of composite.compositeFilter) {
    guaranteed.push(guaranteesAuthorizedRoom(child, rooms, budget));
    if (budget.compositeFilters < 0 || budget.simpleFilters < 0) return false;
  }
  if (guaranteed.length === 0) return false;
  return composite.operator === CompositeFilter_CompositeOperator.ALL
    ? guaranteed.some(Boolean)
    : composite.operator === CompositeFilter_CompositeOperator.EITHER && guaranteed.every(Boolean);
}

/** Maps an authenticated Chat principal to the gateway-owned trusted actor context. */
export class ChatContextResolver implements ContextResolver {
  async resolve(
    principal: AuthenticatedPrincipal,
    _request: IncomingRequest,
    clock: Clock,
  ): Promise<AuthorizedRequestContext> {
    return this.resolveContext(principal, clock);
  }

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
