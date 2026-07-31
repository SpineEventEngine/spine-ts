import { ServerEnvironmentLifecycle } from "../server/server-environment.js";

/**
 * Provides deterministic server-environment cleanup for package tests.
 */
export const ServerTests: { readonly resetEnvironment: () => Promise<void> } = Object.freeze({
  // prettier-ignore

  /**
   * Resets shared server facilities before the next test creates a server.
   */
  resetEnvironment(): Promise<void> {
    return ServerEnvironmentLifecycle.resetForTest();
  },
});

/**
 * Supplies the package-testing reset operation as an explicit short value.
 *
 * @internal
 */
const serverTestReset: () => Promise<void> = ServerTests.resetEnvironment;

export { serverTestReset as resetServerEnvironmentForTest };
