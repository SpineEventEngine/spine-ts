import type { ApplicationNode } from "@spine-event-engine/deployment";

import type { UnaryForwarder } from "./index.js";

type PendingSnapshot = {
  readonly nodes: readonly ApplicationNode[];
  readonly generation: number;
};

/**
 * Represents a connected unary backend with deterministic disposal.
 */
export interface DynamicUnaryClient extends UnaryForwarder {
  // prettier-ignore

  /**
   * Returns after releasing this connection when its node leaves membership.
   *
   * @returns Completes after the connection is released.
   */
  close(): Promise<void>;
}

/**
 * Configures unary clients for discovered application nodes.
 */
export interface DynamicUnaryOptions {
  // prettier-ignore

  /**
   * Creates the client for one canonical application node.
   *
   * @param node Supplies the canonical application node.
   * @param signal Cancels connection creation during shutdown.
   * @returns The connected unary client.
   */
  readonly create: (node: ApplicationNode, signal: AbortSignal) => Promise<DynamicUnaryClient>;

  /**
   * Bounds simultaneous connection starts. Defaults to eight.
   */
  readonly maxConcurrentStarts?: number;
}

/**
 * Routes authorized unary operations over the current complete membership.
 * Reconciliation is serialized; a request is sent once to its selected client.
 */
export class DynamicUnaryForwarder implements UnaryForwarder {
  readonly #options: DynamicUnaryOptions;
  readonly #maxConcurrentStarts: number;
  #clients = new Map<
    string,
    {
      readonly endpoint: string;
      readonly tlsServerName: string | undefined;
      readonly client: DynamicUnaryClient;
    }
  >();
  #next = 0;
  #closed = false;
  #running: Promise<void> | undefined;
  #pending: PendingSnapshot | undefined;
  readonly #creating = new Set<AbortController>();
  #completion = Promise.resolve();
  #complete: (() => void) | undefined;
  #closing: Promise<void> | undefined;
  #generation = 0;
  readonly #failedDisposals = new Set<DynamicUnaryClient>();

  /**
   * Creates a dynamic unary router.
   *
   * @param options Supplies the per-node client factory.
   */
  constructor(options: DynamicUnaryOptions) {
    if (
      options.maxConcurrentStarts !== undefined &&
      (!Number.isSafeInteger(options.maxConcurrentStarts) || options.maxConcurrentStarts < 1)
    )
      throw new RangeError("maxConcurrentStarts must be a positive safe integer.");
    this.#options = options;
    this.#maxConcurrentStarts = options.maxConcurrentStarts ?? 8;
  }

  /**
   * Replaces membership while retaining clients with equal node identities and endpoints.
   *
   * @param nodes Supplies the replacement complete membership snapshot.
   * @returns Completes after the latest pending snapshot has reconciled.
   */
  reconcile(nodes: readonly ApplicationNode[]): Promise<void> {
    this.#pending = { nodes: [...nodes], generation: ++this.#generation };
    if (this.#running === undefined) {
      this.#completion = new Promise((resolve) => {
        this.#complete = resolve;
      });
      this.#running = this.#run();
    }
    return this.#completion;
  }

  async #run(): Promise<void> {
    while (this.#pending !== undefined && !this.#closed) {
      const snapshot = this.#pending;
      this.#pending = undefined;
      try {
        await this.#replace(snapshot.nodes, snapshot.generation);
      } catch {
        // A later complete snapshot starts a fresh reconciliation owner.
      }
      const later = await this.#currentPending();
      if (later !== undefined) this.#pending = later;
    }
    this.#pending = undefined;
    this.#running = undefined;
    this.#complete?.();
    this.#complete = undefined;
  }

  async #currentPending(): Promise<PendingSnapshot | undefined> {
    return this.#pending;
  }

  async #replace(nodes: readonly ApplicationNode[], generation: number): Promise<void> {
    if (this.#closed) return;
    await this.#retryDisposals();
    const wanted = new Map<string, ApplicationNode>();
    for (const node of nodes) {
      const previous = wanted.get(node.id);
      if (
        previous !== undefined &&
        (previous.endpoint !== node.endpoint || previous.tlsServerName !== node.tlsServerName)
      )
        throw new Error("Application node IDs must not identify conflicting endpoints.");
      wanted.set(node.id, node);
    }
    for (const [id, current] of this.#clients) {
      const node = wanted.get(id);
      if (node?.endpoint === current.endpoint && node.tlsServerName === current.tlsServerName)
        continue;
      this.#clients.delete(id);
      await this.#dispose(current.client);
    }
    const added = [...wanted.values()].filter((node) => !this.#clients.has(node.id));
    for (let index = 0; index < added.length; index += this.#maxConcurrentStarts)
      await Promise.all(
        added
          .slice(index, index + this.#maxConcurrentStarts)
          .map((node) => this.#start(node, generation)),
      );
    this.#next = 0;
  }

  async #dispose(client: DynamicUnaryClient): Promise<void> {
    try {
      await client.close();
      this.#failedDisposals.delete(client);
    } catch {
      this.#failedDisposals.add(client);
    }
  }

  async #retryDisposals(): Promise<void> {
    for (const client of this.#failedDisposals) await this.#dispose(client);
  }

  async #start(node: ApplicationNode, generation: number): Promise<void> {
    const controller = new AbortController();
    this.#creating.add(controller);
    let client: DynamicUnaryClient;
    try {
      client = await this.#options.create(node, controller.signal);
    } finally {
      this.#creating.delete(controller);
    }
    if (this.#closed || generation !== this.#generation) await this.#dispose(client);
    else
      this.#clients.set(node.id, {
        endpoint: node.endpoint,
        tlsServerName: node.tlsServerName,
        client,
      });
  }

  /**
   * Returns one response from the next current client without retrying it.
   *
   * @param request Supplies the authorized unary request.
   * @returns The selected backend response bytes.
   */
  forward(request: Parameters<UnaryForwarder["forward"]>[0]): Promise<Uint8Array> {
    const clients = [...this.#clients.values()];
    const selected = clients[this.#next % clients.length];
    this.#next++;
    if (selected === undefined) return Promise.reject(new Error("Gateway backend is absent."));
    return selected.client.forward(request);
  }

  /**
   * Stops later reconciliation and closes every current client.
   *
   * @returns Completes after every current client is closed.
   */
  async close(): Promise<void> {
    this.#closing ??= this.#closeOnce().catch((error: unknown) => {
      this.#closing = undefined;
      throw error;
    });
    return this.#closing;
  }

  async #closeOnce(): Promise<void> {
    this.#closed = true;
    for (const controller of this.#creating) controller.abort();
    await this.#running;
    await Promise.all([...this.#clients.values()].map(({ client }) => this.#dispose(client)));
    this.#clients.clear();
    await this.#retryDisposals();
    if (this.#failedDisposals.size > 0)
      throw new Error("Gateway dynamic client cleanup remains incomplete.");
  }
}
