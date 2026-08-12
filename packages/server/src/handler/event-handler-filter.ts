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
import type { DescField, DescMessage } from "@bufbuild/protobuf";
import { StringifierRegistry, type Stringifier } from "@spine-event-engine/core";
import type { DescriptorMessageSchema } from "../entity/entity-metadata.js";
import type { WhereOptions } from "./handler-metadata.js";

/**
 * Internal handler candidate consumed by Event field filter compilation.
 */
export interface EventHandlerFilterCandidate<Value> {
  // prettier-ignore

  /**
   * Registered handler value returned when the candidate is selected.
   */
  readonly value: Value;

  /**
   * Event schema used to resolve the declared source-name path.
   */
  readonly schema: DescriptorMessageSchema;

  /**
   * Optional generated Event field filter.
   */
  readonly where?: WhereOptions;
}

/**
 * Immutable, construction-time validated selector for one Event receptor category.
 */
export interface EventHandlerFilterPlan<Value> {
  // prettier-ignore

  /**
   * Returns the matching filtered value, fallback, or ordinary handlers.
   *
   * @param message Unpacked Event message validated by repository intake.
   * @returns Frozen selected values in declaration order.
   */
  select(message: unknown): readonly Value[];
}

interface ResolvedPath {
  readonly fields: readonly DescField[];
  readonly stringifier: Stringifier<unknown>;
}

interface FilteredCandidate<Value> {
  readonly value: Value;
  readonly canonical: string;
}

interface EventHandlerFilterCompiler {
  compile<Value>(
    candidates: readonly EventHandlerFilterCandidate<Value>[],
    stringifiers?: StringifierRegistry,
  ): EventHandlerFilterPlan<Value>;
}

/**
 * Compiles generated `@Where` metadata and selects one receptor at runtime.
 *
 * @internal
 */
export const EventHandlerFilters: Readonly<EventHandlerFilterCompiler> = Object.freeze({
  compile<Value>(
    candidates: readonly EventHandlerFilterCandidate<Value>[],
    stringifiers: StringifierRegistry = new StringifierRegistry(),
  ): EventHandlerFilterPlan<Value> {
    const [first] = candidates;
    if (first === undefined) return EmptyFilterPlan;
    const schema = first.schema;
    const fallbacks = candidates.filter(({ where }) => where === undefined);
    const filtered = candidates.filter(
      (
        candidate,
      ): candidate is EventHandlerFilterCandidate<Value> & { readonly where: WhereOptions } =>
        candidate.where !== undefined,
    );
    const [firstFiltered] = filtered;
    if (firstFiltered === undefined) {
      return Object.freeze({
        select: () => Object.freeze(fallbacks.map(({ value }) => value)),
      });
    }
    if (fallbacks.length > 1) {
      throw new Error("Event handler filtering has more than one unfiltered fallback.");
    }
    const path = firstFiltered.where.eventField;
    if (filtered.some(({ where }) => where.eventField !== path)) {
      throw new Error("Event handler filters for one receptor must use the same Event field path.");
    }
    if (candidates.some((candidate) => candidate.schema.typeName !== schema.typeName)) {
      throw new Error("Event handler filtering candidates must consume the same Event type.");
    }
    const resolved = FilterPaths.resolve(schema, path, new StringifierRegistry(stringifiers));
    const values = new Map<string, FilteredCandidate<Value>>();
    for (const candidate of filtered) {
      const parsed = resolved.stringifier.fromString(candidate.where.equals);
      const canonical = resolved.stringifier.toString(parsed);
      if (values.has(canonical)) {
        throw new Error(
          `Event handler filtering has duplicate canonical value ${JSON.stringify(canonical)}.`,
        );
      }
      values.set(canonical, Object.freeze({ value: candidate.value, canonical }));
    }
    const fallback = fallbacks[0]?.value;
    return Object.freeze({
      select(message: unknown): readonly Value[] {
        const actual = FilterPaths.read(message, resolved.fields);
        if (actual.present) {
          const canonical = resolved.stringifier.toString(actual.value);
          const match = values.get(canonical);
          if (match !== undefined) return Object.freeze([match.value]);
        }
        return Object.freeze(fallback === undefined ? [] : [fallback]);
      },
    });
  },
});

const EmptyFilterPlan: EventHandlerFilterPlan<never> = Object.freeze({
  select: () => Object.freeze([]),
});

const FilterPaths = Object.freeze({
  resolve(schema: DescMessage, path: string, stringifiers: StringifierRegistry): ResolvedPath {
    const names = path.split(".");
    if (names.some((name) => name.length === 0)) {
      throw new Error(`Event handler filter path ${JSON.stringify(path)} is malformed.`);
    }
    const fields: DescField[] = [];
    let message = schema;
    names.forEach((name, index) => {
      const field = message.fields.find((candidate) => candidate.name === name);
      if (field === undefined) {
        throw new Error(
          `Event handler filter path ${JSON.stringify(path)} has unknown field ${JSON.stringify(name)}.`,
        );
      }
      if (field.fieldKind === "list" || field.fieldKind === "map") {
        throw new Error(
          `Event handler filter path ${JSON.stringify(path)} has an unsupported repeated or map field.`,
        );
      }
      fields.push(field);
      if (index < names.length - 1) {
        if (field.fieldKind !== "message") {
          throw new Error(
            `Event handler filter path ${JSON.stringify(path)} intermediate field must be a message.`,
          );
        }
        message = field.message;
      }
    });
    const terminal = fields.at(-1);
    if (terminal === undefined) {
      throw new Error("Event handler filter path must not be empty.");
    }
    return Object.freeze({
      fields: Object.freeze(fields),
      stringifier: stringifiers.forField(terminal),
    });
  },

  read(
    message: unknown,
    fields: readonly DescField[],
  ): { readonly present: boolean; readonly value?: unknown } {
    let current: unknown = message;
    for (const field of fields) {
      if (typeof current !== "object" || current === null) return { present: false };
      const record = current as Record<string, unknown>;
      const value =
        field.oneof === undefined
          ? record[field.localName]
          : FilterPaths.oneofValue(record, field.oneof.localName, field.localName);
      if (value === undefined) return { present: false };
      current = value;
    }
    return { present: true, value: current };
  },

  oneofValue(record: Record<string, unknown>, oneofName: string, fieldName: string): unknown {
    const oneof = record[oneofName];
    if (typeof oneof !== "object" || oneof === null) return undefined;
    const value = oneof as { readonly case?: unknown; readonly value?: unknown };
    return value.case === fieldName ? value.value : undefined;
  },
});
