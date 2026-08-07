/**
 * Represents environment values injected into one GCE deployment process.
 */
export type DeploymentEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Reads the small set of deployment settings shared by GCE process entrypoints.
 */
export const GceDeploymentSettings = Object.freeze({
  // prettier-ignore

  /**
   * Reads one listener port.
   *
   * @param environment Provides injected process settings.
   * @param name Names the required listener port setting.
   * @returns The validated TCP port.
   */
  port(environment: DeploymentEnvironment, name: "PORT"): number {
    const value = environment[name];
    const port = Number(value);
    if (typeof value !== "string" || !Number.isInteger(port) || port < 1 || port > 65_535)
      throw new Error(`${name} must be an integer from 1 through 65535.`);
    return port;
  },

  /**
   * Reads the shared node-registry namespace.
   *
   * @param environment Provides injected process settings.
   * @returns The non-empty registry namespace.
   */
  registryNamespace(environment: DeploymentEnvironment): string {
    const value = environment.REGISTRY_NAMESPACE?.trim();
    if (value === undefined || value.length === 0)
      throw new Error("REGISTRY_NAMESPACE must not be blank.");
    return value;
  },
});
