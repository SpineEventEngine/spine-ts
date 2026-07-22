/** The Node deployment profile selected for this module graph. */
export enum EnvironmentType {
  Local = "local",
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

  /** Return this module graph's canonical Node environment. */
  static instance(): Environment {
    return (resolvedEnvironment ??= new Environment(
      process.env.NODE_ENV === "production" ? EnvironmentType.Production : EnvironmentType.Local,
    ));
  }
}

/** @internal Restore the deterministic local environment lifecycle used by package tests. */
export function resetEnvironmentForTest(): void {
  resetLocalTest?.();
}
