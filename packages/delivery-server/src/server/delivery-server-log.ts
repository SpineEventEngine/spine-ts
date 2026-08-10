import type { ILogLayer } from "loglayer";

/**
 * Records a contained delivery-listener error without changing listener failure semantics.
 *
 * @param logger Receives the contained record when supplied.
 */
export const deliveryServerLog = Object.freeze({
  error(logger: ILogLayer | undefined): void {
    if (logger === undefined) return;
    try {
      const record = logger.withMetadata({
        operation: "delivery.listener.start",
        reasonCode: "failed",
      });
      const emit: (value: string) => unknown = record.error.bind(record);
      const emitted = emit("delivery.listener.start_failed");
      if (deliveryServerLog.isPromiseLike(emitted))
        void Promise.resolve(emitted).catch(() => undefined);
    } catch {
      // Logging must not affect the containing runtime outcome.
    }
  },

  isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    return (
      (typeof value === "object" || typeof value === "function") &&
      value !== null &&
      "then" in value &&
      typeof (value as { then?: unknown }).then === "function"
    );
  },
});
