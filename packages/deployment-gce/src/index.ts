import {
  ApplicationNode,
  type LeasedNodeRegistry,
  type NodeSnapshotReader,
} from "@spine-event-engine/deployment";
import { randomUUID } from "node:crypto";

/** Supplies trusted GCE instance metadata. */
export interface GceMetadata {
  readonly projectId: string;
  readonly zone: string;
  readonly instanceId: string;
  readonly privateAddress: string;
}

/** Builds one canonical application node from trusted GCE metadata. */
export class GceApplicationNode {
  /** Creates a stable GCE node using the private HTTP address by default. */
  static create(
    metadata: GceMetadata,
    options: { readonly port: number; readonly endpoint?: string; readonly tlsServerName?: string },
  ): ApplicationNode {
    const endpoint =
      options.endpoint ??
      `http://${GceApplicationNode.host(metadata.privateAddress)}:${String(options.port)}`;
    return new ApplicationNode({
      id: `gce/${metadata.projectId}/${metadata.zone}/${metadata.instanceId}`,
      endpoint,
      ...(options.tlsServerName === undefined ? {} : { tlsServerName: options.tlsServerName }),
    });
  }

  private static host(address: string): string {
    return address.includes(":") ? `[${address}]` : address;
  }
}

/** Schedules deterministic registrar work. */
export interface GceScheduler {
  schedule(delayMs: number, onTick: () => void): () => void;
}

/** Registers one ready GCE node and renews its lease. */
export class GceRegistrar {
  readonly #registry: LeasedNodeRegistry;
  readonly #node: ApplicationNode;
  readonly #identity: string;
  readonly #scheduler: GceScheduler;
  readonly #now: () => number;
  #cancel: (() => void) | undefined;
  #closed = false;
  #started = false;
  #confirmed = false;
  #work = Promise.resolve();

  /** Creates a registrar with twenty-second renewal and sixty-second leases by default. */
  constructor(options: {
    readonly registry: LeasedNodeRegistry;
    readonly node: ApplicationNode;
    readonly identity?: string;
    readonly scheduler: GceScheduler;
    readonly now: () => number;
  }) {
    this.#registry = options.registry;
    this.#node = options.node;
    this.#identity = options.identity ?? randomUUID();
    this.#scheduler = options.scheduler;
    this.#now = options.now;
  }

  /** Confirms initial registration after the listener is ready. */
  async start(): Promise<void> {
    if (this.#closed) throw new Error("GCE registrar is closed.");
    if (this.#started) return;
    this.#started = true;
    const registered = await this.#enqueue(async () =>
      this.#registry.register({
        node: this.#node,
        registrationId: this.#identity,
        expiresAt: this.#now() + 60_000,
      }),
    ).catch(() => false);
    this.#schedule();
    this.#confirmed = registered;
  }

  /** Fences scheduled work and conditionally removes this registrar's lease. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#cancel?.();
    await this.#work;
    await this.#registry.remove(this.#node.id, this.#identity);
  }

  /** Exposes listener-ready start and pre-network-close removal to a server assembly. */
  lifecycle(): { start(): Promise<void>; close(): Promise<void> } {
    return { start: () => this.start(), close: () => this.close() };
  }

  #schedule(): void {
    this.#cancel = this.#scheduler.schedule(20_000, () => {
      void this.#enqueue(() => this.#renew()).catch(() => undefined);
    });
  }

  async #renew(): Promise<void> {
    if (this.#closed) return;
    try {
      if (this.#confirmed)
        this.#confirmed = await this.#registry.renew(
          this.#node.id,
          this.#identity,
          this.#now() + 60_000,
        );
      else {
        const existing = await this.#registry.lookup(this.#node.id, this.#now());
        this.#confirmed = existing?.registrationId === this.#identity;
        if (!this.#confirmed)
          this.#confirmed = await this.#registry.register({
            node: this.#node,
            registrationId: this.#identity,
            expiresAt: this.#now() + 60_000,
          });
      }
      await this.#registry.cleanup(this.#now());
    } finally {
      if (!this.#closed) this.#schedule();
    }
  }

  #enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
    const next = this.#work.then(operation, operation);
    this.#work = next.catch(() => undefined);
    return next;
  }
}

/** Reads complete live-node snapshots from the leased registry. */
export class GceRegistryReader implements NodeSnapshotReader {
  /** Creates a reader using an injected clock for deterministic expiry evaluation. */
  constructor(
    private readonly registry: LeasedNodeRegistry,
    private readonly now: () => number,
  ) {}

  /** Reads every currently live node. */
  read(_signal: AbortSignal): Promise<readonly ApplicationNode[]> {
    return this.registry.read(this.now());
  }
}
