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
 * Names a distinct physical group for records with the same source and record types.
 */
export class StorageGroup {
  readonly #name: string;

  /**
   * Creates a named record-storage group.
   * @param name The non-blank provider-visible group name.
   */
  constructor(name: string) {
    if (name.trim().length === 0) {
      throw new Error("Storage group name must not be blank.");
    }
    this.#name = name;
  }

  /**
   * Returns the group name.
   * @returns The provider-visible group name.
   */
  get name(): string {
    return this.#name;
  }
}
