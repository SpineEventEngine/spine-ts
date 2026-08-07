/**
 * Schedules deterministic registrar renewal work.
 */
export interface GceScheduler {
  /**
   * Schedules one renewal callback.
   *
   * @param delayMs Supplies a positive delay in milliseconds.
   * @param onTick Receives the callback to run once after the delay.
   * @returns Cancels the scheduled callback.
   */
  schedule(delayMs: number, onTick: () => void): () => void;
}

/**
 * Creates one cancellable deadline for cooperative registrar operations.
 */
export interface GceDeadlineFactory {
  /**
   * Creates an operation deadline.
   *
   * @param timeoutMs Supplies a positive timeout in milliseconds.
   * @returns An abort signal and an operation that releases the deadline handle.
   */
  create(timeoutMs: number): { readonly signal: AbortSignal; close(): void };
}

/** The production scheduler uses unreferenced Node.js timer handles. */
export const systemGceScheduler: GceScheduler = {
  schedule: (delayMs, onTick) => {
    const timer = setTimeout(onTick, delayMs);
    timer.unref();
    return () => {
      clearTimeout(timer);
    };
  },
};

/** The production deadline factory uses unreferenced Node.js timer handles. */
export const systemGceDeadlines: GceDeadlineFactory = {
  create(timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    timer.unref();
    return {
      signal: controller.signal,
      close: () => {
        clearTimeout(timer);
      },
    };
  },
};

/**
 * Runs one bounded registry operation and always releases its deadline handle.
 *
 * @param deadlines Supplies the deadline factory.
 * @param timeoutMs Supplies the operation timeout.
 * @param shutdown Supplies the registrar shutdown signal when applicable.
 * @param operation Receives the composed cancellation signal.
 * @returns The operation result.
 */
export async function runGceOperation<Result>(
  deadlines: GceDeadlineFactory,
  timeoutMs: number,
  shutdown: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<Result>,
): Promise<Result> {
  const deadline = deadlines.create(timeoutMs);
  try {
    return await operation(
      shutdown === undefined ? deadline.signal : AbortSignal.any([shutdown, deadline.signal]),
    );
  } finally {
    deadline.close();
  }
}
