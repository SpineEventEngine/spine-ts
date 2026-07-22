import { resetServerEnvironmentForTest as reset } from "../server/server-environment.js";

/** Dispose the current server environment and restore deterministic local defaults. */
export function resetServerEnvironmentForTest(): Promise<void> {
  return reset();
}
