import { Delivery } from "../delivery/delivery.js";
import type { InboxMessage } from "../delivery/inbox.js";
import { ShardIndex } from "../delivery/shard-index.js";
import type { ProcessManagerInbox, ProcessManagerInboxTarget } from "../repository/repository.js";
import {
  configuredDeliveryEndpoint,
  coordinateLocalInboxHandoff,
  type DeliveryHandoff,
  deliveryEndpoint,
  deliveryReady,
  type DeliveryEndpoint,
  DeliveryReadiness,
  drainLocalInboxMessage,
  localInboxHandoffKey,
  type OnDeliveryReady,
} from "./local-inbox-handoff.js";

export class LocalProcessManagerInbox implements ProcessManagerInbox {
  readonly #contextName: string;
  readonly #targets = new Map<string, ProcessManagerInboxTarget>();
  readonly #endpoints = new Map<string, readonly DeliveryEndpoint[]>();
  readonly #readiness: DeliveryReadiness;
  readonly #keepTenant: (tenantId: string) => Promise<void>;
  readonly #inFlightHandoffs = new Map<string, Promise<InboxMessage>>();
  readonly #inFlightBatchHandoffs = new Map<string, Promise<readonly InboxMessage[]>>();
  #nextVersion = 0n;

  constructor(
    contextName: string,
    readiness: DeliveryReadiness | OnDeliveryReady = new DeliveryReadiness(),
    keepTenant: (tenantId: string) => Promise<void> = () => Promise.resolve(),
  ) {
    this.#contextName = contextName;
    this.#readiness =
      readiness instanceof DeliveryReadiness ? readiness : new DeliveryReadiness(readiness);
    this.#keepTenant = keepTenant;
  }

  register(target: ProcessManagerInboxTarget): void {
    this.#targets.set(target.targetTypeUrl, target);
    this.#endpoints.set(
      target.targetTypeUrl,
      Object.freeze(
        target.labels.map((label) =>
          deliveryEndpoint({
            label,
            inboxId: { targetTypeUrl: target.targetTypeUrl },
            shard: ShardIndex.single(),
          }),
        ),
      ),
    );
  }

  endpoints(): readonly DeliveryEndpoint[] {
    return Object.freeze([...this.#endpoints.values()].flat());
  }

  /** Replay one already-durable inbox row through registered process-manager targets. */
  replay(message: InboxMessage, deliveryTenantId?: string): Promise<void> {
    return this.#replay(message, deliveryTenantId);
  }

  async receive(
    delivery: Delivery,
    input: ProcessManagerInput,
    deliveryTenantId?: string,
  ): Promise<InboxMessage> {
    return await coordinateLocalInboxHandoff({
      handoffs: this.#inFlightHandoffs,
      key: localInboxHandoffKey(input, deliveryTenantId),
      onHandoff: () => this.#receiveAndDrain(delivery, input, deliveryTenantId),
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
    await this.#keepDeliveryTenant(deliveryTenantId);
    const written = await this.#writeInboxRow(delivery, input, new Date(), deliveryTenantId);

    await written.handoff.complete(() =>
      this.#drainInboxRow(delivery, written.message, deliveryTenantId),
    );
    return written.message;
  }

  async #receiveAndDrainAll(
    delivery: Delivery,
    inputs: ProcessManagerInputs,
    deliveryTenantId?: string,
  ): Promise<readonly InboxMessage[]> {
    await this.#keepDeliveryTenant(deliveryTenantId);
    const rows = this.#claimRows(inputs, deliveryTenantId);
    const whenReceived = new Date();
    const failures: unknown[] = [];

    try {
      await this.#writeRows(delivery, rows, whenReceived, deliveryTenantId, failures);
      await this.#drainRows(delivery, rows, deliveryTenantId, failures);
      if (failures.length > 0) {
        throw failures[0];
      }
      return Object.freeze(await Promise.all(rows.map(({ promise }) => promise)));
    } finally {
      this.#cleanupRows(rows);
    }
  }

  async #keepDeliveryTenant(deliveryTenantId: string | undefined): Promise<void> {
    if (deliveryTenantId !== undefined) {
      await this.#keepTenant(deliveryTenantId);
    }
  }

  async #writeRows(
    delivery: Delivery,
    rows: readonly BatchRow[],
    whenReceived: Date,
    deliveryTenantId: string | undefined,
    failures: unknown[],
  ): Promise<void> {
    for (const row of rows) {
      if (row.owner === undefined) {
        continue;
      }
      try {
        row.owner.written = await this.#writeInboxRow(
          delivery,
          row.input,
          whenReceived,
          deliveryTenantId,
        );
      } catch (error) {
        failures.push(error);
        return;
      }
    }
  }

  async #drainRows(
    delivery: Delivery,
    rows: readonly BatchRow[],
    deliveryTenantId: string | undefined,
    failures: unknown[],
  ): Promise<void> {
    for (const row of rows) {
      if (row.owner === undefined) {
        try {
          await row.promise;
        } catch (error) {
          failures.push(error);
        }
        continue;
      }
      const written = row.owner.written;
      if (written === undefined) {
        rejectRow(row.owner, failures[0]);
        continue;
      }
      try {
        await written.handoff.complete(() =>
          this.#drainInboxRow(delivery, written.message, deliveryTenantId),
        );
        resolveRow(row.owner, written.message);
      } catch (error) {
        failures.push(error);
        rejectRow(row.owner, error);
      }
    }
  }

  async #writeInboxRow(
    delivery: Delivery,
    input: ProcessManagerInput,
    whenReceived: Date,
    deliveryTenantId?: string,
  ): Promise<InboxWrite> {
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

    const endpoint =
      written.outcome === "WRITTEN"
        ? configuredDeliveryEndpoint(
            written.message,
            this.#endpoints.get(written.message.inboxId.targetTypeUrl) ?? [],
          )
        : undefined;

    return {
      message: written.message,
      handoff: this.#readiness.claim(
        endpoint === undefined ? undefined : deliveryReady(endpoint, deliveryTenantId),
      ),
    };
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
      onReplay: (nextMessage) => this.#replay(nextMessage, deliveryTenantId),
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
  written?: InboxWrite;
}

interface InboxWrite {
  readonly message: InboxMessage;
  readonly handoff: DeliveryHandoff;
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

function resolveRow(owner: InboxDeferred, message: InboxMessage): void {
  owner.settled = true;
  owner.resolve(message);
}

function rejectRow(owner: InboxDeferred, reason: unknown): void {
  owner.settled = true;
  owner.reject(reason);
}

function assertProcessManagerMessage(
  message: InboxMessage,
): asserts message is ProcessManagerMessage {
  if (message.label !== "HANDLE_COMMAND" && message.label !== "REACT_UPON_EVENT") {
    throw new Error(`BoundedContext delivery has no handler for inbox label "${message.label}".`);
  }
  if (message.status !== "TO_DELIVER") {
    throw new Error(
      `BoundedContext delivery cannot replay process-manager inbox message with status "${message.status}".`,
    );
  }
}
