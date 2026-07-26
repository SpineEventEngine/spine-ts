/** Registry package names accepted by the model-package contract. */
const npmPackageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

/** Returns whether the value is a scoped or unscoped npm package name. */
export function isNpmPackageName(value: string): boolean {
  return npmPackageName.test(value);
}
