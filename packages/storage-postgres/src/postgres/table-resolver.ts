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
 * Resolves PostgreSQL physical names for record families.
 */
export class PostgresTableResolver {
  readonly #names = new Map<string, string>();
  readonly #resolved = new Map<string, string>();

  /**
   * Sets an ungrouped record-family table name.
   *
   * @param recordType Names the record type.
   * @param name Specifies the requested physical table name.
   */
  setRecordName(recordType: string, name: string): void {
    this.set(`record:${recordType}`, name);
  }

  /**
   * Resolves one record-family physical name.
   *
   * @param sourceType Names the record source type.
   * @param group Names the optional storage group.
   * @param name Supplies an explicit physical name.
   * @param recordType Names the grouped record type.
   * @returns The validated PostgreSQL table identity.
   */
  resolve(
    sourceType: string,
    group: string | undefined,
    name?: string,
    recordType?: string,
  ): { readonly tableName: string } {
    const identity =
      group === undefined
        ? sourceType
        : `${sourceType}\u0000${recordType ?? sourceType}\u0000${group}`;
    const readable =
      name ??
      this.#names.get(`record:${sourceType}`) ??
      PostgresNames.default(sourceType, group, recordType);
    const tableName = PostgresNames.physical(readable);
    const previous = this.#resolved.get(tableName);
    if (previous !== undefined && previous !== identity)
      throw new Error(`PostgreSQL table name collides: ${tableName}`);
    this.#resolved.set(tableName, identity);
    return Object.freeze({ tableName });
  }

  private set(identity: string, name: string): void {
    const physical = PostgresNames.physical(name);
    for (const [registered, value] of this.#names) {
      if (registered !== identity && PostgresNames.physical(value) === physical) {
        throw new Error(`PostgreSQL table name collides: ${physical}`);
      }
    }
    this.#names.set(identity, name);
  }
}

const PostgresNames = Object.freeze({
  default(sourceType: string, group: string | undefined, recordType: string | undefined): string {
    if (group === undefined) return sourceType.replaceAll(".", "_");
    const type = recordType ?? sourceType;
    return `${group.replaceAll(".", "_")}_${type.slice(type.lastIndexOf(".") + 1)}`;
  },

  physical(name: string): string {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name) || Buffer.byteLength(name) > 63) {
      throw new Error(`PostgreSQL table name is invalid: ${name}`);
    }
    return name.toLowerCase();
  },
});
