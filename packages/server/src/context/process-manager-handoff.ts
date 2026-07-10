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
    const message = await this.#writeInboxRow(delivery, input, new Date());

    await this.#drainInboxRow(delivery, message, deliveryTenantId);
    return message;
  }

  async #receiveAndDrainAll(
    delivery: Delivery,
    inputs: ProcessManagerInputs,
    deliveryTenantId?: string,
  ): Promise<readonly InboxMessage[]> {
    const rows = this.#claimRows(inputs, deliveryTenantId);
    const whenReceived = new Date();

    try {
      for (const row of rows) {
        if (row.owner !== undefined) {
          row.owner.message = await this.#writeInboxRow(delivery, row.input, whenReceived);
        }
      }
      for (const row of rows) {
        if (row.owner === undefined) {
          await row.promise;
          continue;
        }
        const message = requireOwnedMessage(row);

        await this.#drainInboxRow(delivery, message, deliveryTenantId);
        resolveRow(row, message);
      }
      return Object.freeze(await Promise.all(rows.map(({ promise }) => promise)));
    } catch (error) {
      rejectRows(rows, error);
      throw error;
    } finally {
      this.#cleanupRows(rows);
    }
  }

  async #writeInboxRow(
    delivery: Delivery,
    input: ProcessManagerInput,
    whenReceived: Date,
  ): Promise<InboxMessage> {
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

    return written.message;
  }

  async #drainInboxRow(
    delivery: Delivery,
    message: InboxMessage,
    deliveryTenantId?: string,
  ): Promise<void> {
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

  #claimRows(inputs: ProcessManagerInputs, deliveryTenantId?: string): BatchRow[] {
    return inputs.map((input) => {
      const key = localInboxHandoffKey(input, deliveryTenantId);
      const inFlight = this.#inFlightHandoffs.get(key);

      if (inFlight !== undefined) {
        return { key, input, promise: inFlight };
      }

      const owner = createInboxDeferred();
      this.#inFlightHandoffs.set(key, owner.promise);
      return { key, input, promise: owner.promise, owner };
    });
  }

  #cleanupRows(rows: readonly BatchRow[]): void {
    for (const row of rows) {
      if (row.owner !== undefined && this.#inFlightHandoffs.get(row.key) === row.promise) {
        this.#inFlightHandoffs.delete(row.key);
      }
    }
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

type ProcessManagerInput = Parameters<ProcessManagerInbox["receive"]>[1];
type ProcessManagerInputs = Parameters<ProcessManagerInbox["receiveAll"]>[1];
type ProcessManagerMessage = Parameters<ProcessManagerInboxTarget["replay"]>[0];

interface InboxDeferred {
  readonly promise: Promise<InboxMessage>;
  readonly resolve: (message: InboxMessage) => void;
  readonly reject: (reason: unknown) => void;
  settled: boolean;
  message?: InboxMessage;
}

interface BatchRow {
  readonly key: string;
  readonly input: ProcessManagerInput;
  readonly promise: Promise<InboxMessage>;
  readonly owner?: InboxDeferred;
}

function createInboxDeferred(): InboxDeferred {
  let resolve!: (message: InboxMessage) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<InboxMessage>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  void promise.catch(() => undefined);

  return { promise, resolve, reject, settled: false };
}

function requireOwnedMessage(row: BatchRow): InboxMessage {
  if (row.owner?.message === undefined) {
    throw new Error("Process-manager inbox batch row was not written before drain.");
  }

  return row.owner.message;
}

function resolveRow(row: BatchRow, message: InboxMessage): void {
  if (row.owner === undefined || row.owner.settled) {
    return;
  }

  row.owner.settled = true;
  row.owner.resolve(message);
}

function rejectRows(rows: readonly BatchRow[], reason: unknown): void {
  for (const row of rows) {
    if (row.owner !== undefined && !row.owner.settled) {
      row.owner.settled = true;
      row.owner.reject(reason);
    }
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
