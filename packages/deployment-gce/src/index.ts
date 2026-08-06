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

/** Retrieves trusted instance metadata from the GCE metadata service. */
export interface GceMetadataProvider {
  read(signal: AbortSignal): Promise<GceMetadata>;
}

/** Reads GCE metadata using the required metadata-service request header. */
export class GceMetadataService implements GceMetadataProvider {
  /** Reads the instance identity and private address. */
  async read(signal: AbortSignal): Promise<GceMetadata> {
    const root = "http://metadata.google.internal/computeMetadata/v1";
    const get = async (path: string) => {
      const response = await fetch(`${root}/${path}`, {
        signal,
        headers: { "Metadata-Flavor": "Google" },
      });
      if (!response.ok) throw new Error("GCE metadata request failed.");
      return response.text();
    };
    const [projectId, zonePath, instanceId, privateAddress] = await Promise.all([
      get("project/project-id"),
      get("instance/zone"),
      get("instance/id"),
      get("instance/network-interfaces/0/ip"),
    ]);
    const normalizedProjectId = projectId.trim();
    const zone = (zonePath.split("/").at(-1) ?? "").trim();
    const normalizedInstanceId = instanceId.trim();
    const normalizedPrivateAddress = privateAddress.trim();
    if (
      !normalizedProjectId ||
      !zone ||
      !/^\d+$/.test(normalizedInstanceId) ||
      !normalizedPrivateAddress
    )
      throw new Error("GCE metadata response is invalid.");
    return {
      projectId: normalizedProjectId,
      zone,
      instanceId: normalizedInstanceId,
      privateAddress: normalizedPrivateAddress,
    };
  }
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

/** Creates one cancellable deadline for cooperative operations. */
export interface GceDeadlineFactory {
  create(timeoutMs: number): { readonly signal: AbortSignal; close(): void };
}

const systemScheduler: GceScheduler = {
  schedule: (delayMs, onTick) => {
    const timer = setTimeout(onTick, delayMs);
    return () => clearTimeout(timer);
  },
};
const systemDeadlines: GceDeadlineFactory = {
  create(timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref();
    return { signal: controller.signal, close: () => clearTimeout(timer) };
  },
};

/** Registers one ready GCE node and renews its lease. */
export class GceRegistrar {
  readonly #registry: LeasedNodeRegistry;
  #node: ApplicationNode | undefined;
  readonly #metadata: GceMetadataProvider | undefined;
  readonly #port: number | undefined;
  readonly #identity: string;
  readonly #scheduler: GceScheduler;
  readonly #now: () => number;
  readonly #deadlines: GceDeadlineFactory;
  #cancel: (() => void) | undefined;
  #closed = false;
  #started = false;
  #confirmed = false;
  #work = Promise.resolve();
  #abort = new AbortController();

  /** Creates a registrar with twenty-second renewal and sixty-second leases by default. */
  constructor(options: {
    readonly registry: LeasedNodeRegistry;
    readonly node?: ApplicationNode;
    readonly metadata?: GceMetadataProvider;
    readonly port?: number;
    readonly identity?: string;
    readonly scheduler?: GceScheduler;
    readonly now?: () => number;
    readonly deadlines?: GceDeadlineFactory;
  }) {
    this.#registry = options.registry;
    if (
      options.node === undefined &&
      (options.metadata === undefined || options.port === undefined)
    )
      throw new Error("GCE registrar requires a node or metadata provider and port.");
    this.#node = options.node;
    this.#metadata = options.metadata;
    this.#port = options.port;
    this.#identity = options.identity ?? randomUUID();
    this.#scheduler = options.scheduler ?? systemScheduler;
    this.#now = options.now ?? Date.now;
    this.#deadlines = options.deadlines ?? systemDeadlines;
  }

  /** Confirms initial registration after the listener is ready. */
  async start(): Promise<void> {
    if (this.#closed) throw new Error("GCE registrar is closed.");
    if (this.#started) return;
    this.#started = true;
    const registered = await this.#enqueue(async () => {
      await this.#resolveNode();
      const node = this.#node;
      if (node === undefined) throw new Error("GCE registrar has no resolved node.");
      return this.#registry.register({
        node,
        registrationId: this.#identity,
        expiresAt: this.#now() + 60_000,
      });
    }).catch(() => false);
    this.#schedule();
    this.#confirmed = registered;
  }

  /** Fences scheduled work and conditionally removes this registrar's lease. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#abort.abort();
    this.#cancel?.();
    await this.#work;
    if (this.#node !== undefined) await this.#registry.remove(this.#node.id, this.#identity);
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
      await this.#resolveNode();
      const node = this.#node;
      if (node === undefined) return;
      if (this.#confirmed)
        this.#confirmed = await this.#registry.renew(node.id, this.#identity, this.#now() + 60_000);
      else {
        const existing = await this.#registry.lookup(node.id, this.#now());
        this.#confirmed = existing?.registrationId === this.#identity;
        if (!this.#confirmed)
          this.#confirmed = await this.#registry.register({
            node,
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
    this.#work = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async #resolveNode(): Promise<void> {
    if (this.#node !== undefined) return;
    const metadata = this.#metadata;
    const port = this.#port;
    if (metadata === undefined || port === undefined)
      throw new Error("GCE registrar has no node source.");
    const deadline = this.#deadlines.create(20_000);
    try {
      const signal = AbortSignal.any([this.#abort.signal, deadline.signal]);
      this.#node = GceApplicationNode.create(await metadata.read(signal), { port });
    } finally {
      deadline.close();
    }
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
