/** Returns whether a package dependency specifier is an ordinary npm registry reference. */
export function isRegistryDependencySpecifier(specifier: string): boolean {
  if (specifier.startsWith("npm:")) return isNpmAlias(specifier.slice("npm:".length));
  return !specifier.includes(":") && !specifier.includes("/") && isRegistryVersion(specifier);
}

function isNpmAlias(alias: string): boolean {
  const versionIndex = alias.lastIndexOf("@");
  return (
    versionIndex > 0 &&
    isPackageName(alias.slice(0, versionIndex)) &&
    isRegistryVersion(alias.slice(versionIndex + 1))
  );
}

function isPackageName(value: string): boolean {
  return /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(value);
}

function isRegistryVersion(value: string): boolean {
  return /^[a-z][a-z0-9._-]*$/i.test(value) || validRange(value) !== null;
}
import { validRange } from "semver";
