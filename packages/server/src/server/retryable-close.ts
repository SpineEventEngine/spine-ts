/** Retryable close group shared by server lifecycle owners. */
export class RetryableCloseGroup {
  readonly #closeables: readonly unknown[];
  readonly #message: string;
  readonly #closedIndexes = new Set<number>();

  constructor(closeables: readonly unknown[], message: string) {
    this.#closeables = closeables;
    this.#message = message;
  }

  async close(): Promise<void> {
    const errors: unknown[] = [];

    for (const [index, closeable] of this.#closeables.entries()) {
      if (this.#closedIndexes.has(index)) {
        continue;
      }

      const close = closeMethod(closeable);
      if (close === undefined) {
        this.#closedIndexes.add(index);
        continue;
      }

      await this.#closeOne(close, index, errors);
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, this.#message);
    }
  }

  async #closeOne(close: () => unknown, index: number, errors: unknown[]): Promise<void> {
    try {
      await close();
      this.#closedIndexes.add(index);
    } catch (error) {
      collectCloseError(error, errors);
    }
  }
}

export function collectCloseError(error: unknown, errors: unknown[]): void {
  if (error instanceof AggregateError) {
    const causes = error.errors as readonly unknown[];
    for (const cause of causes) {
      errors.push(cause);
    }
    return;
  }
  errors.push(error);
}

function closeMethod(closeable: unknown): (() => unknown) | undefined {
  if (typeof closeable !== "object" || closeable === null) {
    return undefined;
  }

  const close: unknown = Reflect.get(closeable, "close");
  if (typeof close !== "function") {
    return undefined;
  }

  return () => close.call(closeable);
}
