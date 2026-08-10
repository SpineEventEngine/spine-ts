import type { ILogLayer } from "loglayer";

/** Records a contained GKE discovery warning without changing discovery outcomes. */
export function emitGkeDiscoveryWarning(logger: ILogLayer | undefined): void {
  if (logger === undefined) return;
  try {
    const emitted = logger
      .withMetadata({ operation: "deployment.gke.discovery.refresh" })
      .warn("deployment.gke.discovery.refresh_failed");
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
