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

import { toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";

interface CopyFrame {
  readonly source: object;
  readonly target: object;
  readonly keys: readonly PropertyKey[];
  next: number;
}

/**
 * Detached Proto graph copies and shallow encodability checks.
 */
export const ReadSideMessages = {
  /**
   * Copies a domain graph without recursion and rejects cyclic or executable values.
   *
   * @typeParam Value Input value type retained by the detached copy.
   * @param value Source value to detach.
   * @returns Mutable detached value.
   */
  copy<Value>(value: Value): Value {
    if (value === null || typeof value !== "object") return value;
    const root = ReadSideMessages.shell(value);
    if (value instanceof Uint8Array) return root as Value;
    const seen = new WeakMap<object, object>([[value, root]]);
    const active = new WeakSet<object>([value]);
    const frames: CopyFrame[] = [ReadSideMessages.frame(value, root)];
    while (frames.length > 0) {
      const frame = frames.at(-1);
      if (frame === undefined) break;
      if (frame.next === frame.keys.length) {
        active.delete(frame.source);
        frames.pop();
        continue;
      }
      const key = frame.keys[frame.next++];
      if (key === undefined) throw new TypeError("Invalid read-side copy cursor.");
      ReadSideMessages.copyMember(frame, key, seen, active, frames);
    }
    return root as Value;
  },

  /**
   * Returns a frozen detached parent snapshot without recursively walking its graph.
   *
   * @typeParam Value Detached snapshot type.
   * @param value Detached parent value.
   * @returns The same read-only snapshot.
   */
  freeze<Value>(value: Value): Readonly<Value> {
    const pending: unknown[] = [value];
    const seen = new WeakSet<object>();
    while (pending.length > 0) {
      const next = pending.pop();
      if (next === null || typeof next !== "object" || seen.has(next)) continue;
      seen.add(next);
      if (next instanceof Uint8Array) continue;
      for (const key of Reflect.ownKeys(next)) pending.push(Reflect.get(next, key));
      Object.freeze(next);
    }
    return value;
  },

  /**
   * Encodes one message's own scalar content without recursively encoding children.
   *
   * @param schema Schema of the current message.
   * @param message Message whose scalar fields must be encodable.
   */
  checkShallow(schema: GenMessage<Message>, message: Message): void {
    if (message.$typeName !== schema.typeName)
      throw new TypeError(`Read-side filter returned ${message.$typeName} for ${schema.typeName}.`);
    const shallow = Object.assign(Object.create(null) as Record<string, unknown>, message);
    for (const field of schema.fields) {
      if (field.fieldKind === "message" && field.oneof !== undefined) {
        const selected = shallow[field.oneof.localName] as { case?: string } | undefined;
        if (selected?.case === field.localName)
          shallow[field.oneof.localName] = { case: undefined };
      } else if (field.fieldKind === "message") shallow[field.localName] = undefined;
      else if (field.fieldKind === "list" && field.listKind === "message")
        shallow[field.localName] = [];
      else if (field.fieldKind === "map" && field.mapKind === "message")
        shallow[field.localName] = {};
    }
    toBinary(schema, shallow as Message);
  },

  /**
   * Creates a mutable shell for a Proto object, list, or binary field.
   *
   * @param source Value whose shape determines the shell.
   * @returns Empty mutable copy target.
   */
  shell(source: object): object {
    if (source instanceof Uint8Array) return new Uint8Array(source);
    if (Array.isArray(source)) return new Array<unknown>(source.length);
    const prototype: unknown = Object.getPrototypeOf(source);
    if (prototype !== Object.prototype && prototype !== null)
      throw new TypeError("Read-side message contains an unsupported object value.");
    return Object.create(prototype) as object;
  },

  /**
   * Creates an iterative copy cursor of a plain object or repeated field.
   *
   * @param source Value to inspect.
   * @param target Detached target.
   * @returns Mutable copy cursor.
   */
  frame(source: object, target: object): CopyFrame {
    return {
      source,
      target,
      keys: Reflect.ownKeys(source).filter((key) => key !== "length"),
      next: 0,
    };
  },

  /**
   * Copies one data property and schedules its nested object when necessary.
   *
   * @param frame Current object pair.
   * @param key Source property key.
   * @param seen Previously copied values.
   * @param active Values on the current ancestry path.
   * @param frames Pending copy cursors.
   */
  copyMember(
    frame: CopyFrame,
    key: PropertyKey,
    seen: WeakMap<object, object>,
    active: WeakSet<object>,
    frames: CopyFrame[],
  ): void {
    const descriptor = Object.getOwnPropertyDescriptor(frame.source, key);
    if (descriptor === undefined || !("value" in descriptor))
      throw new TypeError("Read-side message contains an accessor property.");
    const value: unknown = descriptor.value;
    if (typeof value === "function" || typeof value === "symbol")
      throw new TypeError("Read-side message contains an unserializable value.");
    let copied: unknown = value;
    if (value !== null && typeof value === "object") {
      if (active.has(value)) throw new TypeError("Cyclic read-side message.");
      copied = seen.get(value) ?? ReadSideMessages.shell(value);
      if (!seen.has(value)) {
        seen.set(value, copied as object);
        if (!(value instanceof Uint8Array)) {
          active.add(value);
          frames.push(ReadSideMessages.frame(value, copied as object));
        }
      }
    }
    Object.defineProperty(frame.target, key, {
      value: copied,
      enumerable: descriptor.enumerable ?? false,
      writable: true,
      configurable: true,
    });
  },
};
