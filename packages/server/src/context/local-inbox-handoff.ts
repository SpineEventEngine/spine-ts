import { Delivery, type DeliveryEndpointMessage } from "../delivery/delivery.js";
import type { InboxMessage } from "../delivery/inbox.js";
import { ShardIndex } from "../delivery/shard-index.js";

/** @internal Delivery labels backed by current worker endpoints. */
export type SupportedDeliveryLabel = DeliveryEndpointMessage["label"];

/** @internal One configured endpoint and shard obligation. */
export interface DeliveryEndpoint {
  readonly label: SupportedDeliveryLabel;
  readonly targetTypeUrl: string;
  readonly shard: ShardIndex;
}

/** @internal Post-persist readiness identity for one configured obligation. */
export interface DeliveryReady extends DeliveryEndpoint {
  readonly tenantId?: string;
}

/** @internal Synchronous readiness callback installed by context delivery ownership. */
export type OnDeliveryReady = (ready: DeliveryReady) => unknown;

/** @internal Mutable single-route readiness seam shared by context handoffs. */
export class DeliveryReadiness {
  #onReady: OnDeliveryReady;

  constructor(onReady: OnDeliveryReady = () => undefined) {
    this.#onReady = onReady;
  }

  onReady(onReady: OnDeliveryReady): () => void {
    this.#onReady = onReady;
    return () => {
      if (this.#onReady === onReady) {
        this.#onReady = () => undefined;
      }
    };
  }

  notify(endpoint: DeliveryEndpoint, tenantId?: string): void {
    const ready = Object.freeze({
      ...(tenantId === undefined ? {} : { tenantId }),
      label: endpoint.label,
      targetTypeUrl: endpoint.targetTypeUrl,
      shard: new ShardIndex(endpoint.shard.index, endpoint.shard.ofTotal),
    });

    try {
      const result = Reflect.apply(this.#onReady, undefined, [ready]);
      if (result instanceof Promise) {
        void result.catch(() => undefined);
      }
    } catch {
      // Readiness observation cannot alter durable receive or exact-drain outcomes.
    }
  }
}

const drainLimit = 8;

export async function coordinateLocalInboxHandoff(options: {
  readonly handoffs: Map<string, Promise<InboxMessage>>;
  readonly key: string;
  readonly onHandoff: () => Promise<InboxMessage>;
}): Promise<InboxMessage> {
  const inFlightHandoff = options.handoffs.get(options.key);

  if (inFlightHandoff !== undefined) {
    return await inFlightHandoff;
  }

  const handoff = options.onHandoff();
  options.handoffs.set(options.key, handoff);
  try {
    return await handoff;
  } finally {
    if (options.handoffs.get(options.key) === handoff) {
      options.handoffs.delete(options.key);
    }
  }
}

export async function drainLocalInboxMessage(options: LocalInboxDrainOptions): Promise<void> {
  await runLocalInboxDrain(options);
}

async function runLocalInboxDrain(options: LocalInboxDrainOptions): Promise<void> {
  const {
    delivery,
    received,
    node,
    onReplay,
    replayFailureMessage,
    skippedMessage,
    unfinishedMessage,
  } = options;

  for (let attempt = 0; attempt < drainLimit; attempt += 1) {
    const run = await delivery.drainMessage(received, {
      node,
      onMessage: onReplay,
    });
    const target = await delivery.inbox.readMessage(received.id);

    if (target?.status === "DELIVERED") {
      return;
    }

    const failure = run.failures.find(({ message }) => sameMessageId(message.id, received.id));

    if (failure !== undefined) {
      throw failure.error instanceof Error
        ? failure.error
        : new Error(replayFailureMessage, { cause: failure.error });
    }
    if (run.status === "SKIPPED") {
      throw new Error(skippedMessage);
    }
    if (run.accepted === 0 && run.delivered === 0 && run.failed === 0) {
      break;
    }
  }

  throw new Error(unfinishedMessage);
}

export interface LocalInboxDrainOptions {
  readonly delivery: Delivery;
  readonly received: InboxMessage;
  readonly node: string;
  readonly onReplay: (message: InboxMessage) => Promise<void> | void;
  readonly replayFailureMessage: string;
  readonly skippedMessage: string;
  readonly unfinishedMessage: string;
}

export interface LocalInboxKeyInput {
  readonly inboxId: {
    readonly targetId: string;
    readonly targetTypeUrl: string;
  };
  readonly signalId: string;
  readonly label: InboxMessage["label"];
  readonly shard: InboxMessage["shard"];
}

export function localInboxHandoffKey(input: LocalInboxKeyInput, deliveryTenantId?: string): string {
  return JSON.stringify([
    deliveryTenantId ?? "",
    input.label,
    input.signalId,
    input.inboxId.targetTypeUrl,
    input.inboxId.targetId,
    input.shard.index,
    input.shard.ofTotal,
  ]);
}

function sameMessageId(
  left: {
    readonly value: string;
    readonly shard: { readonly index: number; readonly ofTotal: number };
  },
  right: {
    readonly value: string;
    readonly shard: { readonly index: number; readonly ofTotal: number };
  },
): boolean {
  return (
    left.value === right.value &&
    left.shard.index === right.shard.index &&
    left.shard.ofTotal === right.shard.ofTotal
  );
}

export function deliveryEndpoint(input: {
  readonly label: SupportedDeliveryLabel;
  readonly inboxId: { readonly targetTypeUrl: string };
  readonly shard: ShardIndex;
}): DeliveryEndpoint {
  return Object.freeze({
    label: input.label,
    targetTypeUrl: input.inboxId.targetTypeUrl,
    shard: new ShardIndex(input.shard.index, input.shard.ofTotal),
  });
}
