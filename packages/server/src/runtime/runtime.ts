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

import { AsyncLocalStorage } from "node:async_hooks";

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
  // prettier-ignore

  /**
   * Current deterministic lifecycle state.
   */
  readonly state: ServerRuntimeState;

  /**
   * Starts accepting runtime work.
   *
   * Calling `start()` on an already running runtime is a no-op. Calling it while
   * closing or after close rejects with `ServerRuntimeStateError`.
   *
   * @returns A promise that resolves after runtime work admission starts.
   */
  start(): Promise<void>;

  /**
   * Stops accepting new work and waits for already accepted work to settle.
   *
   * Closing is idempotent. The first close call owns the transition to
   * `closed`; later calls return the same close outcome. Calling `close()` from
   * active runtime work rejects with `ServerRuntimeStateError` and state
   * `"running-work"`.
   *
   * @returns A promise that settles after accepted runtime work drains and closes.
   */
  close(): Promise<void>;
}

/**
 * Executes one trusted runtime work item accepted by the single-process queue.
 *
 * The queue provides no timeout, cancellation, fairness, queue bound, or
 * hostile-callback protection; non-settling work can keep `close()` pending.
 * Same-runtime enqueue during active work is rejected to avoid self-deadlock.
 * This is the first server intake boundary, not a durable job, transport
 * message, command, event, dispatch outcome, or repository operation.
 *
 * @returns nothing or a promise fulfilled after the work completes.
 */
export type ServerRuntimeWork = () => void | Promise<void>;

/**
 * Operation rejected by the runtime lifecycle state machine.
 */
export type ServerRuntimeStateOperation = "start" | "enqueue" | "close";

/**
 * Runtime condition that rejected a lifecycle operation.
 */
export type ServerRuntimeRejectedState = ServerRuntimeState | "running-work";

/**
 * Stable machine-readable code for runtime lifecycle state failures.
 */
export type RuntimeStateErrorCode = "INVALID_RUNTIME_STATE";

/**
 * Error raised when a lifecycle operation is not valid in the current state.
 */
export class ServerRuntimeStateError extends Error {
  // prettier-ignore

  /**
   * Stable taxonomy for invalid runtime lifecycle operations.
   */
  readonly code: RuntimeStateErrorCode = "INVALID_RUNTIME_STATE";

  /**
   * Operation that was rejected.
   */
  readonly operation: ServerRuntimeStateOperation;

  /**
   * State that rejected the operation.
   */
  readonly state: ServerRuntimeRejectedState;

  /**
   * Creates an error for a rejected runtime operation.
   *
   * @param operation the rejected operation.
   * @param state the state that rejected it.
   */
  constructor(operation: ServerRuntimeStateOperation, state: ServerRuntimeRejectedState) {
    super(RuntimeValues.formatStateError(operation, state));
    this.name = "ServerRuntimeStateError";
    this.operation = operation;
    this.state = state;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Small server-owned single-process async runtime queue.
 *
 * The runtime has no global singleton and performs no import-time
 * registration. `enqueue()` is an intake boundary: accepted work runs in a
 * later microtask and is processed in FIFO order. Closing prevents new intake
 * and waits for previously accepted work to settle. Enqueued callbacks must be
 * trusted server-owned work; this kernel intentionally does not add timeout,
 * cancellation, fairness, queue bounds, or hostile-callback isolation.
 * Same-runtime reentrant enqueue during active work is rejected to avoid queue
 * self-deadlocks.
 */
export class SingleProcessServerRuntime implements ServerRuntimeLifecycle {
  #state: ServerRuntimeState = "created";
  #tail: Promise<void> = Promise.resolve();
  #closePromise: Promise<void> | undefined;

  /**
   * Creates an idle single-process runtime.
   *
   */
  constructor() {
    followUpEnqueuers.set(this, (work) => this.#enqueueFollowUp(work));
    runtimeDrainers.set(this, () => this.#drain());
  }

  /**
   * Returns the current lifecycle state.
   *
   * @returns the lifecycle state.
   */
  get state(): ServerRuntimeState {
    return this.#state;
  }

  /**
   * Starts accepting runtime work.
   *
   * @returns A promise that resolves after runtime work admission starts.
   */
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
   * Work callbacks are trusted server-owned callbacks only. There is no
   * timeout, cancellation, fairness, queue bound, or protection from hostile or
   * non-settling work; such work can keep `close()` pending. Same-runtime
   * reentrant enqueue during active work is rejected to avoid queue self-deadlocks.
   *
   * @param work the trusted work to enqueue.
   * @returns A promise that settles after the queued work completes.
   */
  enqueue(work: ServerRuntimeWork): Promise<void> {
    return this.#enqueue(work, false);
  }

  #enqueueFollowUp(work: ServerRuntimeWork): Promise<void> {
    return this.#enqueue(work, true);
  }

  #enqueue(work: ServerRuntimeWork, allowRunningWork: boolean): Promise<void> {
    const runningWork = RuntimeValues.isRunningWork(this);
    const acceptsDrainFollowUp = allowRunningWork && runningWork && this.#state === "closing";

    if (this.#state !== "running" && !acceptsDrainFollowUp) {
      throw new ServerRuntimeStateError("enqueue", this.#state);
    }
    if (!allowRunningWork && runningWork) {
      throw new ServerRuntimeStateError("enqueue", "running-work");
    }

    const completion = this.#tail.then(async () => {
      const frame: RuntimeWorkFrame = { runtime: this, active: true };
      try {
        await runtimeWork.run(frame, work);
      } finally {
        frame.active = false;
      }
    });
    this.#tail = completion.catch(() => undefined);
    return completion;
  }

  /**
   * Closes the runtime after accepted work drains.
   *
   * @returns A promise that settles after the runtime closes.
   */
  close(): Promise<void> {
    if (RuntimeValues.isRunningWork(this)) {
      return Promise.reject(new ServerRuntimeStateError("close", "running-work"));
    }

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
    this.#closePromise = this.#drainAndClose();
    return this.#closePromise;
  }

  async #drainAndClose(): Promise<void> {
    await this.#drain();
    this.#state = "closed";
  }

  async #drain(): Promise<void> {
    let observedTail: Promise<void>;

    do {
      observedTail = this.#tail;
      await observedTail;
    } while (this.#tail !== observedTail);
  }
}

interface RuntimeAccess {
  enqueueFollowUp(runtime: SingleProcessServerRuntime, work: ServerRuntimeWork): Promise<void>;
  drain(runtime: SingleProcessServerRuntime): Promise<void>;
}

const followUpEnqueuers = new WeakMap<
  SingleProcessServerRuntime,
  (work: ServerRuntimeWork) => Promise<void>
>();
const runtimeDrainers = new WeakMap<SingleProcessServerRuntime, () => Promise<void>>();

/**
 * Provides package-owned authority for framework follow-up work.
 *
 * @internal
 */
export const runtimeAccess: RuntimeAccess = Object.freeze({
  enqueueFollowUp(runtime: SingleProcessServerRuntime, work: ServerRuntimeWork): Promise<void> {
    const enqueueFollowUp = followUpEnqueuers.get(runtime);

    if (enqueueFollowUp === undefined) {
      throw new TypeError("Runtime follow-up work requires a SingleProcessServerRuntime instance.");
    }

    return enqueueFollowUp(work);
  },

  drain(runtime: SingleProcessServerRuntime): Promise<void> {
    const drain = runtimeDrainers.get(runtime);

    if (drain === undefined) {
      throw new TypeError("Runtime drain requires a SingleProcessServerRuntime instance.");
    }

    return drain();
  },
});

interface RuntimeWorkFrame {
  readonly runtime: SingleProcessServerRuntime;
  active: boolean;
}

const runtimeWork = new AsyncLocalStorage<RuntimeWorkFrame>();

/**
 * Private runtime state and execution helpers.
 */
const RuntimeValues = Object.freeze({
  formatStateError(
    operation: ServerRuntimeStateOperation,
    state: ServerRuntimeRejectedState,
  ): string {
    if (operation === "start") {
      return `Cannot start server runtime while it is ${state}.`;
    }

    if (state === "running-work" && operation === "close") {
      return "Cannot close server runtime from an active runtime work item.";
    }

    if (state === "running-work") {
      return "Cannot enqueue runtime work from an active runtime work item.";
    }

    return `Cannot enqueue runtime work while server runtime is ${state}.`;
  },

  isRunningWork(runtime: SingleProcessServerRuntime): boolean {
    const frame = runtimeWork.getStore();
    return frame?.runtime === runtime && frame.active;
  },
});
