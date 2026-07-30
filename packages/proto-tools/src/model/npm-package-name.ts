/** Registry package names accepted by the model-package contract. */
const npmPackageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

/** Validates npm package names used by the model-package contract. */
export const NpmPackageName: Readonly<{ is(value: unknown): value is string }> = Object.freeze({
  /** Returns whether a value is a scoped or unscoped npm package name.
   *
   * @param value The candidate package name.
   * @returns Whether the value is a valid package name.
   */
  is(value: unknown): value is string {
    return typeof value === "string" && npmPackageName.test(value);
  },
});
