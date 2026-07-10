import { Delivery } from "../delivery/delivery.js";
import type { InboxMessage } from "../delivery/inbox.js";
import type {
  ProcessManagerInbox,
  ProcessManagerInboxTarget,
} from "../repository/repository.js";
import {
  coordinateLocalInboxHandoff,
  drainLocalInboxMessage,
  localInboxHandoffKey,
} from "./local-inbox-handoff.js";

type ProcessManagerInput = Parameters<ProcessManagerInbox["receive"]>[1];
type ProcessManagerInputs = Parameters<ProcessManagerInbox["receiveAll"]>[1];
type ProcessManagerMessage = Parameters<ProcessManagerInboxTarget["replay"]>[0];

export class LocalProcessManagerInbox implements ProcessManagerInbox {
  readonly #contextName: string;
  readonly #targets = new Map<string, ProcessManagerInboxTarget>();
  readonly #inFlightHandoffs = new Map<string, Promise<InboxMessage>>();
  readonly #inFlightBatchHandoffs = new Map<string, Promise<readonly InboxMessage[]>>();
  #nextVersion = 0n;

  constructor(contextName: string) {
    this.#contextName = contextName;
  }

  register(target: ProcessManagerInboxTarget): void {
    this.#targets.set(target.targetTypeUrl, target);
  }

  async receive(
    delivery: Delivery,
    input: ProcessManagerInput,
    deliveryTenantId?: string,
  ): Promise<InboxMessage> {
    return await coordinateLocalInboxHandoff({
      handoffs: this.#inFlightHandoffs,
      key: localInboxHandoffKey(input, deliveryTenantId),
      handoff: () => this.#receiveAndDrain(delivery, input, deliveryTenantId),
    });
  }

  async receiveAll(
    delivery: Delivery,
    inputs: ProcessManagerInputs,
    deliveryTenantId?: string,
  ): Promise<readonly InboxMessage[]> {
    const key = this.#batchKey(inputs, deliveryTenantId);
    const inFlightHandoff = this.#inFlightBatchHandoffs.get(key);

    if (inFlightHandoff !== undefined) {
      return await inFlightHandoff;
    }

    const handoff = this.#receiveAndDrainAll(delivery, inputs, deliveryTenantId);
    this.#inFlightBatchHandoffs.set(key, handoff);
    try {
      return await handoff;
    } finally {
      if (this.#inFlightBatchHandoffs.get(key) === handoff) {
        this.#inFlightBatchHandoffs.delete(key);
      }
    }
  }

  async #receiveAndDrain(
    delivery: Delivery,
    input: ProcessManagerInput,
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
      replayFailureMessage: "Process-manager inbox replay failed.",
      skippedMessage:
        "Process-manager inbox delivery was skipped before the target row was delivered.",
      unfinishedMessage:
        "Process-manager inbox delivery did not reach the target row before the local drain finished.",
    });
    return written.message;
  }

  async #receiveAndDrainAll(
    delivery: Delivery,
    inputs: ProcessManagerInputs,
    deliveryTenantId?: string,
  ): Promise<readonly InboxMessage[]> {
    const whenReceived = new Date();
    const received: InboxMessage[] = [];

    for (const input of inputs) {
      const written = await delivery.inbox.receive({
        inboxId: input.inboxId,
        signalId: input.signalId,
        label: input.label,
        status: input.status,
        shard: input.shard,
        whenReceived,
        version: this.#takeVersion(),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        ...(input.keepUntil === undefined ? {} : { keepUntil: input.keepUntil }),
      });
      received.push(written.message);
    }

    for (const message of received) {
      await drainLocalInboxMessage({
        delivery,
        received: message,
        node: this.#contextName,
        replay: (nextMessage) => this.#replay(nextMessage, deliveryTenantId),
        replayFailureMessage: "Process-manager inbox replay failed.",
        skippedMessage:
          "Process-manager inbox delivery was skipped before the target row was delivered.",
        unfinishedMessage:
          "Process-manager inbox delivery did not reach the target row before the local drain finished.",
      });
    }

    return Object.freeze(received);
  }

  #takeVersion(): bigint {
    this.#nextVersion += 1n;
    return this.#nextVersion;
  }

  #batchKey(inputs: ProcessManagerInputs, deliveryTenantId?: string): string {
    return JSON.stringify(inputs.map((input) => localInboxHandoffKey(input, deliveryTenantId)));
  }

  async #replay(message: InboxMessage, deliveryTenantId?: string): Promise<void> {
    assertProcessManagerMessage(message);

    const target = this.#targets.get(message.inboxId.targetTypeUrl);

    if (target === undefined) {
      throw new Error(
        `BoundedContext delivery has no process-manager target for "${message.inboxId.targetTypeUrl}".`,
      );
    }

    await target.replay(message, deliveryTenantId);
  }
}

function assertProcessManagerMessage(message: InboxMessage): asserts message is ProcessManagerMessage {
  if (message.label !== "HANDLE_COMMAND" && message.label !== "REACT_UPON_EVENT") {
    throw new Error(`BoundedContext delivery has no handler for inbox label "${message.label}".`);
  }
  if (message.status !== "TO_DELIVER") {
    throw new Error(
      `BoundedContext delivery cannot replay process-manager inbox message with status "${message.status}".`,
    );
  }
}
