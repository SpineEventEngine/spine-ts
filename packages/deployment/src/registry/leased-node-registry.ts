import { create } from "@bufbuild/protobuf";
import {
  RecordSpec,
  type RecordContinuation,
  type RecordEntry,
  type RecordStorage,
  type StorageFactory,
} from "@spine-event-engine/storage";
import {
  ApplicationNodeLeaseSchema,
  type ApplicationNodeLease,
} from "@spine-event-engine/proto/generated/spine/system/deployment/application_node_lease_pb.js";

import { ApplicationNode } from "../discovery/application-node.js";

const storageKey = "spine.deployment.ApplicationNodeLease:v1";
const defaultCleanupBatchSize = 32;
const readPageSize = 256;

/**
 * Stores and reads live application-node leases in one caller-owned storage namespace.
 */
export class LeasedNodeRegistry {
  readonly #storage: RecordStorage<string, ApplicationNodeLease>;
  readonly #cleanupBatchSize: number;
  #closed = false;
  #closing: Promise<void> | undefined;
  readonly #operations = new Set<Promise<unknown>>();
  #cleanupAfter: RecordContinuation<string> | undefined;

  /**
   * Creates a leased node registry over an explicit atomic record storage handle.
   *
   * @param options Supplies the operator-selected storage factory and namespace.
   */
  constructor(options: LeasedNodeRegistryOptions) {
    if (options.namespace.trim().length === 0)
      throw new Error("Lease storage namespace must be non-empty.");
    const cleanupBatchSize = options.cleanupBatchSize ?? defaultCleanupBatchSize;
    if (!Number.isSafeInteger(cleanupBatchSize) || cleanupBatchSize < 1)
      throw new RangeError("Lease cleanup batch size must be a positive safe integer.");
    this.#storage = options.factory.createRecordStorage(
      { name: options.namespace, multitenant: false },
      leaseRecordSpec,
    );
    if (!this.#storage.atomicCompareAndSet) {
      this.#storage.close();
      throw new Error("Leased node registry requires atomic compare-and-set storage.");
    }
    this.#cleanupBatchSize = cleanupBatchSize;
  }

  /**
   * Registers one previously absent node lease.
   *
   * @param lease Supplies the node, owning registration identity, and expiry time.
   * @returns Whether the registration was written.
   */
  register(lease: NodeLease): Promise<boolean> {
    return this.start(async () => {
      const record = LeaseRecords.write(lease);
      return this.#storage.compareAndSet(record.nodeId, undefined, record);
    });
  }

  /**
   * Updates a lease only when its registration identity still owns the node ID.
   *
   * @param nodeId Supplies the stable node identity.
   * @param registrationId Supplies the opaque owning process identity.
   * @param expiresAt Supplies the renewed expiry in epoch milliseconds.
   * @returns Whether the owner still held and renewed the lease.
   */
  renew(nodeId: string, registrationId: string, expiresAt: number): Promise<boolean> {
    return this.start(async () => {
      const current = await this.#storage.read(nodeId);
      if (current === undefined) return false;
      const lease = LeaseRecords.read(current, nodeId);
      if (lease.registrationId !== registrationId) return false;
      return this.#storage.compareAndSet(
        nodeId,
        current,
        LeaseRecords.write({ ...lease, expiresAt }),
      );
    });
  }

  /**
   * Deletes a lease only when its registration identity still owns the node ID.
   *
   * @param nodeId Supplies the stable node identity.
   * @param registrationId Supplies the opaque owning process identity.
   * @returns Whether the caller's lease was deleted.
   */
  remove(nodeId: string, registrationId: string): Promise<boolean> {
    return this.start(async () => {
      const current = await this.#storage.read(nodeId);
      if (
        current === undefined ||
        LeaseRecords.read(current, nodeId).registrationId !== registrationId
      )
        return false;
      return this.#storage.compareAndSet(nodeId, current, undefined);
    });
  }

  /**
   * Reads one complete validated snapshot of live nodes at a supplied clock time.
   *
   * @param now Supplies epoch milliseconds used for exact expiry filtering.
   * @returns Every non-expired node after every stored row validates.
   */
  read(now: number): Promise<readonly ApplicationNode[]> {
    return this.start(async () => {
      LeaseRecords.requireTime(now);
      const leases = (await this.readAll()).map(({ id, record }) => LeaseRecords.read(record, id));
      return leases.filter((lease) => lease.expiresAt > now).map((lease) => lease.node);
    });
  }

  /**
   * Reads one validated live lease at its exact storage slot.
   *
   * @param nodeId Supplies the stable node identity.
   * @param now Supplies epoch milliseconds for expiry evaluation.
   * @returns The live lease, or undefined when absent or expired.
   */
  lookup(nodeId: string, now: number): Promise<NodeLease | undefined> {
    return this.start(async () => {
      LeaseRecords.requireTime(now);
      const record = await this.#storage.read(nodeId);
      if (record === undefined) return undefined;
      const lease = LeaseRecords.read(record, nodeId);
      return lease.expiresAt > now ? lease : undefined;
    });
  }

  /**
   * Deletes one finite batch of expired leases conditionally.
   *
   * @param now Supplies epoch milliseconds used for exact expiry filtering.
   * @returns The number of rows this pass removed.
   */
  cleanup(now: number): Promise<number> {
    return this.start(async () => {
      LeaseRecords.requireTime(now);
      const records = await this.#storage.queryEntries({
        sort: [{ field: "id" }],
        ...(this.#cleanupAfter === undefined ? {} : { after: this.#cleanupAfter }),
        limit: this.#cleanupBatchSize,
      });
      this.#cleanupAfter =
        records.length === 0 ? undefined : LeasePages.continuation(records.at(-1));
      if (records.length < this.#cleanupBatchSize) this.#cleanupAfter = undefined;
      const removals = await Promise.all(
        records.map(async ({ id, record }) => {
          const lease = LeaseRecords.read(record, id);
          return (
            lease.expiresAt <= now && (await this.#storage.compareAndSet(id, record, undefined))
          );
        }),
      );
      return removals.filter(Boolean).length;
    });
  }

  /**
   * Joins started operations after fencing this handle once.
   *
   * @returns Completes after every active registry operation settles.
   */
  close(): Promise<void> {
    if (this.#closing !== undefined) return this.#closing;
    this.#closed = true;
    this.#closing = Promise.allSettled([...this.#operations]).then(() => {
      this.#storage.close();
    });
    return this.#closing;
  }

  private requireOpen(): void {
    if (this.#closed) throw new Error("Leased node registry is closed.");
  }

  private start<Result>(operation: () => Promise<Result>): Promise<Result> {
    try {
      this.requireOpen();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    const pending = operation();
    this.#operations.add(pending);
    void pending.then(
      () => this.#operations.delete(pending),
      () => this.#operations.delete(pending),
    );
    return pending;
  }

  private async readAll(): Promise<readonly RecordEntry<string, ApplicationNodeLease>[]> {
    const records: RecordEntry<string, ApplicationNodeLease>[] = [];
    let after: RecordContinuation<string> | undefined;
    for (;;) {
      const page = await this.#storage.queryEntries({
        sort: [{ field: "id" }],
        ...(after === undefined ? {} : { after }),
        limit: readPageSize,
      });
      records.push(...page);
      if (page.length < readPageSize) return records;
      const last = page.at(-1);
      if (last === undefined) throw new Error("Lease page has no continuation row.");
      after = { values: [{ field: "id", value: last.id }], id: last.id };
    }
  }
}

/**
 * Supplies storage ownership and finite cleanup settings for one registry.
 */
export interface LeasedNodeRegistryOptions {
  // The caller controls storage ownership and namespace selection.

  /**
   * Selects the caller-owned storage factory.
   */
  readonly factory: StorageFactory;

  /**
   * Selects the caller-owned logical storage namespace.
   */
  readonly namespace: string;

  /**
   * Limits expired rows considered by one cleanup pass.
   */
  readonly cleanupBatchSize?: number;
}

/**
 * Supplies the durable data owned by one registration attempt.
 */
export interface NodeLease {
  // One durable registration attempt carries these lease values.

  /**
   * Identifies the stable reachable application node.
   */
  readonly node: ApplicationNode;

  /**
   * Identifies the opaque owning application process.
   */
  readonly registrationId: string;

  /**
   * Specifies the epoch-millisecond expiry of this lease.
   */
  readonly expiresAt: number;
}

/**
 * Declares the internal persisted lease record layout.
 *
 * @internal
 */
export const leaseRecordSpec: RecordSpec<string, ApplicationNodeLease> = new RecordSpec<
  string,
  ApplicationNodeLease
>({
  schema: ApplicationNodeLeaseSchema,
  storageKey,
  idKind: "string",
  extractId: (record) => LeaseRecords.id(record),
});

const LeaseRecords = Object.freeze({
  id(record: ApplicationNodeLease): string {
    if (!record.nodeId.trim()) throw new Error("Application node lease record has no node ID.");
    return record.nodeId;
  },

  read(record: ApplicationNodeLease, expectedId?: string): NodeLease {
    const version = record.encodingVersion;
    const id = record.nodeId;
    const endpoint = record.endpoint?.origin;
    const expiresAt = Number(record.expiresAtMillis);
    const registrationId = record.registrationId;
    if (version !== 1) throw new Error("Application node lease record has unsupported version.");
    if (expectedId !== undefined && id !== expectedId)
      throw new Error("Application node lease record is invalid.");
    try {
      if (endpoint === undefined || !Number.isSafeInteger(expiresAt)) throw Error();
      const node = new ApplicationNode({
        id,
        endpoint,
        ...(record.endpoint?.tlsServerName === undefined
          ? {}
          : { tlsServerName: record.endpoint.tlsServerName }),
      });
      this.requireTime(expiresAt);
      if (!registrationId.trim()) throw Error();
      return Object.freeze({ node, registrationId, expiresAt });
    } catch {
      throw new Error("Application node lease record is invalid.");
    }
  },

  write(lease: NodeLease): ApplicationNodeLease {
    this.requireTime(lease.expiresAt);
    if (!lease.registrationId.trim())
      throw new Error("Lease registration identity must be non-empty.");
    const node = new ApplicationNode({
      id: lease.node.id,
      endpoint: lease.node.endpoint,
      ...(lease.node.tlsServerName === undefined
        ? {}
        : { tlsServerName: lease.node.tlsServerName }),
    });
    return create(ApplicationNodeLeaseSchema, {
      encodingVersion: 1,
      nodeId: node.id,
      endpoint: { origin: node.endpoint, tlsServerName: node.tlsServerName },
      expiresAtMillis: BigInt(lease.expiresAt),
      registrationId: lease.registrationId,
    });
  },

  requireTime(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new RangeError("Lease expiry must be a non-negative safe integer.");
  },
});

const LeasePages = Object.freeze({
  continuation(
    entry: RecordEntry<string, ApplicationNodeLease> | undefined,
  ): RecordContinuation<string> {
    if (entry === undefined) throw new Error("Lease page has no continuation row.");
    return { values: [{ field: "id", value: entry.id }], id: entry.id };
  },
});
