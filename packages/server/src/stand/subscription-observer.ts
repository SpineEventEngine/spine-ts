import type { MessageSchema } from "@spine-event-engine/core";
import type { Event, TenantId } from "@spine-event-engine/proto";
import type { Subscription } from "@spine-event-engine/proto/client";

import { eventBusAccess, type EventBus, type EventSubscription } from "../bus/event-bus.js";
import type { StandSubscription, StandUpdate } from "./stand.js";

/**
 * Delivers one locally observed signal for a canonical Stand subscription.
 *
 * This is an internal boundary: Stand owns observation and lifecycle while
 * service adapters translate an already-observed signal to their wire format.
 *
 * @internal
 */
export type StandSubscriptionSignal =
  | { readonly kind: "event"; readonly event: Event }
  | { readonly kind: "state"; readonly update: StandUpdate };

/**
 * Attaches one active canonical definition to this node's local buses.
 *
 * The caller supplies state lookup and subscription operations so this module
 * stays independent from Stand's storage implementation.
 *
 * @internal
 */
export function observeSubscription(
  subscription: Subscription,
  eventBus: EventBus | undefined,
  findState: (typeUrl: string) => MessageSchema | undefined,
  subscribeState: (
    schema: MessageSchema,
    callback: (update: StandUpdate) => void,
    tenantId: string | undefined,
  ) => StandSubscription,
  onSignal: (signal: StandSubscriptionSignal) => void,
): StandSubscription | EventSubscription | undefined {
  const target = subscription.topic?.target;
  const typeUrl = target?.type;
  if (typeUrl === undefined || typeUrl.length === 0) return undefined;
  const tenantId = tenantValue(subscription.topic?.context?.tenantId);
  const state = findState(typeUrl);
  if (state !== undefined) {
    return subscribeState(
      state,
      (update) => {
        onSignal({ kind: "state", update });
      },
      tenantId === undefined || tenantId.length === 0 ? undefined : tenantId,
    );
  }
  if (eventBus === undefined) return undefined;
  return eventBusAccess.subscribe(eventBus, typeUrl, {
    onEvent(event) {
      onSignal({ kind: "event", event });
    },
  });
}

function tenantValue(tenant: TenantId | undefined): string | undefined {
  switch (tenant?.kind.case) {
    case "value":
      return tenant.kind.value;
    case "domain":
      return `domain:${tenant.kind.value.value}`;
    case "email":
      return `email:${tenant.kind.value.value}`;
    default:
      return undefined;
  }
}
