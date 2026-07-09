import { Delivery } from "../delivery/delivery.js";
import type { InboxMessage } from "../delivery/inbox.js";

const drainLimit = 8;
const inFlightDrains = new WeakMap<Delivery, Map<string, Promise<void>>>();

export async function drainLocalInboxMessage(options: LocalInboxDrainOptions): Promise<void> {
  const messageKey = inboxMessageKey(options.received);
  const drains = localInFlightDrains(options.delivery);
  const inFlightDrain = drains.get(messageKey);

  if (options.duplicate && inFlightDrain !== undefined) {
    await inFlightDrain;
    return;
  }

  const drain = runLocalInboxDrain(options);
  drains.set(messageKey, drain);
  try {
    await drain;
  } finally {
    if (drains.get(messageKey) === drain) {
      drains.delete(messageKey);
    }
  }
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
    if (run.processed === 0) {
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
  readonly duplicate: boolean;
  readonly replayFailureMessage: string;
  readonly skippedMessage: string;
  readonly unfinishedMessage: string;
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

function localInFlightDrains(delivery: Delivery): Map<string, Promise<void>> {
  let drains = inFlightDrains.get(delivery);

  if (drains === undefined) {
    drains = new Map();
    inFlightDrains.set(delivery, drains);
  }

  return drains;
}

function inboxMessageKey(message: InboxMessage): string {
  return `${message.id.value}:${String(message.id.shard.index)}/${String(message.id.shard.ofTotal)}`;
}
