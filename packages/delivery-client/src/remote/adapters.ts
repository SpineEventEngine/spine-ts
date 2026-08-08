import { randomUUID } from "node:crypto";

import type {
  DeliveryInbox,
  DeliveryInboxWork,
  DeliveryOperationOptions,
  DeliveryWorkRegistry,
  DeliveryWorkSession,
  ExclusiveDeliveryWorkSession,
  InboxMessage,
  InboxMessageId,
  InboxMessageInput,
  InboxReadOptions,
  InboxWriteResult,
} from "@spine-event-engine/server";
import { ShardIndex } from "@spine-event-engine/server";

import { conditionalPickUp } from "@spine-event-engine/server/internal/conditional-pickup";
import { DeliveryClient, deliveryClientAccess } from "../client/client.js";
import {
  DeliveryOutcomeUnknownError,
  DeliveryPagingError,
  DeliveryProtocolError,
  type DeliveryWorkerId,
  type RemoteShardObservation,
  type RemoteShardSession,
} from "../client/types.js";
import { DeliveryMessageCodec, DeliveryRequestCodec, DeliveryShardCodec } from "../wire/codec.js";

/**
 * Adapts a delivery-server client to the server-owned inbox port.
 */
export class RemoteInbox implements DeliveryInbox {
  // prettier-ignore

  /**
   * Remote inbox work requires an exclusive remote shard session.
   */
  readonly sessionKind = "EXCLUSIVE" as const;

  /**
   * Creates a remote inbox.
   *
   * @param client Sends inbox calls to the delivery server.
   */
  constructor(private readonly client: DeliveryClient) {
    Object.freeze(this);
  }

  /**
   * Writes a new inbox message.
   *
   * @param input Supplies the message fields excluding its generated identity.
   * @param options Bounds or cancels the remote mutation.
   * @returns The written message result.
   */
  async receive(
    input: InboxMessageInput,
    options?: DeliveryOperationOptions,
  ): Promise<InboxWriteResult> {
    const message = RemoteValues.receiveMessage(input);
    await this.client.writeOne(message, options);
    return RemoteValues.freeze({ outcome: "WRITTEN" as const, message });
  }

  /**
   * Reads a bounded page of messages from one shard.
   *
   * @param shardIndex Identifies the shard to read.
   * @param options Supplies paging, status filtering, and call bounds.
   * @returns Detached messages in safely continued remote order.
   */
  async read(
    shardIndex: ShardIndex,
    options: InboxReadOptions & DeliveryOperationOptions = {},
  ): Promise<readonly InboxMessage[]> {
    if (options.offset !== undefined && options.offset !== 0) throw new DeliveryPagingError();
    const limit =
      options.limit === undefined
        ? this.client.pageSize
        : DeliveryRequestCodec.pageSize(options.limit);
    let after = options.after;
    let scanned = 0;
    const result: InboxMessage[] = [];
    while (result.length < limit) {
      const page = await this.client.readPage(shardIndex, {
        pageSize: limit,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        ...(after === undefined ? {} : { sinceWhen: RemoteValues.pageAnchor(after.whenReceived) }),
      });
      const start = after === undefined ? 0 : RemoteValues.exactAfter(page, after);
      const raw = page.slice(start);
      scanned += raw.length;
      if (scanned > 1_000 + limit) throw new DeliveryPagingError();
      const last = page.at(-1);
      const prior = page.at(-2);
      if (
        page.length === limit &&
        (last === undefined || prior?.whenReceived.getTime() === last.whenReceived.getTime())
      )
        throw new DeliveryPagingError();
      for (const message of raw) {
        if (options.statuses === undefined || options.statuses.includes(message.status)) {
          result.push(message);
          if (result.length === limit) return Object.freeze(result);
        }
      }
      if (page.length < limit) return Object.freeze(result);
      if (last === undefined) throw new DeliveryPagingError();
      after = { messageId: last.id.value, whenReceived: last.whenReceived, version: last.version };
    }
    return Object.freeze(result);
  }

  /**
   * Reads one message by its remote identity.
   *
   * @param id Identifies the message and shard.
   * @param options Bounds or cancels the remote read.
   * @returns The detached message, or `undefined` when it is absent.
   */
  readMessage(
    id: InboxMessageId,
    options?: DeliveryOperationOptions,
  ): Promise<InboxMessage | undefined> {
    return this.client.findOne(id, options);
  }

  /**
   * Creates exclusive work from the authoritative pending row.
   *
   * @param message Supplies the expected message snapshot.
   * @param session Supplies the exclusive shard session.
   * @param options Bounds or cancels remote reads and removals.
   * @returns Admitted work, or `undefined` when work cannot safely begin.
   */
  async begin(
    message: InboxMessage,
    session: DeliveryWorkSession,
    options?: DeliveryOperationOptions,
  ): Promise<DeliveryInboxWork | undefined> {
    if (session.kind !== "EXCLUSIVE" || !RemoteValues.sameShard(session.shard, message.shard))
      return undefined;
    const current = await this.client.findOne(message.id, options);
    if (current?.status !== "TO_DELIVER" || !RemoteValues.sameMessage(current, message))
      return undefined;
    return new RemoteInboxWork(this.client, current, options);
  }
}

class RemoteInboxWork implements DeliveryInboxWork {
  #active = true;
  constructor(
    private readonly client: DeliveryClient,
    private readonly snapshot: InboxMessage,
    private readonly operation: DeliveryOperationOptions | undefined,
  ) {}
  get message(): InboxMessage {
    if (!this.#active) throw new DeliveryProtocolError();
    return DeliveryMessageCodec.snapshot(this.snapshot);
  }
  async synchronize(
    session: DeliveryWorkSession,
    options?: DeliveryOperationOptions,
  ): Promise<void> {
    if (
      !this.#active ||
      session.kind !== "EXCLUSIVE" ||
      !RemoteValues.sameShard(session.shard, this.snapshot.shard)
    )
      throw new DeliveryProtocolError();
    const owner = RemoteSessionOwner.for(this.client);
    if (!(await owner.synchronize(session, options))) throw new DeliveryProtocolError();
  }
  async complete(options?: DeliveryOperationOptions): Promise<boolean> {
    if (!this.#active) return false;
    // A failed or uncertain removal leaves this work active. The later reader
    // reconciles authoritative remote state; no client-side removal state exists.
    await this.client.removeOne(this.snapshot, options ?? this.operation);
    this.#active = false;
    return true;
  }
  abandon(_options?: DeliveryOperationOptions): Promise<void> {
    void _options;
    return Promise.resolve();
  }
}

/**
 * Adapts remote exclusive shard sessions to the server work registry.
 */
class RemoteSessionOwner {
  // prettier-ignore

  /**
   * Frozen remote pickup produces non-renewable exclusive sessions.
   */
  readonly #sessions = new WeakMap<ExclusiveDeliveryWorkSession, RemoteShardSession>();
  readonly #sessionsByShard = new Map<string, Set<ExclusiveDeliveryWorkSession>>();
  readonly #releasesInFlight = new Set<string>();
  readonly #quarantined = new Set<string>();

  /**
   * Creates a registry backed by the supplied delivery client.
   *
   * @param client Sends shard operations to the delivery server.
   */
  private constructor(private readonly client: DeliveryClient) {}

  static for(client: DeliveryClient): RemoteSessionOwner {
    const current = remoteSessionOwners.get(client);
    if (current !== undefined) return current;
    const owner = new RemoteSessionOwner(client);
    remoteSessionOwners.set(client, owner);
    return owner;
  }

  /**
   * Acquires a shard for the supplied application node.
   *
   * @param shardIndex Identifies the shard to acquire.
   * @param node Identifies the application node requesting work.
   * @param options Bounds or cancels the remote mutation.
   * @returns A local exclusive session, or `undefined` when unavailable.
   */
  async pickUp(
    shardIndex: ShardIndex,
    node: string,
    options?: DeliveryOperationOptions,
  ): Promise<ExclusiveDeliveryWorkSession | undefined> {
    return this.#pickUp(shardIndex, node, options);
  }

  async #pickUp(
    shardIndex: ShardIndex,
    node: string,
    options: DeliveryOperationOptions | undefined,
  ): Promise<ExclusiveDeliveryWorkSession | undefined> {
    const key = RemoteValues.shardKey(shardIndex);
    if (this.#quarantined.has(key)) return undefined;
    let remote: RemoteShardSession | undefined;
    try {
      const operation = {
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
        ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      };
      remote = await this.client.pickUp(shardIndex, RemoteValues.workerFor(node), operation);
    } catch (error) {
      if (error instanceof DeliveryOutcomeUnknownError) this.#quarantined.add(key);
      throw error;
    }
    if (remote === undefined) return undefined;
    const session = RemoteValues.freeze({
      kind: "EXCLUSIVE" as const,
      shard: DeliveryShardCodec.snapshot(shardIndex),
    });
    this.#sessions.set(session, remote);
    const sessions = this.#sessionsByShard.get(key) ?? new Set<ExclusiveDeliveryWorkSession>();
    sessions.add(session);
    this.#sessionsByShard.set(key, sessions);
    return session;
  }

  /**
   * Removes a previously acquired exclusive session.
   *
   * @param session Supplies the local session to release.
   * @param options Bounds or cancels the remote mutation.
   * @returns Whether this registry released a known session.
   */
  async release(
    session: DeliveryWorkSession,
    options?: DeliveryOperationOptions,
  ): Promise<boolean> {
    if (session.kind !== "EXCLUSIVE") return false;
    const remote = this.#sessions.get(session);
    if (remote === undefined) return false;
    const key = RemoteValues.shardKey(session.shard);
    if (this.#quarantined.has(key)) return false;
    this.#sessions.delete(session);
    this.#removeSession(key, session);
    this.#releasesInFlight.add(key);
    this.#quarantined.add(key);
    try {
      await this.client.release(remote, options);
      this.#quarantined.delete(key);
      return true;
    } finally {
      this.#releasesInFlight.delete(key);
    }
  }

  async synchronize(
    session: ExclusiveDeliveryWorkSession,
    options: DeliveryOperationOptions | undefined,
  ): Promise<boolean> {
    const remote = this.#sessions.get(session);
    if (remote === undefined) return false;
    const key = RemoteValues.shardKey(session.shard);
    if (this.#quarantined.has(key)) return false;
    try {
      const probe = await deliveryClientAccess.probePickUp(
        this.client,
        session.shard,
        RemoteValues.workerFor(remote.worker.nodeId),
        options ?? {},
      );
      if (
        probe.kind === "ALREADY_PICKED" &&
        RemoteValues.sameWorker(probe.session.worker, remote.worker) &&
        probe.session.whenPicked.getTime() === remote.whenPicked.getTime()
      ) {
        return true;
      }
      if (probe.kind === "PICKED") await this.#cleanupAccidentalPickup(probe.session);
      this.#sessions.delete(session);
      this.#removeSession(key, session);
      return false;
    } catch (error) {
      if (error instanceof DeliveryOutcomeUnknownError) this.#quarantined.add(key);
      throw error;
    }
  }

  async #cleanupAccidentalPickup(session: RemoteShardSession): Promise<void> {
    try {
      await this.client.release(session, { timeoutMs: 1_000 });
    } catch {
      // The old owner is fenced even if bounded cleanup cannot establish its outcome.
    }
  }

  /**
   * Applies a validated Admin observation to local remote-session state.
   *
   * A `PICKED` observation cannot prove ownership because the frozen wire
   * omits a session identity. Only `NOT_PICKED` invalidates stale sessions and
   * clears unknown-mutation quarantine for a fresh pickup.
   *
   * @param observation Supplies the detached remote shard observation.
   */
  reconcile(observation: RemoteShardObservation): void {
    if (
      !(observation.shard instanceof ShardIndex) ||
      !Number.isSafeInteger(observation.messages) ||
      observation.messages < 0 ||
      (observation.lastPicked !== undefined &&
        (!(observation.lastPicked instanceof Date) ||
          Number.isNaN(observation.lastPicked.getTime())))
    )
      throw new DeliveryProtocolError();
    if (observation.status !== "NOT_PICKED") return;
    const key = RemoteValues.shardKey(observation.shard);
    const sessions = this.#sessionsByShard.get(key);
    if (sessions !== undefined) {
      for (const session of sessions) {
        this.#sessions.delete(session);
      }
      this.#sessionsByShard.delete(key);
    }
    if (!this.#releasesInFlight.has(key)) this.#quarantined.delete(key);
  }

  #removeSession(key: string, session: ExclusiveDeliveryWorkSession): void {
    const sessions = this.#sessionsByShard.get(key);
    if (sessions === undefined) return;
    sessions.delete(session);
    if (sessions.size === 0) this.#sessionsByShard.delete(key);
  }
}

/**
 * Adapts the one per-client remote session owner to the server work-registry port.
 */
export class RemoteWorkRegistry implements DeliveryWorkRegistry {
  // prettier-ignore

  /**
   * Identifies the exclusive session model used by the remote registry.
   */
  readonly sessionKind = "EXCLUSIVE" as const;
  readonly #owner: RemoteSessionOwner;

  /**
   * Creates a registry backed by the supplied delivery client.
   *
   * @param client Sends shard operations to the delivery server.
   */
  constructor(client: DeliveryClient) {
    this.#owner = RemoteSessionOwner.for(client);
    conditionalPickUp.register(this, (shard, node, options) =>
      this.#owner.pickUp(shard, node, options),
    );
    Object.freeze(this);
  }

  /**
   * Acquires a remote shard for an application node.
   *
   * @param shardIndex Identifies the shard to acquire.
   * @param node Identifies the application node requesting the shard.
   * @param options Bounds or cancels the remote operation.
   * @returns The acquired exclusive session, or `undefined` when unavailable.
   */
  pickUp(
    shardIndex: ShardIndex,
    node: string,
    options?: DeliveryOperationOptions,
  ): Promise<ExclusiveDeliveryWorkSession | undefined> {
    return this.#owner.pickUp(shardIndex, node, options);
  }

  /**
   * Removes a remote shard session owned by this registry.
   *
   * @param session Identifies the session to release.
   * @param options Bounds or cancels the remote operation.
   * @returns Whether the registry recognized and released the session.
   */
  release(session: DeliveryWorkSession, options?: DeliveryOperationOptions): Promise<boolean> {
    return this.#owner.release(session, options);
  }

  /**
   * Applies an Admin shard observation to local ownership.
   *
   * @param observation Describes the current remote shard state.
   */
  reconcile(observation: RemoteShardObservation): void {
    this.#owner.reconcile(observation);
  }
}

/**
 * Groups immutable remote-adapter value operations.
 */
const remoteSessionOwners = new WeakMap<DeliveryClient, RemoteSessionOwner>();

const RemoteValues = Object.freeze({
  receiveMessage(input: InboxMessageInput): InboxMessage {
    const message = DeliveryMessageCodec.snapshot({
      ...input,
      id: RemoteValues.freeze({
        value: randomUUID(),
        shard: DeliveryShardCodec.snapshot(input.shard),
      }),
      shard: DeliveryShardCodec.snapshot(input.shard),
    });
    DeliveryMessageCodec.encode(message);
    return message;
  },

  freeze<T extends object>(value: T): T {
    return Object.freeze(value);
  },

  shardKey(value: ShardIndex): string {
    return `${String(value.index)}/${String(value.ofTotal)}`;
  },

  pageAnchor(value: Date): Date {
    const milliseconds = value.getTime();
    if (milliseconds <= -62_135_596_800_000) throw new DeliveryPagingError();
    return new Date(milliseconds - 1);
  },

  sameShard(left: ShardIndex, right: ShardIndex): boolean {
    return left.index === right.index && left.ofTotal === right.ofTotal;
  },

  sameWorker(left: DeliveryWorkerId, right: DeliveryWorkerId): boolean {
    return left.nodeId === right.nodeId && left.value === right.value;
  },

  exactAfter(page: readonly InboxMessage[], after: NonNullable<InboxReadOptions["after"]>): number {
    const exact = page.findIndex(
      (message) =>
        message.id.value === after.messageId &&
        message.whenReceived.getTime() === after.whenReceived.getTime() &&
        message.version === after.version,
    );
    if (exact < 0) throw new DeliveryPagingError();
    return exact + 1;
  },

  sameMessage(left: InboxMessage, right: InboxMessage): boolean {
    return (
      left.id.value === right.id.value &&
      RemoteValues.sameShard(left.id.shard, right.id.shard) &&
      RemoteValues.sameShard(left.shard, right.shard) &&
      left.inboxId.targetId === right.inboxId.targetId &&
      left.inboxId.targetTypeUrl === right.inboxId.targetTypeUrl &&
      left.signalId === right.signalId &&
      RemoteValues.sameAny(left.signal, right.signal) &&
      left.label === right.label &&
      left.status === right.status &&
      left.version === right.version &&
      left.whenReceived.getTime() === right.whenReceived.getTime() &&
      RemoteValues.sameDate(left.keepUntil, right.keepUntil)
    );
  },

  sameDate(left: Date | undefined, right: Date | undefined): boolean {
    return left === undefined ? right === undefined : left.getTime() === right?.getTime();
  },

  sameAny(left: InboxMessage["signal"], right: InboxMessage["signal"]): boolean {
    return left === undefined || right === undefined
      ? left === right
      : left.typeUrl === right.typeUrl &&
          left.value.length === right.value.length &&
          left.value.every((value, index) => value === right.value[index]);
  },

  workerFor(node: string): DeliveryWorkerId {
    if (typeof node !== "string" || node.trim().length === 0)
      throw new TypeError("Delivery worker node is invalid.");
    return RemoteValues.freeze({ nodeId: node, value: randomUUID() });
  },
});
