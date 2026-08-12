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

/**
 * Registry package names accepted by the model-package contract.
 */
const npmPackageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

/**
 * Validates npm package names used by the model-package contract.
 */
export const NpmPackageName: Readonly<{ is(value: unknown): value is string }> = Object.freeze({
  // prettier-ignore

  /**
   * Returns whether a value is a scoped or unscoped npm package name.
   *
   * @param value The candidate package name.
   * @returns Whether the value is a valid package name.
   */
  is(value: unknown): value is string {
    return typeof value === "string" && npmPackageName.test(value);
  },
});
