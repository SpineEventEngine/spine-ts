import type { ApplicationNode } from "@spine-event-engine/deployment";

import type { UnaryForwarder } from "./index.js";

/** A connected unary backend with deterministic disposal. */
export interface DynamicUnaryClient extends UnaryForwarder {
  /** Releases the connection after its node leaves membership. */
  close(): Promise<void>;
}

/** Creates one unary client for a discovered node. */
export interface DynamicUnaryOptions {
  /** Creates the client for one canonical application node. */
  readonly create: (node: ApplicationNode, signal: AbortSignal) => Promise<DynamicUnaryClient>;
}

/**
 * Routes authorized unary operations over the current complete membership.
 * Reconciliation is serialized; a request is sent once to its selected client.
 */
export class DynamicUnaryForwarder implements UnaryForwarder {
  readonly #options: DynamicUnaryOptions;
  #clients = new Map<string, { readonly endpoint: string; readonly client: DynamicUnaryClient }>();
  #next = 0;
  #closed = false;
  #work = Promise.resolve();

  /** @param options Supplies the per-node client factory. */
  constructor(options: DynamicUnaryOptions) { this.#options = options; }

  /** Replaces membership, retaining only clients with identical node identities and endpoints. */
  reconcile(nodes: readonly ApplicationNode[]): Promise<void> {
    this.#work = this.#work.then(() => this.#replace(nodes));
    return this.#work;
  }

  async #replace(nodes: readonly ApplicationNode[]): Promise<void> {
    if (this.#closed) return;
    const wanted = new Map(nodes.map((node) => [node.id, node]));
    for (const [id, current] of this.#clients) {
      const node = wanted.get(id);
      if (node?.endpoint === current.endpoint) continue;
      this.#clients.delete(id);
      await current.client.close();
    }
    for (const node of nodes) {
      if (this.#clients.has(node.id)) continue;
      const client = await this.#options.create(node, new AbortController().signal);
      if (this.#closed) await client.close();
      else this.#clients.set(node.id, { endpoint: node.endpoint, client });
    }
    this.#next = 0;
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
    await this.#work;
    await Promise.all([...this.#clients.values()].map(({ client }) => client.close()));
    this.#clients.clear();
  }
}
