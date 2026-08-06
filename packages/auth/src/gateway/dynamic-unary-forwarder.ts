import type { ApplicationNode } from "@spine-event-engine/deployment";

import type { UnaryForwarder } from "./index.js";

type PendingSnapshot = { readonly nodes: readonly ApplicationNode[]; readonly done: (() => void)[] };

/** A connected unary backend with deterministic disposal. */
export interface DynamicUnaryClient extends UnaryForwarder {
  /** Releases the connection after its node leaves membership. */
  close(): Promise<void>;
}

/** Creates one unary client for a discovered node. */
export interface DynamicUnaryOptions {
  /** Creates the client for one canonical application node. */
  readonly create: (node: ApplicationNode, signal: AbortSignal) => Promise<DynamicUnaryClient>;

  /** Bounds simultaneous connection starts. Defaults to eight. */
  readonly maxConcurrentStarts?: number;
}

/**
 * Routes authorized unary operations over the current complete membership.
 * Reconciliation is serialized; a request is sent once to its selected client.
 */
export class DynamicUnaryForwarder implements UnaryForwarder {
  readonly #options: DynamicUnaryOptions;
  readonly #maxConcurrentStarts: number;
  #clients = new Map<string, { readonly endpoint: string; readonly client: DynamicUnaryClient }>();
  #next = 0;
  #closed = false;
  #running: Promise<void> | undefined;
  #pending: PendingSnapshot | undefined;

  /** @param options Supplies the per-node client factory. */
  constructor(options: DynamicUnaryOptions) {
    if (options.maxConcurrentStarts !== undefined && (!Number.isSafeInteger(options.maxConcurrentStarts) || options.maxConcurrentStarts < 1))
      throw new RangeError("maxConcurrentStarts must be a positive safe integer.");
    this.#options = options;
    this.#maxConcurrentStarts = options.maxConcurrentStarts ?? 8;
  }

  /** Replaces membership, retaining only clients with identical node identities and endpoints. */
  reconcile(nodes: readonly ApplicationNode[]): Promise<void> {
    return new Promise((resolve) => {
      const pending = this.#pending;
      this.#pending = { nodes: [...nodes], done: pending === undefined ? [resolve] : [...pending.done, resolve] };
      if (this.#running === undefined) this.#running = this.#run();
    });
  }

  async #run(): Promise<void> {
    while (this.#pending !== undefined && !this.#closed) {
      const snapshot = this.#pending;
      this.#pending = undefined;
      await this.#replace(snapshot.nodes);
      const later = await this.#currentPending();
      if (later === undefined) for (const done of snapshot.done) done();
      else this.#pending = { nodes: later.nodes, done: [...snapshot.done, ...later.done] };
    }
    const pending = this.#pending;
    this.#pending = undefined;
    if (pending !== undefined) for (const done of pending.done) done();
    this.#running = undefined;
  }

  async #currentPending(): Promise<PendingSnapshot | undefined> { return this.#pending; }

  async #replace(nodes: readonly ApplicationNode[]): Promise<void> {
    if (this.#closed) return;
    const wanted = new Map(nodes.map((node) => [node.id, node]));
    for (const [id, current] of this.#clients) {
      const node = wanted.get(id);
      if (node?.endpoint === current.endpoint) continue;
      this.#clients.delete(id);
      await current.client.close();
    }
    const added = nodes.filter((node) => !this.#clients.has(node.id));
    for (let index = 0; index < added.length; index += this.#maxConcurrentStarts)
      await Promise.all(added.slice(index, index + this.#maxConcurrentStarts).map((node) => this.#start(node)));
    this.#next = 0;
  }

  async #start(node: ApplicationNode): Promise<void> {
    const client = await this.#options.create(node, new AbortController().signal);
    if (this.#closed) await client.close();
    else this.#clients.set(node.id, { endpoint: node.endpoint, client });
  }

  /** Forwards once to the next current client. */
  forward(request: Parameters<UnaryForwarder["forward"]>[0]): Promise<Uint8Array> {
    const clients = [...this.#clients.values()];
    const selected = clients[this.#next % clients.length];
    this.#next++;
    if (selected === undefined) return Promise.reject(new Error("Gateway backend is absent."));
    return selected.client.forward(request);
  }

  /** Stops later reconciliation and closes every current client. */
  async close(): Promise<void> {
    this.#closed = true;
    await this.#running;
    await Promise.all([...this.#clients.values()].map(({ client }) => client.close()));
    this.#clients.clear();
  }
}
