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
 *
 * @typeParam Request The forwarded unary request.
 * @typeParam Child The native child subscription handle.
 * @typeParam Update The native child update.
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
 * Configures the provider-neutral internal member coordinator.
 *
 * @typeParam Member A discovered backend member.
 * @typeParam Request The forwarded unary request.
 * @typeParam Child The native child subscription handle.
 * @typeParam Update The native child update.
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
   * Checks a child's response-only activation acknowledgement when coordinated readiness is required.
   *
   * @param update One update from a child stream.
   * @returns Whether this update acknowledges that child's attachment.
   */
  readonly isActivationAck?: (update: Update) => boolean;

  /**
   * Transforms a validated child ACK for the logical definition after every required child is ready.
   *
   * @param definition The public logical definition.
   * @param childAck One validated child acknowledgement.
   * @returns The acknowledgement delivered to the public subscriber.
   */
  readonly logicalActivationAck?: (definition: Uint8Array, childAck: Update) => Update;

  /**
   * Limits parallel member and child creation when supplied.
   */
  readonly maxConcurrentStarts?: number;

  /**
   * Rejects child subscription envelopes above this size when supplied.
   */
  readonly maxChildBytes?: number;
}

/**
 * Tracks one child handle and its activation cancellation.
 *
 * @typeParam Child The native child subscription handle.
 */
interface ChildState<Child> {
  readonly child: Child;
  readonly controller: AbortController;
  active: boolean;
  activationController: AbortController | undefined;
  activation: Promise<void>;
}

/**
 * Carries the captured identities for one child relay across its asynchronous completion.
 * @typeParam Request The forwarded unary request.
 * @typeParam Child The native child subscription handle.
 * @typeParam Update The native child update.
 */
interface ChildActivation<Request, Child, Update> {
  readonly state: DefinitionState<Child, Update>;
  readonly key: string;
  readonly child: ChildState<Child>;
  readonly client: BackendMemberClient<Request, Child, Update>;
  readonly controller: AbortController;
  readonly logical: AbortController | undefined;
  readonly lifetime: ActivationLifetime | undefined;
  readonly readiness: ActivationReadiness<Update> | undefined;
}

/**
 * Tracks required child acknowledgements for one logical activation.
 *
 * @typeParam Update The native child update.
 */
interface ActivationReadiness<Update> {
  readonly gate: PromiseWithResolvers<undefined>;
  readonly seen: Set<string>;
  expected: Set<string> | undefined;
  first: Update | undefined;
  emitting: boolean;
  reconciling: boolean;
  settled: boolean;
  failure: Error | undefined;
}

/**
 * Reports a child failure for the full lifetime of one logical activation.
 */
interface ActivationLifetime {
  readonly gate: PromiseWithResolvers<undefined>;
  failure: Error | undefined;
}

/**
 * Retains a logical definition and its installed child handles.
 *
 * @typeParam Child The native child subscription handle.
 * @typeParam Update The native child update.
 */
interface DefinitionState<Child, Update> {
  readonly definition: Uint8Array;
  readonly maxChildBytes: number;
  readonly children: Map<string, ChildState<Child>>;
  readonly starts: Set<AbortController>;
  active: boolean;
  activationController: AbortController | undefined;
  updates: ((update: Update) => Promise<void>) | undefined;
  failure: Error | undefined;
  readiness: ActivationReadiness<Update> | undefined;
  lifetime: ActivationLifetime | undefined;
}

/**
 * Tracks one connected member and its routing eligibility.
 *
 * @typeParam Member A discovered backend member.
 * @typeParam Request The forwarded unary request.
 * @typeParam Child The native child subscription handle.
 * @typeParam Update The native child update.
 */
interface Current<Member, Request, Child, Update> {
  readonly member: Member;
  readonly client: BackendMemberClient<Request, Child, Update>;
  readonly incarnation: number;
  eligible: boolean;
}

/**
 * Retains a child cleanup attempt for bounded retry.
 *
 * @typeParam Request The forwarded unary request.
 * @typeParam Child The native child subscription handle.
 * @typeParam Update The native child update.
 */
interface FailedChildCleanup<Request, Child, Update> {
  readonly client: BackendMemberClient<Request, Child, Update>;
  readonly child: Child;
  running: Promise<void> | undefined;
}
const childCleanupTimeoutMs = 1_000;

/**
 * Manages ephemeral backend membership and its native subscription children.
 * Logical-definition persistence remains with callers.
 *
 * @typeParam Member A discovered backend member.
 * @typeParam Request The forwarded unary request.
 * @typeParam Child The native child subscription handle.
 * @typeParam Update The native child update.
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
      throw new Error("backend membership is unavailable.");
    const required = new Set(this.#nodes.map((member) => this.#options.memberKey(member)));
    const state = this.#retainDefinition(key, definition, maxChildBytes);
    await this.#schedule(this.#nodes, false);
    // Re-evaluate cancellation after reconciliation can yield to close().
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (signal.aborted || this.#isClosed() || !this.#definitions.has(key))
      throw new Error("subscription creation was cancelled");
    if (
      state.failure !== undefined ||
      [...required].some((memberKey) => !state.children.has(memberKey))
    ) {
      await this.#removeDefinition(key, new AbortController().signal);
      throw state.failure ?? new Error("backend membership is unavailable.");
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
    if (this.#closed) throw new Error("backend membership kernel is closed.");
    const key = this.#options.definitionKey(definition);
    if (key === undefined || key.length === 0) throw new Error("subscription ID is required");
    this.#retainDefinition(key, definition, maxChildBytes);
    await this.#schedule(this.#nodes, false);
    const failure = this.#definitions.get(key)?.failure;
    if (failure !== undefined) throw failure;
  }

  /**
   * Retains one logical definition and its child lifecycle state.
   *
   * @param key The logical subscription identifier.
   * @param definition The public subscription definition.
   * @param maxChildBytes The maximum native child envelope size.
   * @returns The retained definition state.
   */
  #retainDefinition(
    key: string,
    definition: Uint8Array,
    maxChildBytes: number,
  ): DefinitionState<Child, Update> {
    let state = this.#definitions.get(key);
    if (state === undefined) {
      state = {
        definition: definition.slice(),
        maxChildBytes,
        children: new Map(),
        starts: new Set(),
        active: false,
        activationController: undefined,
        updates: undefined,
        failure: undefined,
        readiness: undefined,
        lifetime: undefined,
      };
      this.#definitions.set(key, state);
    }
    return state;
  }

  /**
   * Activates a retained logical definition until cancellation or terminal child failure.
   *
   * @param definition Supplies the retained logical definition.
   * @param updates Receives relayed child updates.
   * @param signal Cancels update relay.
   * @returns Normal completion after cancellation; rejects with a current child failure, possibly
   * wrapped with a bounded cleanup failure.
   */
  async activate(
    definition: Uint8Array,
    updates: (update: Update) => Promise<void>,
    signal: AbortSignal,
  ): Promise<void> {
    const key = this.#options.definitionKey(definition);
    const state = key === undefined ? undefined : this.#definitions.get(key);
    if (state === undefined) return;
    if (state.activationController !== undefined)
      throw new Error("subscription activation is already active");
    const controller = new AbortController();
    const { readiness, lifetime } = this.#beginActivation(state, updates, controller);
    const abort = () => {
      this.#abortActivation(state, readiness, controller);
    };
    if (signal.aborted) {
      abort();
      this.#finishActivation(state, controller);
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    try {
      await this.#waitActivation(state, readiness, lifetime, signal, controller);
    } catch (error) {
      await this.#failActivation(definition, readiness, signal, error);
    } finally {
      signal.removeEventListener("abort", abort);
      this.#finishActivation(state, controller);
    }
  }

  /**
   * Captures one logical activation before any child relay starts.
   * @param state The retained logical definition.
   * @param updates Receives relayed child updates.
   * @param controller Cancels this activation.
   * @returns The readiness and terminal-failure gates for this activation.
   */
  #beginActivation(
    state: DefinitionState<Child, Update>,
    updates: (update: Update) => Promise<void>,
    controller: AbortController,
  ): { readiness: ActivationReadiness<Update> | undefined; lifetime: ActivationLifetime } {
    state.activationController = controller;
    state.active = true;
    state.updates = updates;
    const readiness = this.#newReadiness();
    state.readiness = readiness;
    const lifetime = this.#newLifetime();
    state.lifetime = lifetime;
    return { readiness, lifetime };
  }

  /**
   * Clears a logical relay only when its activation generation is still current.
   *
   * @param state The retained definition.
   * @param controller The completed activation controller.
   */
  #finishActivation(state: DefinitionState<Child, Update>, controller: AbortController): void {
    if (state.activationController !== controller) return;
    state.activationController = undefined;
    state.active = false;
    state.updates = undefined;
    state.readiness = undefined;
    state.lifetime = undefined;
  }

  /**
   * Creates the acknowledgement gate for a strict child activation.
   *
   * @returns The gate, or undefined for a generic non-subscription kernel.
   */
  #newReadiness(): ActivationReadiness<Update> | undefined {
    if (this.#options.isActivationAck === undefined) return undefined;
    const readiness: ActivationReadiness<Update> = {
      gate: Promise.withResolvers<undefined>(),
      seen: new Set(),
      expected: undefined,
      first: undefined,
      emitting: false,
      reconciling: false,
      settled: false,
      failure: undefined,
    };
    void readiness.gate.promise.catch(() => undefined);
    return readiness;
  }

  /**
   * Creates an observed terminal signal for one logical activation.
   * @returns The unsettled activation lifetime.
   */
  #newLifetime(): ActivationLifetime {
    const lifetime: ActivationLifetime = {
      gate: Promise.withResolvers<undefined>(),
      failure: undefined,
    };
    void lifetime.gate.promise.catch(() => undefined);
    return lifetime;
  }

  /**
   * Cancels a logical activation and every child attempt.
   *
   * @param state The retained definition.
   * @param readiness Its acknowledgement gate when configured.
   * @param controller The logical activation controller.
   */
  #abortActivation(
    state: DefinitionState<Child, Update>,
    readiness: ActivationReadiness<Update> | undefined,
    controller: AbortController,
  ): void {
    controller.abort();
    if (readiness !== undefined && !readiness.settled) {
      readiness.settled = true;
      readiness.gate.resolve(undefined);
    }
    for (const start of state.starts) start.abort();
    for (const child of state.children.values()) child.activationController?.abort();
  }

  /**
   * Waits for the required child acknowledgements and later cancellation.
   *
   * @param state The retained definition.
   * @param readiness Its acknowledgement gate when configured.
   * @param signal The public stream cancellation signal.
   * @param controller The logical activation controller.
   * @returns Completion after activation cancellation or readiness failure.
   */
  async #waitActivation(
    state: DefinitionState<Child, Update>,
    readiness: ActivationReadiness<Update> | undefined,
    lifetime: ActivationLifetime,
    signal: AbortSignal,
    controller: AbortController,
  ): Promise<void> {
    await Promise.race([
      this.#schedule(this.#nodes, false),
      BackendMembershipKernel.waitForAbort(signal),
      BackendMembershipKernel.waitForAbort(controller.signal),
      lifetime.gate.promise,
    ]);
    this.#throwLifetimeFailure(lifetime);
    if (signal.aborted || controller.signal.aborted) return;
    if (readiness !== undefined)
      await Promise.race([this.#awaitReadiness(state, readiness, signal), lifetime.gate.promise]);
    this.#throwLifetimeFailure(lifetime);
    await Promise.race([
      BackendMembershipKernel.waitForAbort(signal),
      BackendMembershipKernel.waitForAbort(controller.signal),
      lifetime.gate.promise,
    ]);
    this.#throwLifetimeFailure(lifetime);
  }

  /**
   * Preserves a child failure when cancellation and failure settle together.
   * @param lifetime The current logical activation lifetime.
   */
  #throwLifetimeFailure(lifetime: ActivationLifetime): void {
    if (lifetime.failure !== undefined) throw lifetime.failure;
  }

  /**
   * Removes failed strict activation state while preserving the original cause.
   *
   * @param definition The logical subscription definition.
   * @param readiness Its acknowledgement gate when configured.
   * @param signal The public stream cancellation signal.
   * @param error The activation failure.
   */
  async #failActivation(
    definition: Uint8Array,
    readiness: ActivationReadiness<Update> | undefined,
    signal: AbortSignal,
    error: unknown,
  ): Promise<never> {
    // The signal can abort while scheduling or waiting for child readiness.
    if (!signal.aborted) {
      try {
        await this.cancel(definition, new AbortController().signal);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "Child activation cleanup failed.");
      }
    }
    throw error;
  }

  /**
   * Sets the activation's required child snapshot and waits for its single logical ACK.
   *
   * @param state The active logical definition.
   * @param readiness The current activation's child acknowledgements.
   * @param signal The public stream cancellation signal.
   */
  async #awaitReadiness(
    state: DefinitionState<Child, Update>,
    readiness: ActivationReadiness<Update>,
    signal: AbortSignal,
  ): Promise<void> {
    if (state.failure !== undefined) throw state.failure;
    readiness.expected = new Set(this.#nodes.map((member) => this.#options.memberKey(member)));
    if (!readiness.reconciling && [...readiness.expected].some((key) => !state.children.has(key)))
      throw new Error("backend membership is unavailable.");
    this.#emitReady(state, readiness);
    await Promise.race([readiness.gate.promise, BackendMembershipKernel.waitForAbort(signal)]);
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
    if (key === undefined) return;
    if (this.#definitions.has(key)) await this.#removeDefinition(key, signal);
    if (this.#failedChildCleanup.size === 0) return;
    await this.#retryChildCleanup();
    if (this.#failedChildCleanup.size > 0)
      throw new Error("backend child cleanup remains incomplete.");
  }

  /**
   * Returns a unary response from the next available member.
   *
   * @param request Supplies the request to forward.
   * @returns The backend response bytes.
   */
  forward(request: Request): Promise<Uint8Array> {
    const eligible = [...this.#members.values()].filter((member) => member.eligible);
    const member = eligible[this.#next++ % eligible.length];
    return member === undefined
      ? Promise.reject(new Error("backend membership is unavailable."))
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
      for (const state of this.#definitions.values()) {
        if (state.readiness !== undefined && !state.readiness.settled)
          state.readiness.reconciling = true;
        for (const start of state.starts) start.abort();
      }
    if (this.#running === undefined) {
      this.#completion = new Promise((resolve) => {
        this.#complete = resolve;
      });
      this.#running = this.#run();
    }
    return this.#completion;
  }

  async #run(): Promise<void> {
    let finalFailure: unknown;
    while (this.#pending !== undefined && !this.#closed) {
      const pending = this.#pending;
      this.#pending = undefined;
      try {
        await this.#replace(pending.members, pending.generation);
        finalFailure = undefined;
      } catch (error) {
        // spine-log-boundary: deployment.membership_reconciliation
        finalFailure = error;
        /* a later snapshot can recover */
      }
    }
    this.#running = undefined;
    this.#finishReadinessReconcile(finalFailure);
    this.#complete?.();
    this.#complete = undefined;
  }

  /**
   * Releases pending ACK barriers only after the final desired member snapshot is installed.
   *
   * @param failure The final reconciliation failure, when one occurred.
   */
  #finishReadinessReconcile(failure: unknown): void {
    const required = new Set(this.#nodes.map((member) => this.#options.memberKey(member)));
    for (const state of this.#definitions.values()) {
      const readiness = state.readiness;
      if (readiness === undefined || !readiness.reconciling || readiness.settled) continue;
      readiness.reconciling = false;
      if (
        failure !== undefined ||
        state.failure !== undefined ||
        required.size === 0 ||
        [...required].some((key) => !state.children.has(key))
      ) {
        this.#failReadiness(
          readiness,
          failure ?? state.failure ?? new Error("backend membership is unavailable."),
        );
        continue;
      }
      readiness.expected = new Set(required);
      this.#emitReady(state, readiness);
    }
  }

  async #replace(members: readonly Member[], generation: number): Promise<void> {
    if (generation !== this.#generation || this.#closed) return;
    await this.#retryDisposals();
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (generation !== this.#generation || this.#closed) return;
    if (this.#failedChildCleanup.size > 0) await this.#retryChildCleanup();
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (generation !== this.#generation || this.#closed) return;
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
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (generation !== this.#generation || this.#closed) return;
        await this.#dispose(current.client);
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (generation !== this.#generation || this.#closed) return;
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
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (generation !== this.#generation || this.#closed) return;
    if ([...this.#definitions.values()].every((state) => state.failure === undefined))
      for (const key of wanted.keys()) {
        const current = this.#members.get(key);
        if (current !== undefined) current.eligible = true;
      }
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
    else
      this.#members.set(key, { member, client, incarnation: ++this.#incarnation, eligible: false });
  }

  async #syncDefinition(state: DefinitionState<Child, Update>, generation: number): Promise<void> {
    if (state.lifetime?.failure !== undefined) return;
    state.failure = undefined;
    for (const [key, child] of state.children)
      if (!this.#members.has(key)) {
        state.children.delete(key);
        state.readiness?.expected?.delete(key);
        state.readiness?.seen.delete(key);
        if (state.readiness !== undefined) this.#emitReady(state, state.readiness);
        child.controller.abort();
        child.activationController?.abort();
        // spine-log-boundary: deployment.membership_child_completion
        await this.#awaitActivationCompletion(child);
        if (generation !== this.#generation || this.#closed) return;
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
    if (generation !== this.#generation || this.#closed) return;
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
    if (this.#closed || generation !== this.#generation || state.lifetime?.failure !== undefined)
      return;
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
    await this.#installChild(state, key, current, generation, controller, child);
  }

  /**
   * Installs a created child only while its definition and member remain current.
   *
   * @param state The retained logical definition.
   * @param key The backend member identifier.
   * @param current The member that created the child.
   * @param generation The reconciliation generation.
   * @param controller The child creation controller.
   * @param child The created native child.
   * @returns Completion after installation or compensation.
   */
  async #installChild(
    state: DefinitionState<Child, Update>,
    key: string,
    current: Current<Member, Request, Child, Update>,
    generation: number,
    controller: AbortController,
    child: Child,
  ): Promise<void> {
    if (this.#options.childSize(child) > state.maxChildBytes) {
      await this.#compensateChild(current.client, child, controller.signal);
      throw new Error("backend-envelope-too-large");
    }
    if (
      generation !== this.#generation ||
      this.#members.get(key)?.incarnation !== current.incarnation ||
      controller.signal.aborted ||
      this.#definitions.get(this.#options.definitionKey(state.definition) ?? "") !== state ||
      state.lifetime?.failure !== undefined ||
      this.#isClosed()
    ) {
      await this.#compensateChild(current.client, child, controller.signal);
      return;
    }
    const stored = {
      child,
      controller,
      active: false,
      activationController: undefined,
      activation: Promise.resolve(),
    };
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
    if (child.active || state.updates === undefined || state.lifetime?.failure !== undefined)
      return;
    child.active = true;
    const controller = new AbortController();
    child.activationController = controller;
    const readiness = state.readiness;
    const lifetime = state.lifetime;
    if (readiness !== undefined && !readiness.emitting && !readiness.settled)
      readiness.expected?.add(key);
    const logical = state.activationController;
    const sink = state.updates;
    const onUpdate = (update: Update) =>
      this.#relayChild(state, key, readiness, logical, sink, update);
    const activation = { state, key, child, client, controller, logical, lifetime, readiness };
    this.#observeChildActivation(activation, onUpdate);
  }

  /**
   * Observes one captured child relay through failure and completion.
   * @param activation The captured child identity and cancellation state.
   * @param onUpdate Receives child updates for the logical relay.
   */
  #observeChildActivation(
    activation: ChildActivation<Request, Child, Update>,
    onUpdate: (update: Update) => Promise<void>,
  ): void {
    const { child, client, controller } = activation;
    // spine-log-boundary: deployment.membership_child_activation
    child.activation = client
      .activate(child.child, onUpdate, controller.signal)
      .catch((error: unknown) => {
        this.#failChildActivation(activation, error);
      })
      .then(() => {
        this.#finishChildActivation(activation);
      });
  }

  /**
   * Fences the current logical relay when one required child fails or ends.
   * @param activation The captured child identity and cancellation state.
   * @param error The child failure or unexpected stream-end cause.
   */
  #failChildActivation(activation: ChildActivation<Request, Child, Update>, error: unknown): void {
    const { state, key, child, controller, logical, lifetime, readiness } = activation;
    if (
      lifetime === undefined ||
      logical === undefined ||
      lifetime.failure !== undefined ||
      controller.signal.aborted ||
      logical.signal.aborted ||
      this.#closed ||
      state.lifetime !== lifetime ||
      state.activationController !== logical ||
      state.children.get(key) !== child ||
      child.activationController !== controller
    )
      return;
    lifetime.failure =
      error instanceof Error ? error : new Error("Backend child failed.", { cause: error });
    for (const start of state.starts) start.abort();
    for (const current of state.children.values()) current.activationController?.abort();
    lifetime.gate.reject(lifetime.failure);
    if (readiness !== undefined) this.#failReadiness(readiness, error);
  }

  /**
   * Restarts a cancelled child relay or disposes a child whose stream ended.
   *
   * @param activation The captured child identity and cancellation state.
   */
  #finishChildActivation(activation: ChildActivation<Request, Child, Update>): void {
    const { state, key, child, client, controller, lifetime, readiness } = activation;
    if (child.activationController !== controller) return;
    if (!controller.signal.aborted) {
      const failure = new Error("Backend child stream ended unexpectedly.");
      this.#failChildActivation(activation, failure);
    }
    child.activationController = undefined;
    child.active = false;
    if (
      controller.signal.aborted &&
      lifetime?.failure === undefined &&
      state.children.get(key) === child &&
      state.active &&
      state.activationController !== undefined &&
      !state.activationController.signal.aborted &&
      state.updates !== undefined
    ) {
      this.#activateChild(state, key, child, client);
      return;
    }
    this.#dropEndedChild(state, key, child, client, controller, readiness);
  }

  /**
   * Disposes an ended child only while its logical relay still expects updates.
   *
   * @param state The retained logical definition.
   * @param key The backend member identifier.
   * @param child The ended child state.
   * @param client The member client that created the child.
   * @param controller The child activation controller.
   * @param readiness The current logical acknowledgement gate.
   */
  #dropEndedChild(
    state: DefinitionState<Child, Update>,
    key: string,
    child: ChildState<Child>,
    client: BackendMemberClient<Request, Child, Update>,
    controller: AbortController,
    readiness: ActivationReadiness<Update> | undefined,
  ): void {
    if (
      state.children.get(key) !== child ||
      controller.signal.aborted ||
      !state.active ||
      state.activationController === undefined ||
      state.activationController.signal.aborted ||
      readiness?.failure !== undefined
    )
      return;
    state.children.delete(key);
    readiness?.seen.delete(key);
    void this.#disposeEndedChild(client, child.child);
  }

  /**
   * Tracks cleanup of a child whose stream ended independently of logical cancellation.
   *
   * @param client The member client that created the child.
   * @param child The ended child subscription.
   */
  async #disposeEndedChild(
    client: BackendMemberClient<Request, Child, Update>,
    child: Child,
  ): Promise<void> {
    const running = this.#compensateChild(client, child, new AbortController().signal);
    const cleanups = this.#childCleanup.get(client) ?? new Set<Promise<void>>();
    const tracked = running.then(() => undefined);
    cleanups.add(tracked);
    this.#childCleanup.set(client, cleanups);
    try {
      await tracked;
    } finally {
      cleanups.delete(tracked);
      if (cleanups.size === 0) this.#childCleanup.delete(client);
    }
  }

  /**
   * Consumes one child's ACK locally and gates its business updates behind logical readiness.
   *
   * @param state The retained logical definition.
   * @param key The child member key.
   * @param readiness The readiness state captured when this child started.
   * @param logical The logical activation controller captured when this child started.
   * @param sink The original logical update sink captured when this child started.
   * @param update The child update to inspect or forward.
   */
  async #relayChild(
    state: DefinitionState<Child, Update>,
    key: string,
    readiness: ActivationReadiness<Update> | undefined,
    logical: AbortController | undefined,
    sink: (update: Update) => Promise<void>,
    update: Update,
  ): Promise<void> {
    if (logical === undefined || !this.#relayIsCurrent(state, logical)) return;
    if (readiness === undefined) {
      await sink(update);
      return;
    }
    if (state.readiness !== readiness || state.activationController !== logical) return;
    const isAck = this.#options.isActivationAck?.(update) ?? false;
    if (!readiness.seen.has(key)) {
      if (!isAck) throw new Error("Backend child activation ACK is missing or invalid.");
      readiness.seen.add(key);
      readiness.first ??= update;
      this.#emitReady(state, readiness);
      return;
    }
    if (isAck) throw new Error("Backend child sent a duplicate activation ACK.");
    await readiness.gate.promise;
    if (state.readiness === readiness && this.#relayIsCurrent(state, logical))
      await state.updates?.(update);
  }

  /**
   * Checks generation, cancellation, and terminal failure before a child update.
   * @param state The retained logical definition.
   * @param logical The child relay's captured activation controller.
   * @returns Whether the captured activation still accepts updates.
   */
  #relayIsCurrent(state: DefinitionState<Child, Update>, logical: AbortController): boolean {
    return (
      state.activationController === logical &&
      !logical.signal.aborted &&
      state.lifetime?.failure === undefined
    );
  }

  /**
   * Forwards exactly one logical ACK after every required child has acknowledged attachment.
   *
   * @param state The retained logical definition.
   * @param readiness The current activation's child acknowledgement state.
   */
  #emitReady(state: DefinitionState<Child, Update>, readiness: ActivationReadiness<Update>): void {
    if (
      readiness.reconciling ||
      readiness.emitting ||
      readiness.settled ||
      readiness.expected === undefined ||
      readiness.expected.size === 0 ||
      ![...readiness.expected].every((key) => readiness.seen.has(key))
    )
      return;
    const update = readiness.first;
    const sink = state.updates;
    if (update === undefined || sink === undefined) {
      this.#failReadiness(readiness, new Error("Backend child activation ACK is unavailable."));
      return;
    }
    readiness.emitting = true;
    let logicalAck: Update;
    try {
      logicalAck = this.#options.logicalActivationAck?.(state.definition, update) ?? update;
    } catch (error) {
      this.#failReadiness(readiness, error);
      return;
    }
    void sink(logicalAck).then(
      () => {
        if (readiness.settled) return;
        readiness.settled = true;
        readiness.gate.resolve(undefined);
      },
      (error: unknown) => {
        this.#failReadiness(readiness, error);
      },
    );
  }

  /**
   * Rejects pending readiness once while retaining the original child or sink failure.
   *
   * @param readiness The current activation's child acknowledgement state.
   * @param error The failing child or update-sink cause.
   */
  #failReadiness(readiness: ActivationReadiness<Update>, error: unknown): void {
    if (readiness.settled) return;
    readiness.settled = true;
    readiness.failure =
      error instanceof Error
        ? error
        : new Error("Backend child activation failed.", { cause: error });
    readiness.gate.reject(readiness.failure);
  }

  async #removeDefinition(key: string, signal: AbortSignal): Promise<void> {
    const state = this.#definitions.get(key);
    if (state === undefined) return;
    this.#definitions.delete(key);
    state.activationController?.abort();
    for (const start of state.starts) start.abort();
    for (const child of state.children.values()) child.activationController?.abort();
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
      state.readiness?.expected?.delete(key);
      state.readiness?.seen.delete(key);
      if (state.readiness !== undefined) this.#emitReady(state, state.readiness);
      try {
        await this.#cleanupChild(child, client);
      } catch (error) {
        // spine-log-boundary: deployment.membership_child_cleanup_retained
        void error;
      }
    }
  }

  async #cleanupChild(
    child: ChildState<Child>,
    client: BackendMemberClient<Request, Child, Update> | undefined,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<void> {
    child.controller.abort();
    child.activationController?.abort();
    const cleanup = async (): Promise<void> => {
      if (client !== undefined && !(await this.#compensateChild(client, child.child, signal)))
        throw new Error("backend child cleanup remains incomplete.");
      // spine-log-boundary: deployment.membership_child_cleanup
      await this.#awaitActivationCompletion(child);
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

  async #compensateChild(
    client: BackendMemberClient<Request, Child, Update>,
    child: Child,
    signal: AbortSignal,
  ): Promise<boolean> {
    const pending = this.#retainFailedChildCleanup(client, child);
    if (!(await this.#disposeChild(pending, signal))) return false;
    this.#failedChildCleanup.delete(pending);
    return true;
  }

  async #awaitActivationCompletion(child: ChildState<Child>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, childCleanupTimeoutMs);
      timer.unref();
    });
    try {
      await Promise.race([child.activation, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async #retryChildCleanup(): Promise<void> {
    for (const pending of [...this.#failedChildCleanup])
      if (await this.#disposeChild(pending, new AbortController().signal))
        this.#failedChildCleanup.delete(pending);
      else continue;
  }

  async #disposeChild(
    pending: FailedChildCleanup<Request, Child, Update>,
    signal: AbortSignal,
  ): Promise<boolean> {
    const controller = new AbortController();
    const abort = (): void => {
      controller.abort();
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    try {
      await this.#awaitChildDisposal(pending, controller);
      return true;
    } catch {
      controller.abort();
      return false;
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }

  /**
   * Races one shared child disposal against its existing bounded wait.
   *
   * @param pending The retained child disposal attempt.
   * @param controller Cancels the entered disposal when its wait fails.
   * @returns Completion when the child disposal settles within its limit.
   */
  async #awaitChildDisposal(
    pending: FailedChildCleanup<Request, Child, Update>,
    controller: AbortController,
  ): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error("backend child cleanup timed out"));
      }, childCleanupTimeoutMs);
      timer.unref();
    });
    try {
      const running = pending.running ?? pending.client.dispose(pending.child, controller.signal);
      if (pending.running === undefined) {
        pending.running = running;
        const settled = () => {
          if (pending.running === running) pending.running = undefined;
        };
        // spine-log-boundary: deployment.membership_child_cleanup_retry
        void running.then(settled, settled);
      }
      await Promise.race([running, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  #retainFailedChildCleanup(
    client: BackendMemberClient<Request, Child, Update>,
    child: Child,
  ): FailedChildCleanup<Request, Child, Update> {
    const existing = [...this.#failedChildCleanup].find(
      (pending) => pending.client === client && pending.child === child,
    );
    if (existing !== undefined) return existing;
    const pending = { client, child, running: undefined };
    this.#failedChildCleanup.add(pending);
    return pending;
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
    await Promise.allSettled(
      [...this.#definitions.keys()].map((key) =>
        this.#removeDefinition(key, new AbortController().signal),
      ),
    );
    await Promise.allSettled([...this.#childCleanup.values()].flatMap((pending) => [...pending]));
    await this.#retryChildCleanup();
    await Promise.all([...this.#members.values()].map(({ client }) => this.#dispose(client)));
    this.#members.clear();
    await this.#retryDisposals();
    if (this.#failedDisposals.size > 0)
      throw new Error("backend client cleanup remains incomplete.");
    if (this.#failedChildCleanup.size > 0)
      throw new Error("backend child cleanup remains incomplete.");
  }
}
