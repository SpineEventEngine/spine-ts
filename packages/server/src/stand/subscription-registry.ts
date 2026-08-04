import { clone } from "@bufbuild/protobuf";
import { SubscriptionSchema, type Subscription } from "@spine-event-engine/proto/client";

const defaultLimit = 100;
const pendingMilliseconds = 30_000;

/**
 * A durable Stand subscription definition.
 */
export interface StandSubscriptionEntry {
  readonly id: string;
  readonly subscription: Subscription;
  readonly phase: "PENDING" | "ACTIVE";
  readonly createdAtMs: number;
  readonly pendingUntilMs?: number;
  readonly revision: number;
}

/**
 * Result returned after a create attempt.
 */
export interface StandSubscriptionCreateResult {
  readonly entry: StandSubscriptionEntry;
  readonly created: boolean;
}

/**
 * Result returned after an activate attempt.
 */
export interface StandSubscriptionActivateResult {
  readonly entry?: StandSubscriptionEntry;
  readonly activated: boolean;
}

/**
 * Result returned after a delete attempt.
 */
export interface StandSubscriptionDeleteResult {
  readonly deleted: boolean;
}

/**
 * Reports capacity exhaustion while admitting a definition.
 */
export class StandCapacityError extends Error {
  /**
   * Creates the capacity failure.
   * @param limit The configured admission limit.
   */
  constructor(readonly limit: number) {
    super(`Stand subscription capacity of ${limit} is exhausted.`);
    this.name = "StandCapacityError";
  }
}

/**
 * Reports an ID reused with distinct subscription content.
 */
export class StandConflictError extends Error {
  /**
   * Creates the conflict failure.
   * @param id The conflicting subscription ID.
   */
  constructor(readonly id: string) {
    super(`Stand subscription "${id}" already exists with different content.`);
    this.name = "StandConflictError";
  }
}

/**
 * Stores Stand subscription definitions independently from listener delivery.
 */
export interface StandSubscriptionRegistry {
  readonly persistent: boolean;
  create(subscription: Subscription): Promise<StandSubscriptionCreateResult>;
  activate(id: string): Promise<StandSubscriptionActivateResult>;
  delete(id: string): Promise<StandSubscriptionDeleteResult>;
  get(id: string): Promise<StandSubscriptionEntry | undefined>;
  snapshot(): Promise<readonly StandSubscriptionEntry[]>;
  cleanupExpiredPending(nowMs?: number): Promise<number>;
  close(): Promise<void>;
}

/**
 * Keeps bounded subscription definitions in process memory.
 */
export class InMemorySubscriptionRegistry implements StandSubscriptionRegistry {
  readonly persistent = false;
  readonly #entries = new Map<string, StandSubscriptionEntry>();
  readonly #limit: number;
  #closed = false;

  /**
   * Creates an in-memory registry.
   * @param limit Maximum number of definitions, from one through 100.
   */
  constructor(limit = defaultLimit) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > defaultLimit) {
      throw new RangeError("Stand subscription limit must be a positive safe integer no greater than 100.");
    }
    this.#limit = limit;
  }

  async create(subscription: Subscription): Promise<StandSubscriptionCreateResult> {
    this.#requireOpen();
    const id = InMemorySubscriptionRegistry.#id(subscription);
    const existing = this.#entries.get(id);
    if (existing !== undefined) {
      if (JSON.stringify(existing.subscription) !== JSON.stringify(subscription)) throw new StandConflictError(id);
      return Object.freeze({ entry: InMemorySubscriptionRegistry.#clone(existing), created: false });
    }
    if (this.#entries.size >= this.#limit) throw new StandCapacityError(this.#limit);
    const nowMs = Date.now();
    const entry: StandSubscriptionEntry = Object.freeze({
      id,
      subscription: clone(SubscriptionSchema, subscription),
      phase: "PENDING",
      createdAtMs: nowMs,
      pendingUntilMs: nowMs + pendingMilliseconds,
      revision: 1,
    });
    this.#entries.set(id, entry);
    return Object.freeze({ entry: InMemorySubscriptionRegistry.#clone(entry), created: true });
  }

  async activate(id: string): Promise<StandSubscriptionActivateResult> {
    this.#requireOpen();
    const entry = this.#entries.get(id);
    if (entry === undefined) return Object.freeze({ activated: false });
    if (entry.phase === "ACTIVE") return Object.freeze({ entry: InMemorySubscriptionRegistry.#clone(entry), activated: false });
    const active = Object.freeze({ ...entry, phase: "ACTIVE" as const, pendingUntilMs: undefined, revision: entry.revision + 1 });
    this.#entries.set(id, active);
    return Object.freeze({ entry: InMemorySubscriptionRegistry.#clone(active), activated: true });
  }

  async delete(id: string): Promise<StandSubscriptionDeleteResult> {
    this.#requireOpen();
    return Object.freeze({ deleted: this.#entries.delete(id) });
  }

  async get(id: string): Promise<StandSubscriptionEntry | undefined> {
    this.#requireOpen();
    const entry = this.#entries.get(id);
    return entry === undefined ? undefined : InMemorySubscriptionRegistry.#clone(entry);
  }

  async snapshot(): Promise<readonly StandSubscriptionEntry[]> {
    this.#requireOpen();
    return Object.freeze([...this.#entries.values()].sort((left, right) => left.id.localeCompare(right.id)).map(InMemorySubscriptionRegistry.#clone));
  }

  async cleanupExpiredPending(nowMs = Date.now()): Promise<number> {
    this.#requireOpen();
    let deleted = 0;
    for (const [id, entry] of this.#entries) {
      if (entry.phase === "PENDING" && entry.pendingUntilMs !== undefined && entry.pendingUntilMs <= nowMs) {
        this.#entries.delete(id);
        deleted += 1;
      }
    }
    return deleted;
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#entries.clear();
  }

  static #id(subscription: Subscription): string {
    const id = subscription.id?.value;
    if (typeof id !== "string" || id.trim() === "") throw new TypeError("Stand subscription ID must be non-blank.");
    return id;
  }

  static #clone(entry: StandSubscriptionEntry): StandSubscriptionEntry {
    return Object.freeze({ ...entry, subscription: clone(SubscriptionSchema, entry.subscription) });
  }

  #requireOpen(): void {
    if (this.#closed) throw new Error("Stand subscription registry is closed.");
  }
}
