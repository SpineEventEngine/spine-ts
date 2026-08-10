import type { ILogLayer } from "loglayer";

/**
 * Records a contained GCE renewal warning without changing registrar outcomes.
 *
 * @param logger Receives the contained record when supplied.
 */
export function emitGceRegistrarRenewalWarning(logger: ILogLayer | undefined): void {
  if (logger === undefined) return;
  try {
    const record = logger.withMetadata({
      operation: "deployment.gce.registrar.renew",
      reasonCode: "failed",
    });
    const emit: (value: string) => unknown = record.warn.bind(record);
    const emitted = emit("deployment.gce.registrar.renew_failed");
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
