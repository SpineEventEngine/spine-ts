import { createHash, randomUUID } from "node:crypto";

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

import { DeliveryClient } from "../client/client.js";
import {
  DeliveryOutcomeUnknownError,
  DeliveryPagingError,
  DeliveryProtocolError,
  DeliveryQuarantineError,
  type RemovalQuarantine,
  type RemovalQuarantineRecord,
  type DeliveryWorkerId,
  type RemoteShardObservation,
  type RemoteShardSession,
} from "../client/types.js";
import {
  encodeInboxMessage,
  pageSize,
  snapshotInboxMessage,
  snapshotShard,
} from "../wire/codec.js";

/** Server-owned inbox port backed by a delivery-server client. */
export class RemoteInbox implements DeliveryInbox {
  /** Remote inbox work requires an exclusive remote shard session. */
  readonly sessionKind = "EXCLUSIVE" as const;
  private readonly quarantine: RemovalQuarantine;
  constructor(
    private readonly client: DeliveryClient,
    quarantine: RemovalQuarantine | undefined,
  ) {
    if (quarantine === undefined) throw new DeliveryQuarantineError();
    this.quarantine = quarantine;
    Object.freeze(this);
  }

  async receive(
    input: InboxMessageInput,
    options?: DeliveryOperationOptions,
  ): Promise<InboxWriteResult> {
    const message = receiveMessage(input);
    await this.client.writeOne(message, options);
    return freeze({ outcome: "WRITTEN" as const, message });
  }

  async read(
    shardIndex: ShardIndex,
    options: InboxReadOptions & DeliveryOperationOptions = {},
  ): Promise<readonly InboxMessage[]> {
    if (options.offset !== undefined && options.offset !== 0) throw new DeliveryPagingError();
    const limit = options.limit === undefined ? this.client.pageSize : pageSize(options.limit);
    let after = options.after;
    let scanned = 0;
    const result: InboxMessage[] = [];
    while (result.length < limit) {
      const page = await this.client.readPage(shardIndex, {
        pageSize: limit,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        ...(after === undefined ? {} : { sinceWhen: pageAnchor(after.whenReceived) }),
      });
      const start = after === undefined ? 0 : exactAfter(page, after);
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

  readMessage(
    id: InboxMessageId,
    options?: DeliveryOperationOptions,
  ): Promise<InboxMessage | undefined> {
    return this.client.findOne(id, options);
  }

  async begin(
    message: InboxMessage,
    session: DeliveryWorkSession,
    options?: DeliveryOperationOptions,
  ): Promise<DeliveryInboxWork | undefined> {
    if (session.kind !== "EXCLUSIVE" || !sameShard(session.shard, message.shard)) return undefined;
    const key = inboxKey(message);
    const quarantined = await quarantineGet(this.quarantine, key);
    if (quarantined !== undefined) {
      const current = await this.client.findOne(message.id, options);
      if (current === undefined) {
        await quarantineDelete(this.quarantine, key);
        return undefined;
      }
      if (quarantined.fingerprint !== fingerprint(current)) return undefined;
      if (quarantined.phase === "ADMITTED") return undefined;
      await this.client.removeOne(current, options);
      await quarantineDelete(this.quarantine, key);
      return undefined;
    }
    const current = await this.client.findOne(message.id, options);
    if (current?.status !== "TO_DELIVER" || !sameMessage(current, message)) return undefined;
    await quarantinePut(this.quarantine, {
      id: key,
      phase: "ADMITTED",
      fingerprint: fingerprint(current),
    });
    return new RemoteInboxWork(this.client, current, this.quarantine, options);
  }
}

class RemoteInboxWork implements DeliveryInboxWork {
  #active = true;
  constructor(
    private readonly client: DeliveryClient,
    private readonly snapshot: InboxMessage,
    private readonly quarantine: RemovalQuarantine,
    private readonly operation: DeliveryOperationOptions | undefined,
  ) {}
  get message(): InboxMessage {
    if (!this.#active) throw new DeliveryProtocolError();
    return snapshotInboxMessage(this.snapshot);
  }
  synchronize(session: DeliveryWorkSession, _options?: DeliveryOperationOptions): Promise<void> {
    void _options;
    if (
      !this.#active ||
      session.kind !== "EXCLUSIVE" ||
      !sameShard(session.shard, this.snapshot.shard)
    )
      return Promise.reject(new DeliveryProtocolError());
    return Promise.resolve();
  }
  async complete(options?: DeliveryOperationOptions): Promise<boolean> {
    if (!this.#active) return false;
    await quarantinePut(this.quarantine, {
      id: inboxKey(this.snapshot),
      phase: "REMOVING",
      fingerprint: fingerprint(this.snapshot),
    });
    await this.client.removeOne(this.snapshot, options ?? this.operation);
    await quarantineDelete(this.quarantine, inboxKey(this.snapshot));
    this.#active = false;
    return true;
  }
  abandon(_options?: DeliveryOperationOptions): Promise<void> {
    void _options;
    return Promise.resolve();
  }
}

/** Server-owned remote exclusive-work registry backed by `DeliveryClient`. */
export class RemoteWorkRegistry implements DeliveryWorkRegistry {
  /** Frozen remote pickup produces non-renewable exclusive sessions. */
  readonly sessionKind = "EXCLUSIVE" as const;
  readonly #sessions = new WeakMap<ExclusiveDeliveryWorkSession, RemoteShardSession>();
  readonly #sessionsByShard = new Map<string, Set<ExclusiveDeliveryWorkSession>>();
  readonly #releasesInFlight = new Set<string>();
  readonly #quarantined = new Set<string>();
  constructor(private readonly client: DeliveryClient) {
    Object.freeze(this);
  }
  async pickUp(
    shardIndex: ShardIndex,
    node: string,
    options?: DeliveryOperationOptions,
  ): Promise<ExclusiveDeliveryWorkSession | undefined> {
    const key = shardKey(shardIndex);
    if (this.#quarantined.has(key)) return undefined;
    let remote: RemoteShardSession | undefined;
    try {
      remote = await this.client.pickUp(shardIndex, workerFor(node), options);
    } catch (error) {
      if (error instanceof DeliveryOutcomeUnknownError) this.#quarantined.add(key);
      throw error;
    }
    if (remote === undefined) return undefined;
    const session = freeze({ kind: "EXCLUSIVE" as const, shard: snapshotShard(shardIndex) });
    this.#sessions.set(session, remote);
    const sessions = this.#sessionsByShard.get(key) ?? new Set<ExclusiveDeliveryWorkSession>();
    sessions.add(session);
    this.#sessionsByShard.set(key, sessions);
    return session;
  }
  async release(
    session: DeliveryWorkSession,
    options?: DeliveryOperationOptions,
  ): Promise<boolean> {
    if (session.kind !== "EXCLUSIVE") return false;
    const remote = this.#sessions.get(session);
    if (remote === undefined) return false;
    const key = shardKey(session.shard);
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
  /**
   * Apply a validated Admin observation to local remote-session state.
   *
   * A `PICKED` observation cannot prove ownership because the frozen wire
   * omits a session identity. Only `NOT_PICKED` invalidates stale sessions and
   * clears unknown-mutation quarantine for a fresh pickup.
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
    const key = shardKey(observation.shard);
    const sessions = this.#sessionsByShard.get(key);
    if (sessions !== undefined) {
      for (const session of sessions) this.#sessions.delete(session);
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

function receiveMessage(input: InboxMessageInput): InboxMessage {
  const message = snapshotInboxMessage({
    ...input,
    id: freeze({ value: randomUUID(), shard: snapshotShard(input.shard) }),
    shard: snapshotShard(input.shard),
  });
  encodeInboxMessage(message);
  return message;
}
function freeze<T extends object>(value: T): T {
  return Object.freeze(value);
}
function shardKey(value: ShardIndex): string {
  return `${String(value.index)}/${String(value.ofTotal)}`;
}
function inboxKey(message: InboxMessage): string {
  return `${shardKey(message.id.shard)}:${message.id.value}`;
}
function pageAnchor(value: Date): Date {
  const milliseconds = value.getTime();
  if (milliseconds <= -62_135_596_800_000) throw new DeliveryPagingError();
  return new Date(milliseconds - 1);
}
function sameShard(left: ShardIndex, right: ShardIndex): boolean {
  return left.index === right.index && left.ofTotal === right.ofTotal;
}
function exactAfter(
  page: readonly InboxMessage[],
  after: NonNullable<InboxReadOptions["after"]>,
): number {
  const exact = page.findIndex(
    (message) =>
      message.id.value === after.messageId &&
      message.whenReceived.getTime() === after.whenReceived.getTime() &&
      message.version === after.version,
  );
  if (exact < 0) throw new DeliveryPagingError();
  return exact + 1;
}
function sameMessage(left: InboxMessage, right: InboxMessage): boolean {
  return (
    left.id.value === right.id.value &&
    sameShard(left.id.shard, right.id.shard) &&
    sameShard(left.shard, right.shard) &&
    left.inboxId.targetId === right.inboxId.targetId &&
    left.inboxId.targetTypeUrl === right.inboxId.targetTypeUrl &&
    left.signalId === right.signalId &&
    sameAny(left.signal, right.signal) &&
    left.label === right.label &&
    left.status === right.status &&
    left.version === right.version &&
    left.whenReceived.getTime() === right.whenReceived.getTime() &&
    sameDate(left.keepUntil, right.keepUntil)
  );
}
function sameDate(left: Date | undefined, right: Date | undefined): boolean {
  return left === undefined ? right === undefined : left.getTime() === right?.getTime();
}
function sameAny(left: InboxMessage["signal"], right: InboxMessage["signal"]): boolean {
  return left === undefined || right === undefined
    ? left === right
    : left.typeUrl === right.typeUrl &&
        left.value.length === right.value.length &&
        left.value.every((value, index) => value === right.value[index]);
}
function fingerprint(message: InboxMessage): string {
  return createHash("sha256")
    .update(message.id.value)
    .update(String(message.version))
    .update(String(message.whenReceived.getTime()))
    .update(message.signal?.typeUrl ?? "")
    .update(message.signal?.value ?? new Uint8Array())
    .digest("hex");
}
async function quarantineGet(
  quarantine: RemovalQuarantine,
  id: string,
): Promise<RemovalQuarantineRecord | undefined> {
  try {
    return await quarantine.get(id);
  } catch {
    throw new DeliveryQuarantineError();
  }
}
async function quarantinePut(
  quarantine: RemovalQuarantine,
  record: RemovalQuarantineRecord,
): Promise<void> {
  try {
    await quarantine.put(Object.freeze({ ...record }));
  } catch {
    throw new DeliveryQuarantineError();
  }
}
async function quarantineDelete(quarantine: RemovalQuarantine, id: string): Promise<void> {
  try {
    await quarantine.delete(id);
  } catch {
    throw new DeliveryQuarantineError();
  }
}
function workerFor(node: string): DeliveryWorkerId {
  if (typeof node !== "string" || node.trim().length === 0)
    throw new TypeError("Delivery worker node is invalid.");
  return freeze({ nodeId: node, value: `spine-ts:${node}` });
}
