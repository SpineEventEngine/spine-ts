/**
 * Represents environment values injected into one deployment process.
 */
export type DeploymentEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Reads and validates settings shared by application and Gateway entrypoints.
 */
export const DeploymentSettings = Object.freeze({
  // prettier-ignore

  /**
   * Reads one listener port.
   *
   * @param environment Provides injected process settings.
   * @param name Names the required port setting.
   * @returns The validated TCP port.
   */
  port(environment: DeploymentEnvironment, name: "PORT" | "BACKEND_DISCOVERY_PORT"): number {
    const value = environment[name];
    const port = Number(value);
    if (typeof value !== "string" || !Number.isInteger(port) || port < 1 || port > 65_535)
      throw new Error(`${name} must be an integer from 1 through 65535.`);
    return port;
  },

  /**
   * Reads the Kubernetes Service used to discover application nodes.
   *
   * @param environment Provides injected process settings.
   * @returns The non-empty Service name.
   */
  serviceName(environment: DeploymentEnvironment): string {
    const value = environment.BACKEND_DISCOVERY_SERVICE?.trim();
    if (value === undefined || value.length === 0)
      throw new Error("BACKEND_DISCOVERY_SERVICE must not be blank.");
    return value;
  },
});
