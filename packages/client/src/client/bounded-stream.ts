/** Private single-consumer bounded async-stream lifecycle. */
export class BoundedStream<Value> {
  readonly controller: AbortController = new AbortController();
  readonly #queue: Value[] = [];
  readonly #listeners: { readonly signal: AbortSignal; readonly onAbort: () => void }[] = [];
  readonly #stopped: Promise<typeof stopped>;
  #stop!: () => void;
  #waiter:
    | {
        readonly resolve: (result: IteratorResult<Value>) => void;
        readonly reject: (error: unknown) => void;
      }
    | undefined;
  #terminal: Readonly<{ readonly error?: Error }> | undefined;
  #iteratorClaimed = false;
  #closed = false;
  #cancelling: Promise<void> | undefined;

  constructor(
    readonly limit: number,
    readonly consumerError: () => Error,
    readonly pendingError: () => Error,
  ) {
    this.#stopped = new Promise((resolve) => {
      this.#stop = () => {
        resolve(stopped);
      };
    });
  }

  get closed(): boolean {
    return this.#closed;
  }
  get terminal(): boolean {
    return this.#terminal !== undefined;
  }

  iterator(): AsyncIterator<Value> {
    if (this.#iteratorClaimed) throw this.consumerError();
    this.#iteratorClaimed = true;
    return { next: () => this.next() };
  }

  next(): Promise<IteratorResult<Value>> {
    const value = this.#queue.shift();
    if (value !== undefined) return Promise.resolve({ done: false, value });
    if (this.#terminal !== undefined) {
      return this.#terminal.error === undefined
        ? Promise.resolve({ done: true, value: undefined })
        : Promise.reject(this.#terminal.error);
    }
    if (this.#waiter !== undefined) return Promise.reject(this.pendingError());
    return new Promise((resolve, reject) => {
      this.#waiter = { resolve, reject };
    });
  }

  push(value: Value): boolean {
    if (this.#closed || this.#terminal !== undefined) return false;
    if (this.#waiter !== undefined) {
      const waiter = this.#waiter;
      this.#waiter = undefined;
      waiter.resolve({ done: false, value });
      return true;
    }
    if (this.#queue.length >= this.limit) return false;
    this.#queue.push(value);
    return true;
  }

  finish(error?: unknown, clear: boolean = error !== undefined): void {
    if (this.#terminal !== undefined) return;
    const failure = error === undefined ? undefined : asError(error);
    if (clear) this.#queue.splice(0);
    this.#terminal = failure === undefined ? Object.freeze({}) : Object.freeze({ error: failure });
    const waiter = this.#waiter;
    this.#waiter = undefined;
    if (waiter === undefined) return;
    if (failure === undefined) waiter.resolve({ done: true, value: undefined });
    else waiter.reject(failure);
  }

  race<Result>(work: Promise<Result>): Promise<Result | typeof stopped> {
    return Promise.race([work, this.#stopped]);
  }

  listen(signal: AbortSignal, onAbort: () => void): void {
    this.#listeners.push({ signal, onAbort });
    signal.addEventListener("abort", onAbort, { once: true });
  }

  removeListeners(): void {
    for (const { signal, onAbort } of this.#listeners.splice(0)) {
      signal.removeEventListener("abort", onAbort);
    }
  }

  cancel(cleanup: () => Promise<void>, clear = true): Promise<void> {
    if (this.#cancelling !== undefined) return this.#cancelling;
    this.#closed = true;
    if (clear) this.#queue.splice(0);
    this.removeListeners();
    this.finish();
    this.#stop();
    this.controller.abort();
    this.#cancelling = cleanup();
    return this.#cancelling;
  }
}

export const stopped: unique symbol = Symbol("bounded stream stopped");

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
