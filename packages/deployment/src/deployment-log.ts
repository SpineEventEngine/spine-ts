import type { ILogLayer } from "loglayer";

const operations = new Set(["deployment.discovery.refresh"]);

/**
 * Records a contained deployment warning without changing component outcomes.
 *
 * @param logger Receives the contained record when supplied.
 * @param message Supplies the fixed warning message.
 * @param operation Supplies the allowlisted boundary operation.
 */
export function emitDeploymentWarning(
  logger: ILogLayer | undefined,
  message: string,
  operation: string,
): void {
  if (logger === undefined || !operations.has(operation)) return;
  try {
    const record = logger.withMetadata({ operation, reasonCode: "failed" });
    const emit: (value: string) => unknown = record.warn.bind(record);
    const emitted = emit(message);
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
