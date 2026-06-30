/**
 * Deterministic lifecycle states for the single-process server runtime kernel.
 *
 * Transitions are:
 *
 * - `created -> running` when `start()` is accepted;
 * - `created -> closed` when `close()` happens before start;
 * - `running -> closing -> closed` when close drains already accepted work;
 * - `closing -> closed` once accepted work settles.
 *
 * `running -> running` through repeated `start()` and `closing|closed -> closed`
 * through repeated `close()` are idempotent no-ops. Starting after close is
 * rejected.
 */
export type ServerRuntimeState = "created" | "running" | "closing" | "closed";

/**
 * Explicit lifecycle contract for server-owned runtime parts.
 */
export interface ServerRuntimeLifecycle {
  /**
   * Current deterministic lifecycle state.
   */
  readonly state: ServerRuntimeState;

  /**
   * Starts accepting runtime work.
   *
   * Calling `start()` on an already running runtime is a no-op. Calling it while
   * closing or after close rejects with `ServerRuntimeStateError`.
   */
  start(): Promise<void>;

  /**
   * Stops accepting new work and waits for already accepted work to settle.
   *
   * Closing is idempotent. The first close call owns the transition to
   * `closed`; later calls return the same close outcome.
   */
  close(): Promise<void>;
}

/**
 * Work accepted by the single-process runtime queue.
 *
 * This is the first server runtime intake boundary only. It is not a durable
 * job, transport message, command, event, dispatch outcome, or repository
 * operation.
 */
export type ServerRuntimeWork = () => void | Promise<void>;

/**
 * Operation rejected by the runtime lifecycle state machine.
 */
export type ServerRuntimeStateOperation = "start" | "enqueue";

/**
 * Error raised when a lifecycle operation is not valid in the current state.
 */
export class ServerRuntimeStateError extends Error {
  /**
   * State that rejected the operation.
   */
  readonly code: ServerRuntimeState;

  /**
   * Operation that was rejected.
   */
  readonly operation: ServerRuntimeStateOperation;

  constructor(operation: ServerRuntimeStateOperation, state: ServerRuntimeState) {
    super(formatStateError(operation, state));
    this.name = "ServerRuntimeStateError";
    this.code = state;
    this.operation = operation;
  }
}

/**
 * Small server-owned single-process async runtime queue.
 *
 * The runtime has no global singleton and performs no import-time
 * registration. `enqueue()` is an intake boundary: accepted work runs in a
 * later microtask and is processed in FIFO order. Closing prevents new intake
 * and waits for previously accepted work to settle.
 */
export class SingleProcessServerRuntime implements ServerRuntimeLifecycle {
  #state: ServerRuntimeState = "created";
  #tail: Promise<void> = Promise.resolve();
  #closePromise: Promise<void> | undefined;

  get state(): ServerRuntimeState {
    return this.#state;
  }

  start(): Promise<void> {
    if (this.#state === "running") {
      return Promise.resolve();
    }
    if (this.#state === "closing" || this.#state === "closed") {
      return Promise.reject(new ServerRuntimeStateError("start", this.#state));
    }
    this.#state = "running";
    return Promise.resolve();
  }

  /**
   * Accepts one unit of server runtime work for later single-process execution.
   *
   * The returned promise represents this work item's completion. A rejected
   * work item rejects only its own promise and does not stop later queued work.
   */
  enqueue(work: ServerRuntimeWork): Promise<void> {
    if (this.#state !== "running") {
      throw new ServerRuntimeStateError("enqueue", this.#state);
    }

    const completion = this.#tail.then(async () => {
      await work();
    });
    this.#tail = completion.catch(() => undefined);
    return completion;
  }

  close(): Promise<void> {
    if (this.#closePromise !== undefined) {
      return this.#closePromise;
    }

    if (this.#state === "closed") {
      this.#closePromise = Promise.resolve();
      return this.#closePromise;
    }

    if (this.#state === "created") {
      this.#state = "closed";
      this.#closePromise = Promise.resolve();
      return this.#closePromise;
    }

    this.#state = "closing";
    this.#closePromise = this.#tail.then(() => {
      this.#state = "closed";
    });
    return this.#closePromise;
  }
}

function formatStateError(
  operation: ServerRuntimeStateOperation,
  state: ServerRuntimeState,
): string {
  if (operation === "start") {
    return `Cannot start server runtime while it is ${state}.`;
  }

  return `Cannot enqueue runtime work while server runtime is ${state}.`;
}
