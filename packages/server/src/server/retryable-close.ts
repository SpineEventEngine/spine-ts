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
    work.push({ type: "leave", aggregate: frame.error });
    const causes = [...(frame.error.errors as Iterable<unknown>)];
    for (let index = causes.length - 1; index >= 0; index -= 1) {
      work.push({ type: "visit", error: causes[index] });
    }
  }
}

type AggregateTraversalFrame =
  | { readonly type: "visit"; readonly error: unknown }
  | { readonly type: "leave"; readonly aggregate: AggregateError };

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
