import { type ApplicationNode, type LeasedNodeRegistry } from "@spine-event-engine/deployment";
import { randomUUID } from "node:crypto";
import type { ILogLayer } from "loglayer";

import { GceMetadataService, type GceMetadataProvider } from "../metadata/gce-metadata-service.js";
import { GceApplicationNode } from "../node/application-node.js";
import {
  GceOperationRunner,
  systemGceDeadlines,
  systemGceScheduler,
  type GceDeadlineFactory,
  type GceScheduler,
} from "./operations.js";

interface GceRegistrarBaseOptions {
  readonly registry: LeasedNodeRegistry;
  readonly identity?: string;
  readonly scheduler?: GceScheduler;
  readonly now?: () => number;
  readonly deadlines?: GceDeadlineFactory;
  readonly operationTimeoutMs?: number;
}

interface ExplicitRegistrarOptions extends GceRegistrarBaseOptions {
  readonly node: ApplicationNode;
  readonly metadata?: never;
  readonly port?: never;
}

interface MetadataRegistrarOptions extends GceRegistrarBaseOptions {
  readonly node?: undefined;
  readonly metadata?: GceMetadataProvider;
  readonly port: number;
}

/**
 * Configures a ready-node registrar and its deterministic test seams.
 *
 * Supply either an explicit node or a metadata-derived node with its port.
 */
export type GceRegistrarOptions =
  | (ExplicitRegistrarOptions & {
      // prettier-ignore

      /**
       * Application-owned logger for this independently running component.
       */
      readonly logger?: ILogLayer;
    })
  | (MetadataRegistrarOptions & {
      // prettier-ignore

      /**
       * Application-owned logger for this independently running component.
       */
      readonly logger?: ILogLayer;
    });

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

/**
 * Registers one ready GCE node and renews its lease.
 */
export class GceRegistrar {
  readonly #registry: LeasedNodeRegistry;
  #node: ApplicationNode | undefined;
  readonly #metadata: GceMetadataProvider | undefined;
  readonly #port: number | undefined;
  readonly #identity: string;
  readonly #scheduler: GceScheduler;
  readonly #now: () => number;
  readonly #deadlines: GceDeadlineFactory;
  readonly #operationTimeoutMs: number;
  readonly #operations: GceOperationRunner;
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
    if (options.node === undefined && (options as { readonly port?: number }).port === undefined)
      throw new Error("GCE registrar requires a node or a metadata port.");
    this.#node = options.node;
    this.#metadata =
      options.metadata ?? (options.node === undefined ? new GceMetadataService() : undefined);
    this.#port = options.port;
    this.#identity = options.identity ?? randomUUID();
    this.#scheduler = options.scheduler ?? systemGceScheduler;
    this.#now = options.now ?? Date.now;
    this.#deadlines = options.deadlines ?? systemGceDeadlines;
    if (
      options.operationTimeoutMs !== undefined &&
      (!Number.isSafeInteger(options.operationTimeoutMs) || options.operationTimeoutMs < 1)
    )
      throw new RangeError("GCE registrar operation timeout must be a positive safe integer.");
    this.#operationTimeoutMs = options.operationTimeoutMs ?? 20_000;
    this.#operations = new GceOperationRunner(
      this.#deadlines,
      this.#operationTimeoutMs,
      this.#abort.signal,
    );
  }

  /**
   * Starts initial registration after the listener is ready.
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
          { node, registrationId: this.#identity, expiresAt: this.#now() + 60_000 },
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
    if (this.#closed) return;
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
              { node, registrationId: this.#identity, expiresAt: this.#now() + 60_000 },
              signal,
            ),
          );
      }
      await this.#operation((signal) => this.#registry.cleanup(this.#now(), signal));
    } finally {
      // A concurrent close may fence renewal while its registry operation is pending.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
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

  #operation<Result>(
    operation: (signal: AbortSignal) => Promise<Result>,
    includeShutdown = true,
  ): Promise<Result> {
    return this.#operations.run(operation, includeShutdown);
  }

  async #resolveNode(): Promise<void> {
    if (this.#node !== undefined) return;
    const metadata = this.#metadata;
    const port = this.#port;
    if (metadata === undefined || port === undefined)
      throw new Error("GCE registrar has no node source.");
    this.#node = GceApplicationNode.create(
      await this.#operations.run((signal) => metadata.read(signal)),
      { port },
    );
  }
}
