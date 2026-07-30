/** Owns ordered close operations and retains failed operations for a later retry. */
export class RetryableCloseGroup {
  readonly #closeables: readonly unknown[];
  readonly #message: string;
  readonly #closedIndexes = new Set<number>();

  /**
   * Creates a retryable close sequence.
   *
   * @param closeables - Supplies resources to close in order.
   * @param message - Describes a combined close failure.
   */
  constructor(closeables: readonly unknown[], message: string) {
    this.#closeables = closeables;
    this.#message = message;
  }

  /** Closes each remaining resource and aggregates any failures.
   * @returns A promise that settles after each remaining resource is attempted.
   */
  async close(): Promise<void> {
    const errors: unknown[] = [];

    for (const [index, closeable] of this.#closeables.entries()) {
      if (this.#closedIndexes.has(index)) {
        continue;
      }

      await this.#closeOne(closeable, index, errors);
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, this.#message);
    }
  }

  async #closeOne(closeable: unknown, index: number, errors: unknown[]): Promise<void> {
    try {
      const close = RetryableCloseValues.closeMethod(closeable);
      if (close === undefined) {
        this.#closedIndexes.add(index);
        return;
      }
      await close();
      this.#closedIndexes.add(index);
    } catch (error) {
      CloseErrors.collect(error, errors);
    }
  }
}

/**
 * Collects nested close failures without losing deterministic order.
 *
 * @internal
 */
export const CloseErrors: { readonly collect: (error: unknown, errors: unknown[]) => void } =
  Object.freeze({
    /**
     * Appends leaf close failures in stable aggregate order.
     *
     * @param error - Supplies a direct or aggregate close failure.
     * @param errors - Receives flattened leaf failures.
     */
    collect(error: unknown, errors: unknown[]): void {
      const ancestors = new Set<AggregateError>();
      const work: AggregateTraversalFrame[] = [{ type: "visit", error }];

      while (work.length > 0) {
        const frame = work.pop();
        if (frame === undefined) {
          continue;
        }

        if (frame.type === "leave") {
          ancestors.delete(frame.aggregate);
          continue;
        }

        if (!(frame.error instanceof AggregateError)) {
          errors.push(frame.error);
          continue;
        }

        if (ancestors.has(frame.error)) {
          errors.push(frame.error);
          continue;
        }

        ancestors.add(frame.error);
        const causes = [...(frame.error.errors as Iterable<unknown>)];
        if (causes.length === 0) {
          ancestors.delete(frame.error);
          errors.push(frame.error);
          continue;
        }
        work.push({ type: "leave", aggregate: frame.error });
        for (let index = causes.length - 1; index >= 0; index -= 1) {
          work.push({ type: "visit", error: causes[index] });
        }
      }
    },
  });

type AggregateTraversalFrame =
  | { readonly type: "visit"; readonly error: unknown }
  | { readonly type: "leave"; readonly aggregate: AggregateError };

/** @internal Groups private close-operation reflection used by retryable shutdown. */
const RetryableCloseValues = Object.freeze({
  closeMethod(closeable: unknown): (() => unknown) | undefined {
    if (typeof closeable !== "object" || closeable === null) {
      return undefined;
    }

    const close: unknown = Reflect.get(closeable, "close");
    if (typeof close !== "function") {
      return undefined;
    }

    return () => {
      const result: unknown = Reflect.apply(close, closeable, []);
      return result;
    };
  },
});
