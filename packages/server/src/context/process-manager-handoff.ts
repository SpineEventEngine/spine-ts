import { Delivery } from "../delivery/delivery.js";
import type { InboxMessage } from "../delivery/inbox.js";
import type { ProcessManagerInbox, ProcessManagerInboxTarget } from "../repository/repository.js";
import {
  coordinateLocalInboxHandoff,
  drainLocalInboxMessage,
  localInboxHandoffKey,
} from "./local-inbox-handoff.js";

export class LocalProcessManagerInbox implements ProcessManagerInbox {
  readonly #contextName: string;
  readonly #targets = new Map<string, ProcessManagerInboxTarget>();
  readonly #inFlightHandoffs = new Map<string, Promise<InboxMessage>>();
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
    return await coordinateLocalInboxHandoff({
      handoffs: this.#inFlightHandoffs,
      key: localInboxHandoffKey(input, deliveryTenantId),
      handoff: () => this.#receiveAndDrain(delivery, input, deliveryTenantId),
    });
  }

  async #receiveAndDrain(
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

    await drainLocalInboxMessage({
      delivery,
      received: written.message,
      node: this.#contextName,
      replay: (message) => this.#replay(message, deliveryTenantId),
      duplicate: written.outcome === "DUPLICATE",
      replayFailureMessage: "Process-manager inbox replay failed.",
      skippedMessage:
        "Process-manager inbox delivery was skipped before the target row was delivered.",
      unfinishedMessage:
        "Process-manager inbox delivery did not reach the target row before the local drain finished.",
    });
    return written.message;
  }

  #takeVersion(): bigint {
    this.#nextVersion += 1n;
    return this.#nextVersion;
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
