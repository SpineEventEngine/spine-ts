/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { validRange } from "semver";

/**
 * Validates npm registry dependency specifiers used by model packages.
 */
export const RegistryDependency: Readonly<{
  is(specifier: unknown): specifier is string;
  isAlias(alias: string): boolean;
  isPackageName(value: string): boolean;
  isVersion(value: string): boolean;
}> = Object.freeze({
  // prettier-ignore

  /**
   * Returns whether a specifier is an ordinary npm registry reference.
   *
   * @param specifier The dependency specifier to inspect.
   * @returns Whether the specifier is a supported registry reference.
   */
  is(specifier: unknown): specifier is string {
    if (typeof specifier !== "string") return false;
    if (specifier.startsWith("npm:"))
      return RegistryDependency.isAlias(specifier.slice("npm:".length));
    return (
      !specifier.includes(":") &&
      !specifier.includes("/") &&
      RegistryDependency.isVersion(specifier)
    );
  },

  /**
   * Returns whether an npm alias names a registry package and version.
   *
   * @param alias The npm alias value without its `npm:` prefix.
   * @returns Whether the alias is valid.
   */
  isAlias(alias: string): boolean {
    const versionIndex = alias.lastIndexOf("@");
    return (
      versionIndex > 0 &&
      RegistryDependency.isPackageName(alias.slice(0, versionIndex)) &&
      RegistryDependency.isVersion(alias.slice(versionIndex + 1))
    );
  },

  /**
   * Returns whether a value names an npm package.
   *
   * @param value The package-name candidate.
   * @returns Whether the value is valid.
   */
  isPackageName(value: string): boolean {
    return /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(value);
  },

  /**
   * Returns whether a value is a registry tag or semantic-version range.
   *
   * @param value The version-specifier candidate.
   * @returns Whether the value is valid.
   */
  isVersion(value: string): boolean {
    return /^[a-z][a-z0-9._-]*$/i.test(value) || validRange(value) !== null;
  },
});
