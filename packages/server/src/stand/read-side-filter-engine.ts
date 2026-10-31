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

import {
  fromBinary,
  toBinary,
  type DescField,
  type Message,
  type MessageShape,
} from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import type { TypeRegistryLookup } from "@spine-event-engine/core";
import { ReadSideMessages } from "./read-side-message.js";
import type { ReadSideContext, ReadSideField, ReadSideFilter } from "./read-side-filter.js";

type DomainSchema = GenMessage<Message>;
type DomainFilter = ReadSideFilter<DomainSchema>;
type DomainValue = Message | null;
type Put = (value: DomainValue) => void;
type ParentFor = (schema: DomainSchema) => Message | undefined;

interface Visit {
  readonly kind: "visit";
  readonly schema: DomainSchema;
  readonly value: Message;
  readonly context: ReadSideContext;
  readonly root: boolean;
  readonly put: Put;
}

interface Finish {
  readonly kind: "finish";
  readonly commit: () => void;
}

type Work = Visit | Finish;

/**
 * Applies one ordered filter scope to detached domain message trees.
 */
export class ReadSideFilterEngine {
  readonly #registry: TypeRegistryLookup;

  readonly #filters = new Map<string, DomainFilter[]>();

  readonly #nested: boolean;

  /**
   * Resolves each policy through the ordinary registry's exact registered URL.
   *
   * @param filters Policies in registration order.
   * @param registry Application's existing Proto type registry.
   */
  constructor(filters: readonly DomainFilter[], registry: TypeRegistryLookup) {
    this.#registry = registry;
    this.#nested = filters.some((filter) => filter.nested);
    for (const filter of filters) {
      const metadata = registry.findBySchema(filter.schema);
      if (metadata === undefined)
        throw new TypeError(`Read-side filter schema ${filter.schema.typeName} is not registered.`);
      const selected = this.#filters.get(metadata.typeUrl) ?? [];
      selected.push(filter);
      this.#filters.set(metadata.typeUrl, selected);
    }
  }

  /**
   * Returns an isolated filtered view without mutating stored or caller data.
   *
   * @typeParam Schema Generated root domain message schema.
   * @param schema Declared root domain message schema.
   * @param message Domain value returned by the read side.
   * @param context Actual read operation and trusted invocation facts.
   * @returns Filtered same-type message, or null when the root was removed.
   */
  async apply<Schema extends DomainSchema>(
    schema: Schema,
    message: MessageShape<Schema>,
    context: ReadSideContext,
  ): Promise<MessageShape<Schema> | null> {
    if (this.#registry.findBySchema(schema) === undefined)
      throw new TypeError(`Read-side root schema ${schema.typeName} is not registered.`);
    let result: DomainValue = null;
    const stable = this.#context(context);
    const pending: Work[] = [
      {
        kind: "visit",
        schema,
        value: ReadSideMessages.copy(message),
        context: stable,
        root: true,
        put: (value) => {
          result = value;
        },
      },
    ];
    while (pending.length > 0) {
      this.#check(stable.signal);
      const work = pending.pop();
      if (work === undefined) break;
      if (work.kind === "finish") work.commit();
      else await this.#visit(work, pending);
    }
    return result;
  }

  /**
   * Runs this occurrence's policies before scheduling its surviving children.
   *
   * @param work Current domain occurrence.
   * @param pending Iterative traversal stack.
   */
  async #visit(work: Visit, pending: Work[]): Promise<void> {
    let value: DomainValue = work.value;
    ReadSideMessages.checkShallow(work.schema, value);
    const url = this.#registry.findByFullName(work.schema.typeName)?.typeUrl;
    for (const filter of url === undefined ? [] : (this.#filters.get(url) ?? [])) {
      if (!work.root && !filter.nested) continue;
      const candidate = ReadSideMessages.copy(value);
      const next = await filter.filter(candidate, this.#context(work.context));
      this.#check(work.context.signal);
      if (next === null) {
        value = null;
        break;
      }
      value = ReadSideMessages.copy(next);
      ReadSideMessages.checkShallow(work.schema, value);
    }
    work.put(value);
    if (value !== null) this.#children(work.schema, value, work.context, work.put, pending);
  }

  /**
   * Schedules declared message children in field order and deterministic key order.
   *
   * @param schema Parent schema.
   * @param value Surviving parent message.
   * @param context Parent invocation context.
   * @param put Parent update for a removed Any payload.
   * @param pending Iterative traversal stack.
   */
  #children(
    schema: DomainSchema,
    value: Message,
    context: ReadSideContext,
    put: Put,
    pending: Work[],
  ): void {
    const children: Visit[] = [];
    const commits: Finish[] = [];
    let baseline: Message | undefined;
    const parentFor: ParentFor = (childSchema) => {
      const url = this.#registry.findByFullName(childSchema.typeName)?.typeUrl;
      if (url === undefined || !this.#filters.get(url)?.some((filter) => filter.nested))
        return undefined;
      baseline ??= ReadSideMessages.copy(value);
      return baseline;
    };
    if (schema.typeName === AnySchema.typeName && this.#nested)
      this.#packedChild(value as Any, parentFor, context, put, children, commits);
    else
      for (const field of schema.fields) {
        this.#fieldChildren(field, value, parentFor, context, children, commits);
      }
    pending.push(...commits);
    for (let index = children.length - 1; index >= 0; index--) {
      const child = children[index];
      if (child !== undefined) pending.push(child);
    }
  }

  /**
   * Adds the selected message field, list, or map without visiting scalar data.
   *
   * @param field Declared field.
   * @param value Current mutable parent.
   * @param parentFor Captures a parent baseline only for a matching child.
   * @param context Current invocation facts.
   * @param children Ordered child work.
   * @param commits Container updates after child traversal.
   */
  #fieldChildren(
    field: DescField,
    value: Message,
    parentFor: ParentFor,
    context: ReadSideContext,
    children: Visit[],
    commits: Finish[],
  ): void {
    if (field.fieldKind === "message") this.#singular(field, value, parentFor, context, children);
    else if (field.fieldKind === "list" && field.listKind === "message")
      this.#list(field, value, parentFor, context, children, commits);
    else if (field.fieldKind === "map" && field.mapKind === "message")
      this.#map(field, value, parentFor, context, children, commits);
  }

  /**
   * Visits an active singular or oneof message and clears its selection on null.
   *
   * @param field Declared message field.
   * @param value Mutable containing message.
   * @param parentFor Captures a stable parent before siblings are visited.
   * @param context Invocation context.
   * @param children Ordered work.
   */
  #singular(
    field: DescField & { fieldKind: "message" },
    value: Message,
    parentFor: ParentFor,
    context: ReadSideContext,
    children: Visit[],
  ): void {
    const record = value as unknown as Record<string, unknown>;
    const oneof = field.oneof?.localName;
    const selected =
      oneof === undefined
        ? undefined
        : (record[oneof] as { case?: string; value?: unknown } | undefined);
    if (selected !== undefined && selected.case !== field.localName) return;
    const child = oneof === undefined ? record[field.localName] : selected?.value;
    if (child === undefined) return;
    this.#add(
      field.message as DomainSchema,
      child,
      parentFor,
      { name: field.name },
      context,
      (next) => {
        if (oneof !== undefined)
          record[oneof] =
            next === null ? { case: undefined } : { case: field.localName, value: next };
        else if (next === null) record[field.localName] = undefined;
        else record[field.localName] = next;
      },
      children,
    );
  }

  /**
   * Rebuilds a repeated message field after each original element is visited.
   *
   * @param field Declared repeated field.
   * @param value Mutable containing message.
   * @param parentFor Captures a stable parent before siblings are visited.
   * @param context Invocation context.
   * @param children Ordered work.
   * @param commits Deferred stable list update.
   */
  #list(
    field: DescField & { fieldKind: "list" },
    value: Message,
    parentFor: ParentFor,
    context: ReadSideContext,
    children: Visit[],
    commits: Finish[],
  ): void {
    const record = value as unknown as Record<string, unknown>;
    const list = record[field.localName];
    if (!Array.isArray(list)) throw new TypeError(`Invalid repeated field ${field.name}.`);
    const slots: DomainValue[] = (list as Message[]).slice();
    slots.forEach((child, index) => {
      this.#add(
        field.message as DomainSchema,
        child,
        parentFor,
        { name: field.name, index },
        context,
        (next) => {
          slots[index] = next;
        },
        children,
      );
    });
    commits.push({
      kind: "finish",
      commit: () => {
        record[field.localName] = slots.filter((item): item is Message => item !== null);
      },
    });
  }

  /**
   * Visits message map entries in sorted-key order and removes only null values.
   *
   * @param field Declared map field.
   * @param value Mutable containing message.
   * @param parentFor Captures a stable parent before siblings are visited.
   * @param context Invocation context.
   * @param children Ordered work.
   * @param commits Deferred map update.
   */
  #map(
    field: DescField & { fieldKind: "map" },
    value: Message,
    parentFor: ParentFor,
    context: ReadSideContext,
    children: Visit[],
    commits: Finish[],
  ): void {
    const record = value as unknown as Record<string, unknown>;
    const map = record[field.localName];
    if (map === null || typeof map !== "object" || Array.isArray(map))
      throw new TypeError(`Invalid message map ${field.name}.`);
    const slots = new Map(Object.entries(map as Record<string, Message>));
    for (const key of [...slots.keys()].sort())
      this.#add(
        field.message as DomainSchema,
        slots.get(key),
        parentFor,
        { name: field.name, key },
        context,
        (next) => {
          if (next === null) slots.delete(key);
          else slots.set(key, next);
        },
        children,
      );
    commits.push({
      kind: "finish",
      commit: () => {
        record[field.localName] = Object.fromEntries(slots);
      },
    });
  }

  /**
   * Decodes a registered Any for nested inspection and repacks its original URL.
   *
   * @param packed Mutable Any wrapper.
   * @param parentFor Captures the Any wrapper before payload filtering.
   * @param context Invocation context.
   * @param put Containing field update when the payload is removed.
   * @param children Ordered payload work.
   * @param commits Deferred original-URL repack.
   */
  #packedChild(
    packed: Any,
    parentFor: ParentFor,
    context: ReadSideContext,
    put: Put,
    children: Visit[],
    commits: Finish[],
  ): void {
    const metadata = this.#registry.findByTypeUrl(packed.typeUrl);
    if (metadata === undefined)
      throw new TypeError(`Unregistered nested Any URL ${packed.typeUrl}.`);
    const payload = fromBinary(metadata.schema, packed.value);
    let filtered: DomainValue = payload;
    this.#add(
      metadata.schema,
      payload,
      parentFor,
      { name: "value" },
      context,
      (next) => {
        filtered = next;
      },
      children,
    );
    commits.push({
      kind: "finish",
      commit: () => {
        if (filtered === null) put(null);
        else
          (packed as unknown as { value: Uint8Array }).value = toBinary(metadata.schema, filtered);
      },
    });
  }

  /**
   * Adds one typed message child and its detached parent metadata.
   *
   * @param schema Declared child schema.
   * @param value Child field value.
   * @param parentFor Captures a stable parent only for matching nested filters.
   * @param field Containing field and position.
   * @param context Invocation context.
   * @param put Parent or container update.
   * @param children Ordered work.
   */
  #add(
    schema: DomainSchema,
    value: unknown,
    parentFor: ParentFor,
    field: ReadSideField,
    context: ReadSideContext,
    put: Put,
    children: Visit[],
  ): void {
    if (value === null || typeof value !== "object" || !("$typeName" in value))
      throw new TypeError(`Invalid nested message in ${field.name}.`);
    const { parent: previousParent, field: previousField, ...facts } = context;
    void previousParent;
    void previousField;
    const parent = parentFor(schema);
    children.push({
      kind: "visit",
      schema,
      value: value as Message,
      context: Object.freeze({
        ...facts,
        ...(parent === undefined ? {} : { parent }),
        field: Object.freeze(field),
      }),
      root: false,
      put,
    });
  }

  /**
   * Detaches and freezes caller-provided identity and operation facts.
   *
   * @param source Caller read context.
   * @returns Stable per-invocation context.
   */
  #context(source: ReadSideContext): ReadSideContext {
    const { signal, producingContext, ...facts } = source;
    const copied = ReadSideMessages.freeze(ReadSideMessages.copy(facts));
    return Object.freeze({
      ...copied,
      ...(signal === undefined ? {} : { signal }),
      ...(producingContext === undefined ? {} : { producingContext }),
    });
  }

  /**
   * Stops work promptly when the current read has been canceled.
   *
   * @param signal Current cancellation signal.
   */
  #check(signal: AbortSignal | undefined): void {
    if (signal?.aborted) throw new ConnectError("Read canceled.", Code.Canceled);
  }
}
