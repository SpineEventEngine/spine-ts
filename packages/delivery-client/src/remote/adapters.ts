import { randomUUID } from "node:crypto";

import type {
  DeliveryInbox,
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
import type { WorkerId } from "@spine-event-engine/proto/delivery";

import { conditionalPickUp } from "@spine-event-engine/server/internal/conditional-pickup";
import { DeliveryClient } from "../client/client.js";
import {
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
   * Removes one exact authoritative pending row and returns its delivered fact.
   *
   * @param message Supplies the expected pending message snapshot.
   * @param options Bounds or cancels remote reads and removal.
   * @returns The delivered acknowledgement, or `undefined` when the pending
   * row is absent or no longer matches.
   */
  async markDelivered(
    message: InboxMessage,
    options?: DeliveryOperationOptions,
  ): Promise<InboxMessage | undefined> {
    const current = await this.client.findOne(message.id, options);
    if (current?.status !== "TO_DELIVER" || !RemoteValues.sameMessage(current, message))
      return undefined;
    await this.client.removeOne(current, options);
    return DeliveryMessageCodec.snapshot({ ...current, status: "DELIVERED" });
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
   * Acquires a shard for the supplied complete worker identity.
   *
   * @param shardIndex Identifies the shard to acquire.
   * @param worker Identifies the worker requesting work.
   * @param options Bounds or cancels the remote mutation.
   * @returns A local exclusive session, or `undefined` when unavailable.
   */
  async pickUp(
    shardIndex: ShardIndex,
    worker: WorkerId,
    options?: DeliveryOperationOptions,
  ): Promise<ExclusiveDeliveryWorkSession | undefined> {
    const operation = {
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
      ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    };
    const remote = await this.client.pickUp(shardIndex, RemoteValues.worker(worker), operation);
    if (remote === undefined) return undefined;
    const session = RemoteValues.freeze({
      kind: "EXCLUSIVE" as const,
      shard: DeliveryShardCodec.snapshot(shardIndex),
    });
    this.#sessions.set(session, remote);
    const key = RemoteValues.shardKey(shardIndex);
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
    this.#sessions.delete(session);
    this.#removeSession(key, session);
    await this.client.release(remote, options);
    return true;
  }

  /**
   * Applies a validated Admin observation to local remote-session state.
   *
   * A `PICKED` observation cannot prove ownership because the frozen wire
   * omits a session identity. Only `NOT_PICKED` invalidates stale sessions.
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
    conditionalPickUp.register(this, (shard, worker, options) =>
      this.#owner.pickUp(shard, worker, options),
    );
    Object.freeze(this);
  }

  /**
   * Acquires a remote shard for a complete worker identity.
   *
   * @param shardIndex Identifies the shard to acquire.
   * @param worker Identifies the worker requesting the shard.
   * @param options Bounds or cancels the remote operation.
   * @returns The acquired exclusive session, or `undefined` when unavailable.
   */
  pickUp(
    shardIndex: ShardIndex,
    worker: WorkerId,
    options?: DeliveryOperationOptions,
  ): Promise<ExclusiveDeliveryWorkSession | undefined> {
    return this.#owner.pickUp(shardIndex, worker, options);
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

  worker(worker: WorkerId): DeliveryWorkerId {
    const nodeId = worker.nodeId?.value;
    if (
      typeof nodeId !== "string" ||
      nodeId.trim().length === 0 ||
      typeof worker.value !== "string" ||
      worker.value.trim().length === 0
    )
      throw new TypeError("Delivery worker ID is invalid.");
    return RemoteValues.freeze({ nodeId, value: worker.value });
  },
});
