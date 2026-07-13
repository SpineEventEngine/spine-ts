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

      await this.#closeOne(closeable, index, errors);
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, this.#message);
    }
  }

  async #closeOne(closeable: unknown, index: number, errors: unknown[]): Promise<void> {
    try {
      const close = closeMethod(closeable);
      if (close === undefined) {
        this.#closedIndexes.add(index);
        return;
      }
      await close();
      this.#closedIndexes.add(index);
    } catch (error) {
      collectCloseError(error, errors);
    }
  }
}

export function collectCloseError(error: unknown, errors: unknown[]): void {
  collect(error, errors, new Set());
}

function collect(error: unknown, errors: unknown[], ancestors: Set<AggregateError>): void {
  if (error instanceof AggregateError) {
    if (ancestors.has(error)) {
      errors.push(error);
      return;
    }

    ancestors.add(error);
    for (const cause of error.errors as readonly unknown[]) {
      collect(cause, errors, ancestors);
    }
    ancestors.delete(error);
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

  return () => {
    const result: unknown = Reflect.apply(close, closeable, []);
    return result;
  };
}
