/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

/**
 * Performs backend operations for one member managed by the internal kernel.
 */
export interface BackendMemberClient<Request, Child, Update> {
  // prettier-ignore

  /**
   * Returns one unary response from the member.
   *
   * @param request Supplies the request to forward.
   * @returns The backend response bytes.
   */
  forward(request: Request): Promise<Uint8Array>;

  /**
   * Creates the member's child subscription for one logical definition.
   *
   * @param definition Supplies the member-specific subscription definition.
   * @param signal Cancels child creation.
   * @returns The created child subscription.
   */
  subscribe(definition: Uint8Array, signal: AbortSignal): Promise<Child>;

  /**
   * Delivers updates from an active child subscription.
   *
   * @param child Supplies the child subscription to activate.
   * @param updates Receives relayed child updates.
   * @param signal Cancels update relay.
   * @returns Completion of the child activation.
   */
  activate(
    child: Child,
    updates: (update: Update) => Promise<void>,
    signal: AbortSignal,
  ): Promise<void>;

  /**
   * Removes one child subscription.
   *
   * @param child Supplies the child to dispose.
   * @param signal Cancels disposal when supported.
   * @returns Completion of disposal.
   */
  dispose(child: Child, signal: AbortSignal): Promise<void>;

  /**
   * Closes this member connection.
   *
   * @returns Completion of member cleanup.
   */
  close(): Promise<void>;
}

/**
 * Configures the provider-neutral internal member owner.
 */
export interface BackendMembershipKernelOptions<Member, Request, Child, Update> {
  // prettier-ignore

  /**
   * Connects to one discovered member.
   *
   * @param member Supplies the discovered member.
   * @param signal Cancels connection creation.
   * @returns The connected member client.
   */
  readonly create: (
    member: Member,
    signal: AbortSignal,
  ) => Promise<BackendMemberClient<Request, Child, Update>>;

  /**
   * Returns the stable identity of a discovered member.
   *
   * @param member Supplies the member to identify.
   * @returns The stable member identity.
   */
  readonly memberKey: (member: Member) => string;

  /**
   * Returns whether two snapshots describe the same member endpoint.
   *
   * @param left Supplies one member snapshot.
   * @param right Supplies the other member snapshot.
   * @returns Whether both snapshots represent the same endpoint.
   */
  readonly sameMember: (left: Member, right: Member) => boolean;

  /**
   * Returns the logical identity from one retained definition.
   *
   * @param definition Supplies the logical subscription definition.
   * @returns Its logical identity, when available.
   */
  readonly definitionKey: (definition: Uint8Array) => string | undefined;

  /**
   * Returns a logical definition rewritten for a specific child member.
   *
   * @param definition Supplies the logical subscription definition.
   * @param member Supplies the child member.
   * @returns The rewritten child definition.
   */
  readonly childDefinition: (definition: Uint8Array, member: Member) => Uint8Array;

  /**
   * Returns a created child subscription envelope size in bytes.
   *
   * @param child Supplies the child subscription.
   * @returns The child envelope byte size.
   */
  readonly childSize: (child: Child) => number;

  /**
   * Limits parallel member and child creation when supplied.
   */
  readonly maxConcurrentStarts?: number;

  /**
   * Rejects child subscription envelopes above this size when supplied.
   */
  readonly maxChildBytes?: number;
}

interface ChildState<Child> {
  readonly child: Child;
  readonly controller: AbortController;
  active: boolean;
  activation: Promise<void>;
}
interface DefinitionState<Child, Update> {
  readonly definition: Uint8Array;
  readonly maxChildBytes: number;
  readonly children: Map<string, ChildState<Child>>;
  readonly starts: Set<AbortController>;
  active: boolean;
  updates: ((update: Update) => Promise<void>) | undefined;
  failure: Error | undefined;
}
interface Current<Member, Request, Child, Update> {
  readonly member: Member;
  readonly client: BackendMemberClient<Request, Child, Update>;
  readonly incarnation: number;
}
interface FailedChildCleanup<Request, Child, Update> {
  readonly client: BackendMemberClient<Request, Child, Update>;
  readonly child: Child;
}

/**
 * Manages ephemeral backend membership and its native subscription children.
 * Logical-definition persistence intentionally remains with callers.
 */
export class BackendMembershipKernel<Member, Request, Child, Update> {
  readonly #options: BackendMembershipKernelOptions<Member, Request, Child, Update>;
  readonly #limit: number;
  readonly #maxChildBytes: number;
  #members = new Map<string, Current<Member, Request, Child, Update>>();
  #definitions = new Map<string, DefinitionState<Child, Update>>();
  #nodes: readonly Member[] = [];
  #generation = 0;
  #incarnation = 0;
  #next = 0;
  #closed = false;
  #running: Promise<void> | undefined;
  #pending: { readonly members: readonly Member[]; readonly generation: number } | undefined;
  #completion = Promise.resolve();
  #complete: (() => void) | undefined;
  readonly #creating = new Set<AbortController>();
  readonly #childStarts = new Set<AbortController>();
  readonly #failedDisposals = new Set<BackendMemberClient<Request, Child, Update>>();
  readonly #failedChildCleanup = new Set<FailedChildCleanup<Request, Child, Update>>();
  readonly #childCleanup = new Map<
    BackendMemberClient<Request, Child, Update>,
    Set<Promise<void>>
  >();
  #closing: Promise<void> | undefined;

  /**
   * Creates a kernel with bounded member and child creation.
   *
   * @param options Configures member creation and child subscription handling.
   */
  constructor(options: BackendMembershipKernelOptions<Member, Request, Child, Update>) {
    if (
      options.maxConcurrentStarts !== undefined &&
      (!Number.isSafeInteger(options.maxConcurrentStarts) || options.maxConcurrentStarts < 1)
    )
      throw new RangeError("maxConcurrentStarts must be a positive safe integer.");
    if (
      options.maxChildBytes !== undefined &&
      (!Number.isSafeInteger(options.maxChildBytes) || options.maxChildBytes < 1)
    )
      throw new RangeError("maxChildBytes must be a positive safe integer.");
    this.#options = options;
    this.#limit = options.maxConcurrentStarts ?? 8;
    this.#maxChildBytes = options.maxChildBytes ?? 1_048_576;
  }

  /**
   * Updates the live member set from a complete discovery snapshot.
   *
   * @param members Supplies the complete member snapshot.
   * @returns Completion of member reconciliation.
   */
  reconcile(members: readonly Member[]): Promise<void> {
    return this.#schedule(members, true);
  }

  /**
   * Creates children for one retained logical subscription definition.
   *
   * @param definition Supplies the logical subscription definition.
   * @param signal Cancels subscription creation.
   * @param maxChildBytes Limits each child envelope size.
   * @returns Completion of child creation.
   */
  async subscribe(
    definition: Uint8Array,
    signal: AbortSignal,
    maxChildBytes: number = this.#maxChildBytes,
  ): Promise<void> {
    if (!Number.isSafeInteger(maxChildBytes) || maxChildBytes < 1)
      throw new RangeError("maxChildBytes must be a positive safe integer.");
    const key = this.#options.definitionKey(definition);
    if (key === undefined || key.length === 0) throw new Error("subscription ID is required");
    if (signal.aborted || this.#closed || this.#nodes.length === 0)
      throw new Error("Gateway backend is absent.");
    if (!this.#definitions.has(key))
      this.#definitions.set(key, {
        definition: definition.slice(),
        maxChildBytes,
        children: new Map(),
        starts: new Set(),
        active: false,
        updates: undefined,
        failure: undefined,
      });
    const state = this.#definitions.get(key);
    if (state === undefined) throw new Error("subscription creation was cancelled");
    await this.#schedule(this.#nodes, false);
    // Re-evaluate cancellation after reconciliation can yield to close().
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (signal.aborted || this.#isClosed() || !this.#definitions.has(key))
      throw new Error("subscription creation was cancelled");
    if (state.failure !== undefined || state.children.size !== this.#members.size) {
      await this.#removeDefinition(key, new AbortController().signal);
      throw state.failure ?? new Error("Gateway backend is absent.");
    }
  }

  /**
   * Updates live children for one previously retained logical definition.
   *
   * @param definition Supplies the retained logical definition.
   * @param maxChildBytes Limits each child envelope size.
   * @returns Completion of child recreation.
   */
  async rehydrate(
    definition: Uint8Array,
    maxChildBytes: number = this.#maxChildBytes,
  ): Promise<void> {
    if (!Number.isSafeInteger(maxChildBytes) || maxChildBytes < 1)
      throw new RangeError("maxChildBytes must be a positive safe integer.");
    if (this.#closed) throw new Error("Gateway dynamic owner is closed.");
    const key = this.#options.definitionKey(definition);
    if (key === undefined || key.length === 0) throw new Error("subscription ID is required");
    if (!this.#definitions.has(key))
      this.#definitions.set(key, {
        definition: definition.slice(),
        maxChildBytes,
        children: new Map(),
        starts: new Set(),
        active: false,
        updates: undefined,
        failure: undefined,
      });
    await this.#schedule(this.#nodes, false);
    const failure = this.#definitions.get(key)?.failure;
    if (failure !== undefined) throw failure;
  }

  /**
   * Creates update relay for a retained logical definition until cancellation.
   *
   * @param definition Supplies the retained logical definition.
   * @param updates Receives relayed child updates.
   * @param signal Cancels update relay.
   * @returns Completion after cancellation.
   */
  async activate(
    definition: Uint8Array,
    updates: (update: Update) => Promise<void>,
    signal: AbortSignal,
  ): Promise<void> {
    const key = this.#options.definitionKey(definition);
    const state = key === undefined ? undefined : this.#definitions.get(key);
    if (state === undefined) return;
    state.active = true;
    state.updates = updates;
    const abort = () => {
      for (const start of state.starts) start.abort();
      for (const child of state.children.values()) child.controller.abort();
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    try {
      await this.#schedule(this.#nodes, false);
      await BackendMembershipKernel.waitForAbort(signal);
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }

  /**
   * Clears one logical definition and its live child subscriptions.
   *
   * @param definition Supplies the logical definition to remove.
   * @param signal Cancels child cleanup when supported.
   * @returns Completion of child cleanup.
   */
  async cancel(definition: Uint8Array, signal: AbortSignal): Promise<void> {
    const key = this.#options.definitionKey(definition);
    if (key !== undefined) await this.#removeDefinition(key, signal);
  }

  /**
   * Returns a unary response from the next available member.
   *
   * @param request Supplies the request to forward.
   * @returns The backend response bytes.
   */
  forward(request: Request): Promise<Uint8Array> {
    const member = [...this.#members.values()][this.#next++ % this.#members.size];
    return member === undefined
      ? Promise.reject(new Error("Gateway backend is absent."))
      : member.client.forward(request);
  }

  /**
   * Clears live work and closes every member connection.
   *
   * @returns Completion of member cleanup.
   */
  async close(): Promise<void> {
    this.#closing ??= this.#closeOnce().catch((error: unknown) => {
      this.#closing = undefined;
      throw error;
    });
    return this.#closing;
  }

  /**
   * Resolves when an abort signal is observed.
   *
   * @param signal Supplies the signal to observe.
   * @returns Completion after the signal aborts.
   */
  static waitForAbort(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      signal.addEventListener(
        "abort",
        () => {
          resolve();
        },
        { once: true },
      );
      if (signal.aborted) resolve();
    });
  }

  #schedule(members: readonly Member[], abortStarts: boolean): Promise<void> {
    this.#nodes = [...members];
    this.#pending = { members: this.#nodes, generation: ++this.#generation };
    if (abortStarts)
      for (const state of this.#definitions.values())
        for (const start of state.starts) start.abort();
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
      const pending = this.#pending;
      this.#pending = undefined;
      try {
        await this.#replace(pending.members, pending.generation);
      } catch (error) {
        // spine-log-boundary: auth.dynamic_reconciliation
        void error;
        /* a later snapshot can recover */
      }
    }
    this.#running = undefined;
    this.#complete?.();
    this.#complete = undefined;
  }
  async #replace(members: readonly Member[], generation: number): Promise<void> {
    if (generation !== this.#generation || this.#closed) return;
    await this.#retryDisposals();
    if (this.#failedChildCleanup.size > 0) await this.#retryChildCleanup();
    const wanted = new Map<string, Member>();
    for (const member of members) {
      const key = this.#options.memberKey(member);
      const previous = wanted.get(key);
      if (previous !== undefined && !this.#options.sameMember(previous, member))
        throw new Error("Application node IDs must not identify conflicting endpoints.");
      wanted.set(key, member);
    }
    for (const [key, current] of this.#members)
      if (
        !this.#options.sameMember(current.member, wanted.get(key) ?? current.member) ||
        !wanted.has(key)
      ) {
        this.#members.delete(key);
        if (this.#definitions.size > 0) await this.#removeMemberChildren(key, current.client);
        await this.#dispose(current.client);
      }
    const added = [...wanted.entries()].filter(([key]) => !this.#members.has(key));
    for (let index = 0; index < added.length; index += this.#limit)
      await Promise.allSettled(
        added
          .slice(index, index + this.#limit)
          .map(([key, member]) => this.#start(key, member, generation)),
      );
    if (generation !== this.#generation) return;
    for (const state of this.#definitions.values()) await this.#syncDefinition(state, generation);
    this.#next = 0;
  }
  async #start(key: string, member: Member, generation: number): Promise<void> {
    const controller = new AbortController();
    this.#creating.add(controller);
    let client: BackendMemberClient<Request, Child, Update>;
    try {
      client = await this.#options.create(member, controller.signal);
    } finally {
      this.#creating.delete(controller);
    }
    if (this.#closed || generation !== this.#generation) await this.#dispose(client);
    else this.#members.set(key, { member, client, incarnation: ++this.#incarnation });
  }
  async #syncDefinition(state: DefinitionState<Child, Update>, generation: number): Promise<void> {
    for (const [key, child] of state.children)
      if (!this.#members.has(key)) {
        state.children.delete(key);
        child.controller.abort();
        // spine-log-boundary: deployment.membership_child_completion
        await child.activation.catch(() => undefined);
      }
    const missing = [...this.#members.entries()].filter(([key]) => !state.children.has(key));
    for (let index = 0; index < missing.length; index += this.#limit)
      for (const result of await Promise.allSettled(
        missing
          .slice(index, index + this.#limit)
          .map(([key, current]) => this.#startChild(state, key, current, generation)),
      ))
        if (result.status === "rejected" && state.failure === undefined)
          state.failure =
            result.reason instanceof Error
              ? result.reason
              : new Error("native subscription creation failed");
    if (state.active && state.updates !== undefined)
      for (const [key, child] of state.children) {
        const current = this.#members.get(key);
        if (current !== undefined) this.#activateChild(state, key, child, current.client);
      }
  }
  async #startChild(
    state: DefinitionState<Child, Update>,
    key: string,
    current: Current<Member, Request, Child, Update>,
    generation: number,
  ): Promise<void> {
    if (this.#closed || generation !== this.#generation) return;
    const controller = new AbortController();
    state.starts.add(controller);
    this.#childStarts.add(controller);
    let child: Child;
    try {
      child = await current.client.subscribe(
        this.#options.childDefinition(state.definition, current.member),
        controller.signal,
      );
    } finally {
      state.starts.delete(controller);
      this.#childStarts.delete(controller);
    }
    if (this.#options.childSize(child) > state.maxChildBytes) {
      await current.client.dispose(child, controller.signal);
      throw new Error("backend-envelope-too-large");
    }
    if (
      generation !== this.#generation ||
      this.#members.get(key)?.incarnation !== current.incarnation ||
      this.#isClosed()
    ) {
      await current.client.dispose(child, controller.signal);
      return;
    }
    const stored = { child, controller, active: false, activation: Promise.resolve() };
    state.children.set(key, stored);
    if (state.active && state.updates !== undefined)
      this.#activateChild(state, key, stored, current.client);
  }
  #activateChild(
    state: DefinitionState<Child, Update>,
    key: string,
    child: ChildState<Child>,
    client: BackendMemberClient<Request, Child, Update>,
  ): void {
    if (child.active || state.updates === undefined) return;
    child.active = true;
    // spine-log-boundary: auth.dynamic_subscription_activation
    child.activation = client
      .activate(child.child, state.updates, child.controller.signal)
      .catch(() => undefined)
      .then(() => {
        if (state.children.get(key) === child && !child.controller.signal.aborted)
          state.children.delete(key);
      });
  }
  async #removeDefinition(key: string, signal: AbortSignal): Promise<void> {
    const state = this.#definitions.get(key);
    if (state === undefined) return;
    this.#definitions.delete(key);
    for (const start of state.starts) start.abort();
    await Promise.all(
      [...state.children.entries()].map(async ([memberKey, child]) => {
        state.children.delete(memberKey);
        await this.#cleanupChild(child, this.#members.get(memberKey)?.client, signal);
      }),
    );
  }
  async #removeMemberChildren(
    key: string,
    client: BackendMemberClient<Request, Child, Update>,
  ): Promise<void> {
    for (const state of this.#definitions.values()) {
      const child = state.children.get(key);
      if (child === undefined) continue;
      state.children.delete(key);
      await this.#cleanupChild(child, client);
    }
  }
  async #cleanupChild(
    child: ChildState<Child>,
    client: BackendMemberClient<Request, Child, Update> | undefined,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<void> {
    child.controller.abort();
    const cleanup = async (): Promise<void> => {
      if (client !== undefined)
        try {
          await client.dispose(child.child, signal);
        } catch {
          this.#failedChildCleanup.add({ client, child: child.child });
        }
      // spine-log-boundary: auth.dynamic_subscription_cleanup
      await child.activation.catch(() => undefined);
    };
    if (client === undefined) {
      await cleanup();
      return;
    }
    const running = cleanup();
    const cleanups = this.#childCleanup.get(client) ?? new Set<Promise<void>>();
    cleanups.add(running);
    this.#childCleanup.set(client, cleanups);
    try {
      await running;
    } finally {
      cleanups.delete(running);
      if (cleanups.size === 0) this.#childCleanup.delete(client);
    }
  }
  async #retryChildCleanup(): Promise<void> {
    for (const pending of [...this.#failedChildCleanup])
      try {
        await pending.client.dispose(pending.child, new AbortController().signal);
        this.#failedChildCleanup.delete(pending);
      } catch (error) {
        // spine-log-boundary: auth.dynamic_cleanup_retry
        void error;
        /* later reconciliation retries */
      }
  }
  async #dispose(client: BackendMemberClient<Request, Child, Update>): Promise<void> {
    try {
      const pending = this.#childCleanup.get(client);
      if (pending !== undefined) await Promise.allSettled(pending);
      await client.close();
      this.#failedDisposals.delete(client);
    } catch {
      this.#failedDisposals.add(client);
    }
  }
  async #retryDisposals(): Promise<void> {
    for (const client of this.#failedDisposals) await this.#dispose(client);
  }
  #isClosed(): boolean {
    return this.#closed;
  }
  async #closeOnce(): Promise<void> {
    this.#closed = true;
    for (const controller of this.#creating) controller.abort();
    for (const start of this.#childStarts) start.abort();
    for (const state of this.#definitions.values()) for (const start of state.starts) start.abort();
    await this.#running;
    for (const key of [...this.#definitions.keys()])
      await this.#removeDefinition(key, new AbortController().signal);
    await Promise.all([...this.#members.values()].map(({ client }) => this.#dispose(client)));
    this.#members.clear();
    await this.#retryDisposals();
    await this.#retryChildCleanup();
    if (this.#failedDisposals.size > 0)
      throw new Error("backend client cleanup remains incomplete.");
    if (this.#failedChildCleanup.size > 0)
      throw new Error("backend child cleanup remains incomplete.");
  }
}
