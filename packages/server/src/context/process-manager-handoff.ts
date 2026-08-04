import { Delivery } from "../delivery/delivery.js";
import { type DeliveryStrategy, UniformAcrossAllShards } from "../delivery/delivery-builder.js";
import type { InboxMessage } from "../delivery/inbox.js";
import { ShardIndex } from "../delivery/shard-index.js";
import type { ProcessManagerInbox, ProcessManagerInboxTarget } from "../repository/repository.js";
import {
  type DeliveryHandoff,
  type DeliveryEndpoint,
  DeliveryReadiness,
  InboxHandoff,
  type OnDeliveryReady,
} from "./local-inbox-handoff.js";

/**
 * Persists and replays delivery rows for process-manager handlers.
 */
export class LocalProcessManagerInbox implements ProcessManagerInbox {
  readonly #contextName: string;
  readonly #targets = new Map<string, ProcessManagerInboxTarget>();
  readonly #endpoints = new Map<string, readonly DeliveryEndpoint[]>();
  readonly #readiness: DeliveryReadiness;
  readonly #keepTenant: (tenantId: string) => Promise<void>;
  readonly #strategy: DeliveryStrategy;
  readonly #inFlightHandoffs = new Map<string, Promise<InboxMessage>>();
  readonly #inFlightBatchHandoffs = new Map<string, Promise<readonly InboxMessage[]>>();
  #nextVersion = 0n;

  /**
   * Creates a local process-manager inbox.
   * @param contextName Names the bounded context that owns this inbox.
   * @param readiness Coordinates delivery readiness after persistence.
   * @param keepTenant Records a tenant before its message is persisted.
   */
  constructor(
    contextName: string,
    readiness: DeliveryReadiness | OnDeliveryReady = new DeliveryReadiness(),
    keepTenant: (tenantId: string) => Promise<void> = () => Promise.resolve(),
    strategy: DeliveryStrategy = UniformAcrossAllShards.singleShard(),
  ) {
    this.#contextName = contextName;
    this.#readiness =
      readiness instanceof DeliveryReadiness ? readiness : new DeliveryReadiness(readiness);
    this.#keepTenant = keepTenant;
    this.#strategy = strategy;
  }

  /**
   * Registers a target that replays process-manager messages.
   * @param target Handles messages for one process-manager type.
   */
  register(target: ProcessManagerInboxTarget): void {
    this.#targets.set(target.targetTypeUrl, target);
    this.#endpoints.set(
      target.targetTypeUrl,
      Object.freeze(
        target.labels.flatMap((label) =>
          Array.from({ length: this.#strategy.shardCount }, (_, index) =>
            InboxHandoff.endpoint({
              label,
              inboxId: { targetTypeUrl: target.targetTypeUrl },
              shard: new ShardIndex(index, this.#strategy.shardCount),
            }),
          ),
        ),
      ),
    );
  }

  /**
   * Lists endpoints registered for process-manager delivery.
   * @returns Returns immutable endpoint descriptions.
   */
  endpoints(): readonly DeliveryEndpoint[] {
    return Object.freeze([...this.#endpoints.values()].flat());
  }

  /**
   * Dispatches a durable inbox row through its process-manager target.
   * @param message Contains the persisted inbox row to replay.
   * @param deliveryTenantId Identifies the tenant that owns the row when present.
   * @returns A promise that resolves after the inbox row is replayed.
   */
  replay(message: InboxMessage, deliveryTenantId?: string): Promise<void> {
    return this.#replay(message, deliveryTenantId);
  }

  /**
   * Persists and drains one process-manager inbox message.
   * @param delivery Stores and drains the inbox row.
   * @param input Describes the message to persist.
   * @param deliveryTenantId Identifies the tenant that owns the message when present.
   * @returns Resolves to the persisted inbox row.
   */
  async receive(
    delivery: Delivery,
    input: ProcessManagerInput,
    deliveryTenantId?: string,
  ): Promise<InboxMessage> {
    const routed = this.#readiness.route(delivery);
    return await InboxHandoff.coordinate({
      handoffs: this.#inFlightHandoffs,
      key: InboxHandoff.key(input, deliveryTenantId),
      onHandoff: () => this.#receiveAndDrain(routed, input, deliveryTenantId),
    });
  }

  /**
   * Persists and drains a batch of process-manager inbox messages.
   * @param delivery Stores and drains the inbox rows.
   * @param inputs Describe the messages to persist.
   * @param deliveryTenantId Identifies the tenant that owns the messages when present.
   * @returns Resolves to the persisted inbox rows in input order.
   */
  async receiveAll(
    delivery: Delivery,
    inputs: ProcessManagerInputs,
    deliveryTenantId?: string,
  ): Promise<readonly InboxMessage[]> {
    const routed = this.#readiness.route(delivery);
    const key = this.#batchKey(inputs, deliveryTenantId);
    const inFlightHandoff = this.#inFlightBatchHandoffs.get(key);

    if (inFlightHandoff !== undefined) {
      return await inFlightHandoff;
    }

    const handoff = this.#receiveAndDrainAll(routed, inputs, deliveryTenantId);
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
        LocalProcessManagerInbox.#reject(row.owner, failures[0]);
        continue;
      }
      try {
        await written.handoff.complete(() =>
          this.#drainInboxRow(delivery, written.message, deliveryTenantId),
        );
        LocalProcessManagerInbox.#resolve(row.owner, written.message);
      } catch (error) {
        failures.push(error);
        LocalProcessManagerInbox.#reject(row.owner, error);
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
        ? InboxHandoff.configuredEndpoint(
            written.message,
            this.#endpoints.get(written.message.inboxId.targetTypeUrl) ?? [],
          )
        : undefined;

    return {
      message: written.message,
      handoff: this.#readiness.claim(
        endpoint === undefined ? undefined : InboxHandoff.ready(endpoint, deliveryTenantId),
      ),
    };
  }

  async #drainInboxRow(
    delivery: Delivery,
    message: InboxMessage,
    deliveryTenantId?: string,
  ): Promise<void> {
    await InboxHandoff.drain({
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
      const key = InboxHandoff.key(input, deliveryTenantId);
      const inFlight = this.#inFlightHandoffs.get(key);

      if (inFlight !== undefined) {
        return { key, input, promise: inFlight };
      }

      const owner = LocalProcessManagerInbox.#deferred();
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
    return JSON.stringify(inputs.map((input) => InboxHandoff.key(input, deliveryTenantId)));
  }

  async #replay(message: InboxMessage, deliveryTenantId?: string): Promise<void> {
    LocalProcessManagerInbox.#assert(message);

    const target = this.#targets.get(message.inboxId.targetTypeUrl);

    if (target === undefined) {
      throw new Error(
        `BoundedContext delivery has no process-manager target for "${message.inboxId.targetTypeUrl}".`,
      );
    }

    await target.replay(message, deliveryTenantId);
  }

  static #deferred(): InboxDeferred {
    let resolve!: (message: InboxMessage) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<InboxMessage>((nextResolve, nextReject) => {
      resolve = nextResolve;
      reject = nextReject;
    });
    void promise.catch(() => undefined);
    return { promise, resolve, reject, settled: false };
  }

  static #resolve(owner: InboxDeferred, message: InboxMessage): void {
    owner.settled = true;
    owner.resolve(message);
  }

  static #reject(owner: InboxDeferred, reason: unknown): void {
    owner.settled = true;
    owner.reject(reason);
  }

  static #assert(message: InboxMessage): asserts message is ProcessManagerMessage {
    if (message.label !== "HANDLE_COMMAND" && message.label !== "REACT_UPON_EVENT") {
      throw new Error(`BoundedContext delivery has no handler for inbox label "${message.label}".`);
    }
    if (message.status !== "TO_DELIVER") {
      throw new Error(
        `BoundedContext delivery cannot replay process-manager inbox message with status "${message.status}".`,
      );
    }
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
