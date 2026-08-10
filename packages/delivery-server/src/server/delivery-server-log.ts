import type { ILogLayer } from "loglayer";

/** Records a contained delivery-listener error without changing listener failure semantics. */
export function emitDeliveryServerError(logger: ILogLayer | undefined): void {
  if (logger === undefined) return;
  try {
    const emitted = logger.withMetadata({ operation: "delivery.listener.start" }).error(
      "delivery.listener.start_failed",
    );
    if (isPromiseLike(emitted)) void Promise.resolve(emitted).catch(() => undefined);
  } catch {
    // Logging must not affect the containing runtime outcome.
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  );
}
