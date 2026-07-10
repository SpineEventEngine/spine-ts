import { Delivery } from "../delivery/delivery.js";
import type { InboxMessage } from "../delivery/inbox.js";

const drainLimit = 8;

export async function coordinateLocalInboxHandoff(options: {
  readonly handoffs: Map<string, Promise<InboxMessage>>;
  readonly key: string;
  readonly handoff: () => Promise<InboxMessage>;
}): Promise<InboxMessage> {
  const inFlightHandoff = options.handoffs.get(options.key);

  if (inFlightHandoff !== undefined) {
    return await inFlightHandoff;
  }

  const handoff = options.handoff();
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
    replay,
    replayFailureMessage,
    skippedMessage,
    unfinishedMessage,
  } = options;

  for (let attempt = 0; attempt < drainLimit; attempt += 1) {
    const run = await delivery.drainMessage(received, {
      node,
      onMessage: replay,
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
    if (run.claimed === 0 && run.delivered === 0 && run.failed === 0) {
      break;
    }
  }

  throw new Error(unfinishedMessage);
}

export interface LocalInboxDrainOptions {
  readonly delivery: Delivery;
  readonly received: InboxMessage;
  readonly node: string;
  readonly replay: (message: InboxMessage) => Promise<void> | void;
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
