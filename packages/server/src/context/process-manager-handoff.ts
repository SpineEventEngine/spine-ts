import { Delivery } from "../delivery/delivery.js";
import type { InboxMessage } from "../delivery/inbox.js";
import type { ProcessManagerInbox, ProcessManagerInboxTarget } from "../repository/repository.js";

const processManagerDrainLimit = 8;

export class LocalProcessManagerInbox implements ProcessManagerInbox {
  readonly #contextName: string;
  readonly #targets = new Map<string, ProcessManagerInboxTarget>();
  #nextVersion = 0n;

  constructor(contextName: string) {
    this.#contextName = contextName;
  }

  register(target: ProcessManagerInboxTarget): void {
    this.#targets.set(target.targetTypeUrl, target);
  }

  async receive(
    delivery: Delivery,
    input: {
      readonly inboxId: {
        readonly targetId: string;
        readonly targetTypeUrl: string;
      };
      readonly signalId: string;
      readonly signal?: InboxMessage["signal"];
      readonly label: InboxMessage["label"];
      readonly status: InboxMessage["status"];
      readonly shard: InboxMessage["shard"];
      readonly keepUntil?: Date;
    },
    deliveryTenantId?: string,
  ): Promise<InboxMessage> {
    const written = await delivery.inbox.receive({
      inboxId: input.inboxId,
      signalId: input.signalId,
      label: input.label,
      status: input.status,
      shard: input.shard,
      whenReceived: new Date(),
      version: this.#takeVersion(),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      ...(input.keepUntil === undefined ? {} : { keepUntil: input.keepUntil }),
    });

    await this.#drainUntilDelivered(delivery, written.message, deliveryTenantId);
    return written.message;
  }

  #takeVersion(): bigint {
    this.#nextVersion += 1n;
    return this.#nextVersion;
  }

  async #drainUntilDelivered(
    delivery: Delivery,
    received: InboxMessage,
    deliveryTenantId?: string,
  ): Promise<void> {
    for (let attempt = 0; attempt < processManagerDrainLimit; attempt += 1) {
      const run = await delivery.drainMessage(received, {
        node: this.#contextName,
        onMessage: (message) => this.#replay(message, deliveryTenantId),
      });
      const target = await delivery.inbox.readMessage(received.id);

      if (target?.status === "DELIVERED") {
        return;
      }

      const failure = run.failures.find(({ message }) => sameMessageId(message.id, received.id));

      if (failure !== undefined) {
        throw failure.error instanceof Error
          ? failure.error
          : new Error("Process-manager inbox replay failed.", { cause: failure.error });
      }
      if (run.status === "SKIPPED") {
        throw new Error(
          "Process-manager inbox delivery was skipped before the target row was delivered.",
        );
      }
      if (run.processed === 0) {
        break;
      }
    }

    throw new Error(
      "Process-manager inbox delivery did not reach the target row before the local drain finished.",
    );
  }

  async #replay(message: InboxMessage, deliveryTenantId?: string): Promise<void> {
    if (message.label !== "HANDLE_COMMAND") {
      throw new Error(`BoundedContext delivery has no handler for inbox label "${message.label}".`);
    }

    const target = this.#targets.get(message.inboxId.targetTypeUrl);

    if (target === undefined) {
      throw new Error(
        `BoundedContext delivery has no process-manager command target for "${message.inboxId.targetTypeUrl}".`,
      );
    }

    await target.replay(message, deliveryTenantId);
  }
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
