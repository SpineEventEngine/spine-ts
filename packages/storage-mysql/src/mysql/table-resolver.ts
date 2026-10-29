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

import type { MysqlResolvedTable } from "./table-spec.js";

/**
 * Resolves stable MySQL-safe table names for record families.
 */
export class MysqlTableResolver {
  /**
   * Explicit names keyed by physical record family.
   */
  readonly #names = new Map<string, string>();

  readonly #eventNames = new Map<string, string>();

  /**
   * Table names already resolved for a family.
   */
  readonly #resolved = new Map<string, string>();

  /**
   * Copies configured names for one factory snapshot.
   *
   * @returns An independent resolver with the same registrations.
   */
  copy(): MysqlTableResolver {
    const copy = new MysqlTableResolver();
    for (const [key, value] of this.#names) copy.#names.set(key, value);
    for (const [key, value] of this.#eventNames) copy.#eventNames.set(key, value);
    return copy;
  }

  /**
   * Sets the physical table for one exact Event Store identity.
   *
   * @param identity Context name and store role identity.
   * @param name Requested physical table name.
   */
  setEventStoreName(identity: string, name: string): void {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || Buffer.byteLength(name) > 64)
      throw new Error(`MySQL table name is invalid: ${name}`);
    this.#eventNames.set(identity, name);
  }

  /**
   * Sets the ungrouped table name for a record type.
   *
   * @param recordType Names the record type.
   * @param name Specifies the physical table name.
   */
  setRecordName(recordType: string, name: string): void {
    this.set(`record:${recordType}`, name);
  }

  /**
   * Sets the grouped table name for a source and record type.
   *
   * @param sourceType Names the source type.
   * @param recordType Names the record type.
   * @param name Specifies the physical table name.
   */
  setGroupName(sourceType: string, recordType: string, name: string): void {
    this.set(`group:${sourceType}:${recordType}`, name);
  }

  /**
   * Resolves the table layout for a record family.
   *
   * @param sourceType Names the source type.
   * @param group Names the optional storage group.
   * @param name Supplies an explicit table name.
   * @param recordType Names the grouped record type.
   * @param eventStoreIdentity Distinguishes a domain or system Event Store.
   * @returns Returns the resolved table layout.
   */
  resolve(
    sourceType: string,
    group: string | undefined,
    name?: string,
    recordType?: string,
    eventStoreIdentity?: string,
  ): MysqlResolvedTable {
    const readable = this.requestedName(sourceType, group, name, recordType, eventStoreIdentity);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(readable) || Buffer.byteLength(readable) > 64) {
      throw new Error(`MySQL table name is invalid: ${readable}`);
    }
    const identity =
      eventStoreIdentity ??
      (group !== undefined
        ? `group:${sourceType}:${recordType ?? ""}:${group}`
        : this.#names.get(`record:${sourceType}`) !== undefined
          ? `record:${sourceType}`
          : sourceType);
    const key = readable.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
    const previous = this.#resolved.get(key);
    if (previous !== undefined && previous !== identity)
      throw new Error(`MySQL table name collides: ${readable} (${previous} and ${identity})`);
    this.#resolved.set(key, identity);
    return Object.freeze({
      tableName: readable,
    });
  }

  /**
   * Returns a readable configured or default table name.
   *
   * @param sourceType Record source type.
   * @param group Optional physical group.
   * @param name Explicit name from a record layout.
   * @param recordType Stored record type.
   * @param eventStoreIdentity Exact Event Store context and role.
   * @returns The requested table name before validation.
   */
  private requestedName(
    sourceType: string,
    group: string | undefined,
    name: string | undefined,
    recordType: string | undefined,
    eventStoreIdentity: string | undefined,
  ): string {
    const registered =
      group === undefined
        ? this.#names.get(`record:${sourceType}`)
        : this.#names.get(`group:${sourceType}:${recordType ?? ""}`);
    if (eventStoreIdentity !== undefined) {
      const selected = this.#eventNames.get(eventStoreIdentity);
      if (selected !== undefined) return selected;
    }
    if (name !== undefined) return name;
    if (registered !== undefined) return registered;
    if (eventStoreIdentity !== undefined && group !== undefined)
      return `${group.replace(/[^A-Za-z0-9_]/gu, "_")}_Event`;
    if (group === undefined) return sourceType.replaceAll(".", "_");
    const type = recordType ?? sourceType;
    return `${group.replaceAll(".", "_")}_${type.slice(type.lastIndexOf(".") + 1)}`;
  }

  /**
   * Registers a validated explicit name without aliasing another family.
   *
   * @param identity Physical record-family key.
   * @param name Explicit MySQL table name.
   */
  private set(identity: string, name: string): void {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || Buffer.byteLength(name) > 64)
      throw new Error(`MySQL table name is invalid: ${name}`);
    for (const [registered, value] of this.#names)
      if (registered !== identity && value.toLowerCase() === name.toLowerCase())
        throw new Error(`MySQL table name collides: ${name}`);
    this.#names.set(identity, name);
  }
}
