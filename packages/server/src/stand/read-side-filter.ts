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

import type { Message, MessageShape } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import type { ActorContext, TenantId } from "@spine-event-engine/proto";
import type { AppQuery, Query, Subscription, Topic } from "@spine-event-engine/proto/client";
import type { TrustedReaderContext } from "@spine-event-engine/core/spi/trusted-reader";
import type { BoundedContext } from "../context/bounded-context.js";

type ReadonlyBytes = Readonly<Pick<Uint8Array, "length" | "at" | "slice"> & Record<number, number>>;

/**
 * Exposes nested Proto data for inspection without writable fields or byte mutators.
 *
 * @typeParam Value Proto message or nested field value.
 */
type ReadonlyMessage<Value> = Value extends Uint8Array
  ? ReadonlyBytes
  : Value extends readonly (infer Item)[]
    ? readonly ReadonlyMessage<Item>[]
    : Value extends object
      ? { readonly [Key in keyof Value]: ReadonlyMessage<Value[Key]> }
      : Value;

/**
 * Identifies the real read operation without inventing a transport request.
 */
export type ReadSideOperation =
  | Readonly<{
      /**
       * QueryService read.
       */
      kind: "query";

      /**
       * Submitted entity query.
       */
      query: ReadonlyMessage<Query>;
    }>
  | Readonly<{
      /**
       * Application query handler read.
       */
      kind: "app-query";

      /**
       * Submitted application query.
       */
      appQuery: ReadonlyMessage<AppQuery>;
    }>
  | Readonly<{
      /**
       * Subscription delivery read.
       */
      kind: "subscription";

      /**
       * Active subscription.
       */
      subscription: ReadonlyMessage<Subscription>;

      /**
       * Topic that produced this occurrence.
       */
      topic: ReadonlyMessage<Topic>;
    }>
  | Readonly<{
      /**
       * Direct read; boundary-specific call details are supplied at integration.
       */
      kind: "direct";
    }>
  | Readonly<{
      /**
       * History read; boundary-specific call details are supplied at integration.
       */
      kind: "history";
    }>;

/**
 * Identifies the field and optional container position of a nested occurrence.
 */
export interface ReadSideField {
  /**
   * Protobuf field name containing this occurrence.
   */
  readonly name: string;

  /**
   * Original repeated-field position, if this is a list element.
   */
  readonly index?: number;

  /**
   * Map key, if this is a map value.
   */
  readonly key?: string;
}

/**
 * Invocation-local facts supplied to one read-side filter callback.
 */
export interface ReadSideContext extends TrustedReaderContext {
  /**
   * Actual operation that returned the domain message.
   */
  readonly operation: ReadSideOperation;

  /**
   * Effective actor and tenant metadata; it is not authentication proof.
   */
  readonly actorContext?: ReadonlyMessage<ActorContext>;

  /**
   * Effective tenant after admission, when the read is tenant-scoped.
   */
  readonly effectiveTenant?: ReadonlyMessage<TenantId>;

  /**
   * Enclosing application query when a handler reads a child Entity.
   */
  readonly enclosingAppQuery?: ReadonlyMessage<AppQuery>;

  /**
   * Bounded Context that produced this message, when applicable.
   */
  readonly producingContext?: BoundedContext;

  /**
   * Cancellation of the current read or subscription delivery.
   */
  readonly signal?: AbortSignal;

  /**
   * Detached read-only containing message for a nested occurrence.
   */
  readonly parent?: ReadonlyMessage<Message>;

  /**
   * Field containing this nested occurrence.
   */
  readonly field?: ReadSideField;
}

/**
 * Typed application policy for one registered Proto message schema.
 *
 * @typeParam Schema Generated schema for the domain message being filtered.
 */
export abstract class ReadSideFilter<Schema extends GenMessage<Message>> {
  /**
   * Generated schema used for exact registered type-URL matching.
   */
  readonly schema: Schema;

  /**
   * Whether this policy also examines occurrences below the returned root.
   */
  readonly nested: boolean;

  /**
   * Binds the message type and optional nested occurrence matching.
   *
   * @param schema Generated schema of values passed to filter().
   * @param options Enables nested matching when requested.
   */
  protected constructor(schema: Schema, options: Readonly<{ nested?: boolean }> = {}) {
    this.schema = schema;
    this.nested = options.nested === true;
  }

  /**
   * Updates, replaces, or removes a detached domain message.
   *
   * @param message Mutable detached message of the declared schema.
   * @param context Trusted invocation facts and optional containing snapshot.
   * @returns Same-type message or null to remove this occurrence.
   */
  abstract filter(
    message: MessageShape<Schema>,
    context: ReadSideContext,
  ): MessageShape<Schema> | null | Promise<MessageShape<Schema> | null>;
}
