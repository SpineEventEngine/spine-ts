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

import { equals, fromBinary } from "@bufbuild/protobuf";
import { reflect, type ReflectMessage } from "@bufbuild/protobuf/reflect";
import { Code, ConnectError } from "@connectrpc/connect";
import { TypeUrls } from "@spine-event-engine/core";
import { OriginSchema, type Event, type Origin } from "@spine-event-engine/proto";
import {
  CompositeFilter_CompositeOperator,
  Filter_Operator,
  type CompositeFilter,
  type Filter,
  type TargetFilters,
} from "@spine-event-engine/proto/client";

/**
 * Compiles the supported JVM-style Event.context.past_message equality filter.
 * @internal
 */
// A static namespace keeps the bounded parser's helpers private and avoids a public instance API.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class EventOriginFilters {
  /**
   * Validates one Event filter tree before remote attachment.
   * @param filters The target filter criteria.
   * @returns A predicate for one domain Event.
   */
  static compile(filters: TargetFilters): (event: Event) => boolean {
    if (filters.idFilter !== undefined || filters.filter.length === 0)
      throw this.#invalid("Event filters require a nonempty field filter without id_filter.");
    const count = { composites: 0, leaves: 0 };
    const predicates = filters.filter.map((filter) => this.#compileComposite(filter, 1, count));
    return (event) => predicates.every((predicate) => predicate(event));
  }

  /**
   * Compiles an ALL/EITHER node while enforcing the existing subscription bounds.
   * @param filter The composite node.
   * @param depth Its depth, starting at one.
   * @param count Shared complexity counters.
   * @returns A predicate for one domain Event.
   */
  static #compileComposite(
    filter: CompositeFilter,
    depth: number,
    count: { composites: number; leaves: number },
  ): (event: Event) => boolean {
    count.composites++;
    if (
      depth > 8 ||
      count.composites > 8 ||
      filter.filter.length + filter.compositeFilter.length === 0
    )
      throw this.#invalid("Event filter tree is empty or exceeds subscription limits.");
    if (
      filter.operator !== CompositeFilter_CompositeOperator.ALL &&
      filter.operator !== CompositeFilter_CompositeOperator.EITHER
    )
      throw this.#invalid("Event filter composite operator is unsupported.");
    const leaves = filter.filter.map((simple) => this.#compileLeaf(simple, count));
    const nested = filter.compositeFilter.map((child) =>
      this.#compileComposite(child, depth + 1, count),
    );
    const predicates = [...leaves, ...nested];
    return filter.operator === CompositeFilter_CompositeOperator.ALL
      ? (event) => predicates.every((predicate) => predicate(event))
      : (event) => predicates.some((predicate) => predicate(event));
  }

  /**
   * Compiles one exact Origin equality comparison.
   * @param filter The simple field filter.
   * @param count Shared complexity counters.
   * @returns A predicate for one domain Event.
   */
  static #compileLeaf(
    filter: Filter,
    count: { composites: number; leaves: number },
  ): (event: Event) => boolean {
    count.leaves++;
    const path = filter.fieldPath?.fieldName ?? [];
    if (
      count.leaves > 16 ||
      path.length !== 2 ||
      path[0] !== "context" ||
      path[1] !== "past_message" ||
      filter.operator !== Filter_Operator.EQUAL
    )
      throw this.#invalid("Event filters support only context.past_message EQUAL Origin.");
    if (filter.value?.typeUrl !== TypeUrls.derive(OriginSchema))
      throw this.#invalid("Event origin filter must pack spine.core.Origin.");
    let expected: Origin;
    try {
      expected = fromBinary(OriginSchema, filter.value.value);
    } catch {
      throw this.#invalid("Event origin filter contains malformed Origin bytes.");
    }
    if (this.#hasUnknown(expected))
      throw this.#invalid("Event origin filter contains unsupported unknown fields.");
    return (event) => {
      const origin = event.context?.origin;
      return (
        origin?.case === "pastMessage" &&
        !this.#hasUnknown(origin.value) &&
        equals(OriginSchema, origin.value, expected)
      );
    };
  }

  /**
   * Detects unknown fields through the known Origin message graph without decoding Any bytes.
   * @param origin The expected or actual Origin.
   * @returns Whether its known nested graph contains unknown fields.
   */
  static #hasUnknown(origin: Origin): boolean {
    const stack: ReflectMessage[] = [reflect(OriginSchema, origin)];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) continue;
      if ((current.getUnknown()?.length ?? 0) > 0) return true;
      for (const field of current.fields) {
        if (field.fieldKind === "message" && current.isSet(field)) stack.push(current.get(field));
      }
    }
    return false;
  }

  /**
   * Formats a failed Event topic validation for SubscriptionService.
   * @param reason The unsupported criterion.
   * @returns An invalid argument error.
   */
  static #invalid(reason: string): ConnectError {
    return new ConnectError(`SubscriptionService.Subscribe ${reason}`, Code.InvalidArgument);
  }
}
