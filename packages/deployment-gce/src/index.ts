import {
  ApplicationNode,
  type LeasedNodeRegistry,
  type NodeSnapshotReader,
} from "@spine-event-engine/deployment";
import { randomUUID } from "node:crypto";

/**
 * Supplies the trusted GCE metadata used to derive one stable application node.
 */
export interface GceMetadata {
  // prettier-ignore

  /**
   * Identifies the Google Cloud project containing the instance.
   */
  readonly projectId: string;

  /**
   * Identifies the GCE zone containing the instance.
   */
  readonly zone: string;

  /**
   * Identifies the numeric GCE instance.
   */
  readonly instanceId: string;

  /**
   * Supplies the instance's private IPv4 or IPv6 address.
   */
  readonly privateAddress: string;
}

/**
 * Retrieves trusted instance metadata from the GCE metadata service.
 */
export interface GceMetadataProvider {
  // prettier-ignore

  /**
   * Reads the identity and private address of the current instance.
   *
   * @param signal Cancels the metadata request during registrar shutdown.
   * @returns The validated metadata values.
   */
  read(signal: AbortSignal): Promise<GceMetadata>;
}

/**
 * Reads GCE metadata using the required metadata-service request header.
 */
export class GceMetadataService implements GceMetadataProvider {
  // prettier-ignore

  /**
   * Reads and validates the instance identity and private address.
   *
   * @param signal Cancels all four metadata-service reads.
   * @returns The normalized GCE metadata.
   * @throws Error When a response is unsuccessful or contains invalid identity data.
   */
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

/**
 * Configures the reachable application endpoint derived from GCE metadata.
 */
export interface GceApplicationNodeOptions {
  // prettier-ignore

  /**
   * Supplies the reachable gRPC TCP port.
   */
  readonly port: number;

  /**
   * Overrides the default private HTTP origin for private DNS or a proxy.
   */
  readonly endpoint?: string;

  /**
   * Supplies the TLS authority required by an HTTPS endpoint.
   */
  readonly tlsServerName?: string;
}

/**
 * Builds one canonical application node from trusted GCE metadata.
 */
export class GceApplicationNode {
  // prettier-ignore

  /**
   * Creates a stable GCE node using the private HTTP address by default.
   *
   * @param metadata Supplies trusted project, zone, numeric instance ID, and private address.
   * @param options Supplies the port and optional canonical endpoint/TLS override.
   * @returns A canonical application node whose ID is `gce/<project>/<zone>/<instance>`.
   * @throws Error When metadata identity or endpoint/TLS values are invalid.
   */
  static create(metadata: GceMetadata, options: GceApplicationNodeOptions): ApplicationNode {
    if (!metadata.projectId.trim() || !metadata.zone.trim() || !/^\d+$/.test(metadata.instanceId))
      throw new Error("GCE metadata identity is invalid.");
    if (!Number.isSafeInteger(options.port) || options.port < 1 || options.port > 65_535)
      throw new RangeError("GCE node port must be a valid TCP port.");
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

/**
 * Schedules deterministic registrar renewal work.
 */
export interface GceScheduler {
  // prettier-ignore

  /**
   * Schedules one renewal callback.
   *
   * @param delayMs Supplies a positive delay in milliseconds.
   * @param onTick Receives the callback to run once after the delay.
   * @returns Cancels the scheduled callback.
   */
  schedule(delayMs: number, onTick: () => void): () => void;
}

/**
 * Creates one cancellable deadline for cooperative registrar operations.
 */
export interface GceDeadlineFactory {
  // prettier-ignore

  /**
   * Creates an operation deadline.
   *
   * @param timeoutMs Supplies a positive timeout in milliseconds.
   * @returns An abort signal and an operation that releases the deadline handle.
   */
  create(timeoutMs: number): { readonly signal: AbortSignal; close(): void };
}

/**
 * Configures a ready-node registrar and its deterministic test seams.
 */
export interface GceRegistrarOptions {
  // prettier-ignore

  /**
   * Supplies the caller-owned leased-node registry.
   */
  readonly registry: LeasedNodeRegistry;

  /**
   * Supplies an already-derived application node.
   */
  readonly node?: ApplicationNode;

  /**
   * Supplies metadata used when `node` is omitted; defaults to `GceMetadataService` with a port.
   */
  readonly metadata?: GceMetadataProvider;

  /**
   * Supplies the application port used with metadata-derived nodes.
   */
  readonly port?: number;

  /**
   * Supplies the opaque process identity; a UUID is created when omitted.
   */
  readonly identity?: string;

  /**
   * Supplies deterministic renewal scheduling; a production timer is the default.
   */
  readonly scheduler?: GceScheduler;

  /**
   * Returns the clock value used to calculate lease expiry; `Date.now` is the default.
   *
   * @returns The current epoch time in milliseconds.
   */
  readonly now?: () => number;

  /**
   * Supplies cooperative operation deadlines; production deadlines are the default.
   */
  readonly deadlines?: GceDeadlineFactory;

  /**
   * Supplies a positive safe-integer operation timeout in milliseconds; defaults to 20 seconds.
   */
  readonly operationTimeoutMs?: number;
}

/**
 * Couples registrar lifecycle work to an application listener lifecycle.
 */
export interface GceRegistrarLifecycle {
  // prettier-ignore

  /**
   * Starts registration only after the listener is reachable.
   *
   * @returns Completes after the initial registration attempt settles.
   */
  start(): Promise<void>;

  /**
   * Removes the owned lease before listener network shutdown.
   *
   * @returns Completes after all admitted work and removal settle.
   */
  close(): Promise<void>;
}

const systemScheduler: GceScheduler = {
  schedule: (delayMs, onTick) => {
    const timer = setTimeout(onTick, delayMs);
    timer.unref();
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

/**
 * Registers one ready GCE node and renews its lease.
 */
export class GceRegistrar {
  // prettier-ignore

  readonly #registry: LeasedNodeRegistry;
  #node: ApplicationNode | undefined;
  readonly #metadata: GceMetadataProvider | undefined;
  readonly #port: number | undefined;
  readonly #identity: string;
  readonly #scheduler: GceScheduler;
  readonly #now: () => number;
  readonly #deadlines: GceDeadlineFactory;
  readonly #operationTimeoutMs: number;
  #cancel: (() => void) | undefined;
  #closed = false;
  #started = false;
  #confirmed = false;
  #work = Promise.resolve();
  #abort = new AbortController();

  /**
   * Creates a registrar with twenty-second renewal and sixty-second leases by default.
   *
   * @param options Supplies registry ownership, node derivation, and deterministic seams.
   */
  constructor(options: GceRegistrarOptions) {
    this.#registry = options.registry;
    if (options.node === undefined && options.port === undefined)
      throw new Error("GCE registrar requires a node or a metadata port.");
    this.#node = options.node;
    this.#metadata =
      options.metadata ?? (options.node === undefined ? new GceMetadataService() : undefined);
    this.#port = options.port;
    this.#identity = options.identity ?? randomUUID();
    this.#scheduler = options.scheduler ?? systemScheduler;
    this.#now = options.now ?? Date.now;
    this.#deadlines = options.deadlines ?? systemDeadlines;
    if (
      options.operationTimeoutMs !== undefined &&
      (!Number.isSafeInteger(options.operationTimeoutMs) || options.operationTimeoutMs < 1)
    )
      throw new RangeError("GCE registrar operation timeout must be a positive safe integer.");
    this.#operationTimeoutMs = options.operationTimeoutMs ?? 20_000;
  }

  /**
   * Starts initial registration after the listener is ready.
   *
   * Failed or unknown initial writes are retried on the next renewal interval
   * under the same process identity.
   *
   * @returns Completes after the first registration attempt has settled.
   * @throws Error When this registrar has already closed.
   */
  async start(): Promise<void> {
    if (this.#closed) throw new Error("GCE registrar is closed.");
    if (this.#started) return;
    this.#started = true;
    const registered = await this.#enqueue(async () => {
      await this.#resolveNode();
      const node = this.#node;
      if (node === undefined) throw new Error("GCE registrar has no resolved node.");
      return this.#operation((signal) =>
        this.#registry.register(
          {
            node,
            registrationId: this.#identity,
            expiresAt: this.#now() + 60_000,
          },
          signal,
        ),
      );
    }).catch(() => false);
    this.#schedule();
    this.#confirmed = registered;
  }

  /**
   * Removes this registrar's lease after fencing scheduled work.
   *
   * @returns Completes after admitted work settles and owned-row removal is attempted.
   */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#abort.abort();
    this.#cancel?.();
    await this.#work;
    const node = this.#node;
    if (node !== undefined)
      await this.#operation(
        (signal) => this.#registry.remove(node.id, this.#identity, signal),
        false,
      );
  }

  /**
   * Exposes listener-ready start and pre-network-close removal to a server assembly.
   *
   * @returns The lifecycle callbacks accepted by `Server.addListenerLifecycle()`.
   */
  lifecycle(): GceRegistrarLifecycle {
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
        this.#confirmed = await this.#operation((signal) =>
          this.#registry.renew(node.id, this.#identity, this.#now() + 60_000, signal),
        );
      else {
        const existing = await this.#operation((signal) =>
          this.#registry.lookup(node.id, this.#now(), signal),
        );
        this.#confirmed = existing?.registrationId === this.#identity;
        if (!this.#confirmed)
          this.#confirmed = await this.#operation((signal) =>
            this.#registry.register(
              {
                node,
                registrationId: this.#identity,
                expiresAt: this.#now() + 60_000,
              },
              signal,
            ),
          );
      }
      await this.#operation((signal) => this.#registry.cleanup(this.#now(), signal));
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

  async #operation<Result>(
    operation: (signal: AbortSignal) => Promise<Result>,
    includeShutdown = true,
  ): Promise<Result> {
    const deadline = this.#deadlines.create(this.#operationTimeoutMs);
    try {
      return await operation(
        includeShutdown ? AbortSignal.any([this.#abort.signal, deadline.signal]) : deadline.signal,
      );
    } finally {
      deadline.close();
    }
  }

  async #resolveNode(): Promise<void> {
    if (this.#node !== undefined) return;
    const metadata = this.#metadata;
    const port = this.#port;
    if (metadata === undefined || port === undefined)
      throw new Error("GCE registrar has no node source.");
    const deadline = this.#deadlines.create(this.#operationTimeoutMs);
    try {
      const signal = AbortSignal.any([this.#abort.signal, deadline.signal]);
      this.#node = GceApplicationNode.create(await metadata.read(signal), { port });
    } finally {
      deadline.close();
    }
  }
}

/**
 * Reads complete live-node snapshots from the leased registry.
 */
export class GceRegistryReader implements NodeSnapshotReader {
  // prettier-ignore

  /**
   * Creates a reader using an injected clock for deterministic expiry evaluation.
   *
   * @param registry Supplies the leased registry to read.
   * @param now Supplies the current epoch time used for exact expiry filtering; defaults to `Date.now`.
   */
  constructor(
    private readonly registry: LeasedNodeRegistry,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Reads every currently live node.
   *
   * @param signal Cancels the registry read during discovery close.
   * @returns The complete live application-node snapshot.
   */
  read(signal: AbortSignal): Promise<readonly ApplicationNode[]> {
    return this.registry.read(this.now(), signal);
  }
}
