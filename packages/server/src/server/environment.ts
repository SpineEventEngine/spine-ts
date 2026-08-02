/**
 * The Node deployment profile selected for this module graph.
 */
export enum EnvironmentType {
  // prettier-ignore

  /**
   * Selects the local development and test profile.
   */
  Local = "local",

  /**
   * Selects the production deployment profile.
   */
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
  // prettier-ignore

  /**
   * The selected Node deployment profile.
   */
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

  /**
   * Selects an environment for deterministic package tests.
   *
   * @param type Supplies the test environment type.
   * @internal
   */
  static useForTests(type: EnvironmentType): void {
    resolvedEnvironment = new Environment(type);
  }
}

/**
 * Provides deterministic environment controls for package tests.
 *
 * @internal
 */
export const EnvironmentTests: {
  readonly reset: () => void;
  readonly use: (type: EnvironmentType) => void;
} = Object.freeze({
  // prettier-ignore

  /**
   * Restores local environment state before the next singleton lookup.
   */
  reset(): void {
    resetLocalTest();
  },

  /**
   * Selects one environment type before the next singleton lookup.
   *
   * @param type Supplies the test environment type.
   */
  use(type: EnvironmentType): void {
    Environment.useForTests(type);
  },
});
