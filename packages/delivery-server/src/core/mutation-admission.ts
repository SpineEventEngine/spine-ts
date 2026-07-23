import { Code, ConnectError } from "@connectrpc/connect";

/** A finite FIFO boundary for all state-changing delivery operations. */
export class MutationAdmission {
  #pending: { readonly admit: () => void; readonly reject: (error: Error) => void }[] = [];
  #scheduled = false;
  #closed = false;

  close(): void {
    this.#closed = true;
    const error = new ConnectError("Delivery server is closed.", Code.Unavailable);
    for (const pending of this.#pending) pending.reject(error);
    this.#pending = [];
  }

  run<T>(signal: AbortSignal | undefined, commit: () => T): Promise<T> {
    if (this.#closed)
      return Promise.reject(new ConnectError("Delivery server is closed.", Code.Unavailable));
    if (signal?.aborted) return Promise.reject(abortError(signal));
    if (this.#pending.length >= 100)
      return Promise.reject(
        new ConnectError("Delivery mutation queue is full.", Code.ResourceExhausted),
      );
    return new Promise<T>((resolve, reject) => {
      const admission = () => {
        if (signal?.aborted) {
          reject(abortError(signal));
          return;
        }
        try {
          resolve(commit());
        } catch (error) {
          reject(error instanceof Error ? error : new Error("Delivery mutation failed."));
        }
      };
      this.#pending.push({ admit: admission, reject });
      if (!this.#scheduled) {
        this.#scheduled = true;
        queueMicrotask(() => {
          this.#flush();
        });
      }
    });
  }

  #flush(): void {
    this.#scheduled = false;
    const pending = this.#pending;
    this.#pending = [];
    for (const admission of pending) admission.admit();
  }
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("Delivery mutation aborted.");
}
