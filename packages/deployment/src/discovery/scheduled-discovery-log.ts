import type { ILogLayer } from "loglayer";

/**
 * Contains scheduled discovery logging failures.
 */
export const scheduledDiscoveryLog: Readonly<{
  warn(logger: ILogLayer | undefined): void;
  isPromiseLike(value: unknown): value is PromiseLike<unknown>;
}> = Object.freeze({
  warn(logger: ILogLayer | undefined): void {
    if (logger === undefined) return;
    try {
      const record = logger.withMetadata({
        operation: "deployment.discovery.refresh",
        reasonCode: "failed",
      });
      const emit: (value: string) => unknown = record.warn.bind(record);
      const emitted = emit("deployment.discovery.refresh_failed");
      if (scheduledDiscoveryLog.isPromiseLike(emitted))
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
