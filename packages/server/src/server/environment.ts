/** The Node deployment profile selected for this module graph. */
export enum EnvironmentType {
  /** Selects the local development and test profile. */
  Local = "local",
  /** Selects the production deployment profile. */
  Production = "production",
}

let resolvedEnvironment: Environment | undefined;
let resetLocalTest: (() => void) | undefined;

/**
 * Stable process environment information for the Node runtime.
 *
 * The profile is derived once. Facility configuration remains the responsibility
 * of {@link ServerEnvironment} so callers cannot replace a resolved process
 * environment through individual servers.
 */
export class Environment {
  /** The selected Node deployment profile. */
  readonly type: EnvironmentType;

  private constructor(type: EnvironmentType) {
    this.type = type;
    Object.freeze(this);
  }

  static {
    resetLocalTest = () => {
      resolvedEnvironment = new Environment(EnvironmentType.Local);
    };
  }

  /**
   * Returns this module graph's canonical Node environment.
   *
   * @returns The resolved process environment.
   */
  static instance(): Environment {
    return (resolvedEnvironment ??= new Environment(
      process.env.NODE_ENV === "production" ? EnvironmentType.Production : EnvironmentType.Local,
    ));
  }
}

/** Provides deterministic environment controls for package tests.
 *
 * @internal
 */
export const EnvironmentTests: { readonly reset: () => void } = Object.freeze({
  /** Restores local environment state before the next singleton lookup. */
  reset(): void {
    resetLocalTest();
  },
});
