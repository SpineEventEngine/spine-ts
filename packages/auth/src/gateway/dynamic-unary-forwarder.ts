import { fromBinary } from "@bufbuild/protobuf";
import { SubscriptionSchema } from "@spine-event-engine/proto/client";
import type { ApplicationNode } from "@spine-event-engine/deployment";

import type { UnaryForwarder } from "./index.js";
import type {
  BackendSubscriptionEnvelope,
  PublicSubscriptionWire,
  SubscriptionCreator,
  SubscriptionUpdateSink,
} from "../subscriptions/index.js";

interface PendingSnapshot {
  readonly nodes: readonly ApplicationNode[];
  readonly generation: number;
}

interface SubscriptionChild {
  readonly backend: BackendSubscriptionEnvelope;
  readonly controller: AbortController;
  activation: Promise<void>;
  active: boolean;
}

interface FailedChildCleanup {
  readonly client: DynamicUnaryClient;
  readonly backend: BackendSubscriptionEnvelope;
}

/**
 * Represents a connected unary backend with deterministic disposal.
 */
export interface DynamicUnaryClient extends UnaryForwarder, SubscriptionCreator {
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
      readonly incarnation: number;
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
  readonly #failedChildCleanup = new Set<FailedChildCleanup>();
  #nextIncarnation = 0;
  #nodes: readonly ApplicationNode[] = [];
  readonly #definitions = new Map<
    string,
    {
      readonly wire: PublicSubscriptionWire;
      readonly maxBackendEnvelopeBytes: number;
      updates: SubscriptionUpdateSink | undefined;
      active: boolean;
      readonly starts: Set<AbortController>;
      readonly children: Map<string, SubscriptionChild>;
      failure: Error | undefined;
    }
  >();

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
    return this.#schedule(nodes, true);
  }

  #schedule(nodes: readonly ApplicationNode[], abortStarts: boolean): Promise<void> {
    this.#nodes = [...nodes];
    this.#pending = { nodes: [...nodes], generation: ++this.#generation };
    if (abortStarts)
      for (const definition of this.#definitions.values())
        for (const controller of definition.starts) controller.abort();
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

  #currentPending(): Promise<PendingSnapshot | undefined> {
    return Promise.resolve(this.#pending);
  }

  async #replace(nodes: readonly ApplicationNode[], generation: number): Promise<void> {
    if (this.#closed || generation !== this.#generation) return;
    await this.#retryDisposals();
    if (this.#failedChildCleanup.size > 0) await this.#retryChildCleanup();
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
      if (generation !== this.#generation) return;
      const node = wanted.get(id);
      if (node?.endpoint === current.endpoint && node.tlsServerName === current.tlsServerName)
        continue;
      this.#clients.delete(id);
      if (this.#definitions.size > 0) await this.#removeNodeChildren(id, current.client);
      await this.#dispose(current.client);
      if (generation !== this.#generation) return;
    }
    const added = [...wanted.values()].filter((node) => !this.#clients.has(node.id));
    for (let index = 0; index < added.length; index += this.#maxConcurrentStarts)
      await Promise.allSettled(
        added
          .slice(index, index + this.#maxConcurrentStarts)
          .map((node) => this.#start(node, generation)),
      );
    if (generation !== this.#generation) return;
    await this.#reconcileDefinitions(generation);
    this.#next = 0;
  }

  /**
   * Registers one logical definition with the shared membership owner.
   *
   * @param request Supplies canonical logical subscription bytes.
   * @param signal Cancels creation before it reaches a native node.
   * @param maxBackendEnvelopeBytes Limits every per-node native envelope.
   * @returns Completes after every current node installs its native child.
   */
  async subscribeDefinition(
    request: PublicSubscriptionWire,
    signal: AbortSignal,
    maxBackendEnvelopeBytes: number = Number.MAX_SAFE_INTEGER,
  ): Promise<void> {
    if (signal.aborted || this.#closed || this.#nodes.length === 0)
      throw new Error("Gateway backend is absent.");
    const wire = { kind: "public-subscription" as const, bytes: request.bytes.slice() };
    const subscription = fromBinary(SubscriptionSchema, wire.bytes);
    const id = subscription.id?.value;
    if (id === undefined || id.length === 0) throw new Error("subscription ID is required");
    const key = id;
    if (!this.#definitions.has(key))
      this.#definitions.set(key, {
        wire,
        maxBackendEnvelopeBytes,
        updates: undefined,
        active: false,
        starts: new Set(),
        children: new Map(),
        failure: undefined,
      });
    const definition = this.#definitions.get(key);
    if (definition === undefined) throw new Error("subscription creation was cancelled");
    await this.#schedule([...this.#nodes.values()], false);
    if (!this.#definitions.has(key) || signal.aborted || this.#closed)
      throw new Error("subscription creation was cancelled");
    if (definition.failure !== undefined) {
      this.#definitions.delete(key);
      await this.#removeDefinitionChildren(definition);
      throw definition.failure;
    }
    if (definition.children.size !== this.#clients.size) {
      this.#definitions.delete(key);
      await this.#removeDefinitionChildren(definition);
      throw new Error("Gateway backend is absent.");
    }
  }

  /**
   * Rehydrates one durable logical definition without treating it as a public Subscribe request.
   *
   * @param request Supplies the canonical definition retained by durable storage.
   * @param maxBackendEnvelopeBytes Limits every per-node native envelope.
   * @returns Completes after current membership receives native children.
   */
  async rehydrateDefinition(
    request: PublicSubscriptionWire,
    maxBackendEnvelopeBytes: number,
  ): Promise<void> {
    if (this.#closed) throw new Error("Gateway dynamic owner is closed.");
    const subscription = fromBinary(SubscriptionSchema, request.bytes);
    const id = subscription.id?.value;
    if (id === undefined || id.length === 0) throw new Error("subscription ID is required");
    if (!this.#definitions.has(id))
      this.#definitions.set(id, {
        wire: { kind: "public-subscription", bytes: request.bytes.slice() },
        maxBackendEnvelopeBytes,
        updates: undefined,
        active: false,
        starts: new Set(),
        children: new Map(),
        failure: undefined,
      });
    await this.#schedule([...this.#nodes.values()], false);
    const definition = this.#definitions.get(id);
    if (definition?.failure !== undefined) throw definition.failure;
  }

  async #reconcileDefinitions(generation: number): Promise<void> {
    for (const definition of this.#definitions.values()) {
      for (const [id, child] of definition.children)
        if (!this.#clients.has(id)) {
          definition.children.delete(id);
          await this.#cleanupChild(child, undefined);
        }
      const missing = [...this.#clients.entries()].filter(([id]) => !definition.children.has(id));
      for (let index = 0; index < missing.length; index += this.#maxConcurrentStarts)
        for (const result of await Promise.allSettled(
          missing
            .slice(index, index + this.#maxConcurrentStarts)
            .map(([id, current]) => this.#startChild(definition, id, current, generation)),
        ))
          if (result.status === "rejected" && definition.failure === undefined)
            definition.failure =
              result.reason instanceof Error
                ? result.reason
                : new Error("native subscription creation failed");
      if (definition.active && definition.updates !== undefined)
        for (const [id, child] of definition.children) {
          const current = this.#clients.get(id);
          if (current !== undefined && !child.active)
            this.#activateChild(definition, id, child, current.client);
        }
    }
  }

  /**
   * Removes one logical definition and cancels its currently installed children.
   *
   * @param wire Supplies the logical definition.
   * @param signal Cancels native cleanup.
   * @returns Completes after every current child cancellation settles.
   */
  async cancelDefinition(wire: PublicSubscriptionWire, signal: AbortSignal): Promise<void> {
    const key = fromBinary(SubscriptionSchema, wire.bytes).id?.value;
    if (key === undefined || key.length === 0) return;
    const definition = this.#definitions.get(key);
    this.#definitions.delete(key);
    if (definition === undefined) return;
    for (const controller of definition.starts) controller.abort();
    await this.#schedule([...this.#nodes.values()], false);
    await Promise.allSettled(
      [...definition.children].map(async ([id, child]) => {
        const client = this.#clients.get(id)?.client;
        if (client === undefined) return;
        child.controller.abort();
        try {
          await client.dispose(child.backend, signal);
        } catch {
          this.#failedChildCleanup.add({ client, backend: child.backend });
        }
        await child.activation.catch(() => undefined);
      }),
    );
  }

  /**
   * Associates the browser activation wire and update sink with a logical definition.
   *
   * @param wire Supplies the canonical public subscription wire.
   * @param updates Receives best-effort native updates.
   * @returns Completes after current membership has observed the activation.
   */
  async activateDefinition(
    wire: PublicSubscriptionWire,
    updates: SubscriptionUpdateSink,
    signal: AbortSignal,
  ): Promise<void> {
    const definition = this.#definitions.get(
      fromBinary(SubscriptionSchema, wire.bytes).id?.value ?? "",
    );
    if (definition === undefined) return;
    definition.updates = updates;
    definition.active = true;
    const abort = () => {
      for (const controller of definition.starts) controller.abort();
      for (const child of definition.children.values()) child.controller.abort();
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    try {
      await this.#schedule([...this.#nodes.values()], false);
      if (!signal.aborted)
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }

  async #startChild(
    definition: {
      readonly wire: PublicSubscriptionWire;
      readonly maxBackendEnvelopeBytes: number;
      updates: SubscriptionUpdateSink | undefined;
      readonly active: boolean;
      readonly starts: Set<AbortController>;
      children: Map<string, SubscriptionChild>;
      failure: Error | undefined;
    },
    id: string,
    current: {
      readonly client: DynamicUnaryClient;
      readonly incarnation: number;
    },
    generation: number,
  ): Promise<void> {
    if (generation !== this.#generation || this.#closed) return;
    const controller = new AbortController();
    definition.starts.add(controller);
    let backend: BackendSubscriptionEnvelope;
    try {
      backend = await current.client.subscribe(
        { kind: "public-subscription", bytes: definition.wire.bytes.slice() },
        controller.signal,
      );
    } finally {
      definition.starts.delete(controller);
    }
    if (backend.bytes.byteLength > definition.maxBackendEnvelopeBytes) {
      await this.#cleanupChild(
        { backend, controller, activation: Promise.resolve(), active: false },
        current.client,
      );
      const failure = new Error("backend-envelope-too-large");
      definition.failure = failure;
      throw failure;
    }
    if (
      generation !== this.#generation ||
      this.#clients.get(id)?.incarnation !== current.incarnation ||
      this.#closed
    ) {
      await this.#cleanupChild(
        {
          backend,
          controller,
          activation: Promise.resolve(),
          active: false,
        },
        current.client,
      );
      return;
    }
    const child: SubscriptionChild = {
      backend,
      controller,
      activation: Promise.resolve(),
      active: false,
    };
    definition.children.set(id, child);
    if (definition.active && definition.updates !== undefined)
      this.#activateChild(definition, id, child, current.client);
  }

  #activateChild(
    definition: {
      readonly wire: PublicSubscriptionWire;
      readonly updates: SubscriptionUpdateSink | undefined;
      readonly children: Map<string, SubscriptionChild>;
    },
    id: string,
    child: SubscriptionChild,
    client: DynamicUnaryClient,
  ): void {
    if (child.active || definition.updates === undefined) return;
    child.active = true;
    child.activation = client
      .activate({ wire: definition.wire, updates: definition.updates }, child.controller.signal)
      .catch(() => undefined)
      .then(() => this.#completeChild(definition, id, child));
  }

  async #completeChild(
    definition: { children: Map<string, SubscriptionChild> },
    id: string,
    child: SubscriptionChild,
  ): Promise<void> {
    if (definition.children.get(id) !== child || child.controller.signal.aborted) return;
    definition.children.delete(id);
  }

  async #removeNodeChildren(id: string, client: DynamicUnaryClient): Promise<void> {
    for (const definition of this.#definitions.values()) {
      const child = definition.children.get(id);
      if (child === undefined) continue;
      definition.children.delete(id);
      await this.#cleanupChild(child, client);
    }
  }

  async #removeDefinitionChildren(definition: {
    readonly children: Map<string, SubscriptionChild>;
  }): Promise<void> {
    await Promise.all(
      [...definition.children].map(async ([id, child]) => {
        definition.children.delete(id);
        await this.#cleanupChild(child, this.#clients.get(id)?.client);
      }),
    );
  }

  async #cleanupChild(
    child: SubscriptionChild,
    client: DynamicUnaryClient | undefined,
  ): Promise<void> {
    child.controller.abort();
    const cleanupClient = client;
    if (cleanupClient !== undefined) {
      try {
        await cleanupClient.dispose(child.backend, new AbortController().signal);
      } catch {
        this.#failedChildCleanup.add({ client: cleanupClient, backend: child.backend });
      }
    }
    await child.activation.catch(() => undefined);
  }

  async #retryChildCleanup(): Promise<void> {
    for (const pending of [...this.#failedChildCleanup])
      try {
        await pending.client.dispose(pending.backend, new AbortController().signal);
        this.#failedChildCleanup.delete(pending);
      } catch {
        // A later membership reconciliation retries this cleanup.
      }
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
        incarnation: ++this.#nextIncarnation,
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
    for (const definition of this.#definitions.values())
      for (const controller of definition.starts) controller.abort();
    await this.#running;
    for (const [id, current] of this.#clients) await this.#removeNodeChildren(id, current.client);
    await Promise.all([...this.#clients.values()].map(({ client }) => this.#dispose(client)));
    this.#clients.clear();
    await this.#retryDisposals();
    await this.#retryChildCleanup();
    if (this.#failedDisposals.size > 0)
      throw new Error("Gateway dynamic client cleanup remains incomplete.");
    if (this.#failedChildCleanup.size > 0)
      throw new Error("Gateway dynamic subscription cleanup remains incomplete.");
  }
}
