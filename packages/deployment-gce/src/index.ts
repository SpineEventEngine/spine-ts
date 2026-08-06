import { ApplicationNode, type LeasedNodeRegistry } from "@spine-event-engine/deployment";

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

  /** Creates a registrar with twenty-second renewal and sixty-second leases by default. */
  constructor(options: {
    readonly registry: LeasedNodeRegistry;
    readonly node: ApplicationNode;
    readonly identity: string;
    readonly scheduler: GceScheduler;
    readonly now: () => number;
  }) {
    this.#registry = options.registry;
    this.#node = options.node;
    this.#identity = options.identity;
    this.#scheduler = options.scheduler;
    this.#now = options.now;
  }

  /** Confirms initial registration after the listener is ready. */
  async start(): Promise<void> {
    if (this.#closed) throw new Error("GCE registrar is closed.");
    await this.#registry.register({
      node: this.#node,
      registrationId: this.#identity,
      expiresAt: this.#now() + 60_000,
    });
    this.#schedule();
  }

  /** Fences scheduled work and conditionally removes this registrar's lease. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#cancel?.();
    await this.#registry.remove(this.#node.id, this.#identity);
  }

  #schedule(): void {
    this.#cancel = this.#scheduler.schedule(20_000, () => {
      void this.#renew();
    });
  }

  async #renew(): Promise<void> {
    if (this.#closed) return;
    await this.#registry.renew(this.#node.id, this.#identity, this.#now() + 60_000);
    if (!this.#closed) this.#schedule();
  }
}
