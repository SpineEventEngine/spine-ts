import { setTimeout as wait } from "node:timers/promises";

import { Delivery } from "../delivery/delivery.js";
import type { InboxMessage } from "../delivery/inbox.js";

const drainLimit = 8;
const duplicatePollLimit = 20;
const duplicatePollDelayMs = 5;

export async function drainLocalInboxMessage(options: LocalInboxDrainOptions): Promise<void> {
  const {
    delivery,
    received,
    node,
    replay,
    duplicate,
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
      if (
        duplicate &&
        received.status === "TO_DELIVER" &&
        (await waitUntilDelivered(delivery, received))
      ) {
        return;
      }
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

async function waitUntilDelivered(delivery: Delivery, received: InboxMessage): Promise<boolean> {
  for (let attempt = 0; attempt < duplicatePollLimit; attempt += 1) {
    await wait(duplicatePollDelayMs);
    const target = await delivery.inbox.readMessage(received.id);

    if (target?.status === "DELIVERED") {
      return true;
    }
  }

  return false;
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
