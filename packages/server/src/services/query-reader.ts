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

import { clone } from "@bufbuild/protobuf";
import type { MessageSchema } from "@spine-event-engine/core";
import type { TenantId } from "@spine-event-engine/proto";
import { QuerySchema, type Query } from "@spine-event-engine/proto/client";
import type { NormalizedQueryPlan } from "@spine-event-engine/storage";

import { standAccess, type Stand, type StandReadResult } from "../stand/stand.js";
import type { ReadSideContext } from "../stand/read-side-filter.js";

type QueryReaderObserver = (query: Readonly<Query>) => void;

const observers = new Set<QueryReaderObserver>();

/**
 * Describes typed Stand queries and the testing-only read observer.
 */
interface QueryReaderAccess {
  /**
   * Reads a typed state through its Stand while retaining the actual query context.
   * @typeParam Schema Registered state schema.
   * @param stand Context read facade.
   * @param schema Requested state schema.
   * @param plan Normalized storage plan.
   * @param tenantId Effective tenant.
   * @param candidateLimit Existing query candidate limit.
   * @param query Original submitted Query, if present.
   * @param readSide Trusted invocation context, if present.
   * @returns Visible state records.
   */
  read<Schema extends MessageSchema>(
    stand: Stand,
    schema: Schema,
    plan: NormalizedQueryPlan<unknown>,
    tenantId: TenantId | undefined,
    candidateLimit: number,
    query?: Query,
    readSide?: ReadSideContext,
  ): Promise<readonly StandReadResult<Schema>[]>;

  /**
   * Observes original queries for tests without changing read execution.
   * @param onRead Observer called with a detached Query.
   * @returns Handle that removes this observer.
   */
  observe(onRead: QueryReaderObserver): { readonly close: () => void };
}

/**
 * Executes normalized Entity query plans against a Stand and exposes a testing-only read observer.
 *
 * @internal
 */
export const QueryReader: Readonly<QueryReaderAccess> = Object.freeze({
  /**
   * Reads the plan and forwards original query facts to Stand policy callbacks.
   * @typeParam Schema Registered state schema.
   * @param stand Context read facade.
   * @param schema Requested state schema.
   * @param plan Normalized storage plan.
   * @param tenantId Effective tenant.
   * @param candidateLimit Existing query candidate limit.
   * @param query Original submitted Query, if present.
   * @param readSide Trusted invocation context, if present.
   * @returns Visible state records.
   */
  read<Schema extends MessageSchema>(
    stand: Stand,
    schema: Schema,
    plan: NormalizedQueryPlan<unknown>,
    tenantId: TenantId | undefined,
    candidateLimit: number,
    query?: Query,
    readSide?: ReadSideContext,
  ): Promise<readonly StandReadResult<Schema>[]> {
    if (query !== undefined) {
      for (const observer of observers) {
        try {
          observer(clone(QuerySchema, query));
        } catch {
          // Test observation must not change production query execution.
        }
      }
    }
    const options = tenantId === undefined ? {} : { tenantId };
    const selected = { ...plan, candidateLimit };
    return readSide === undefined
      ? stand.queryPlanVersioned(schema, selected, options)
      : standAccess.queryPlanVersioned(stand, schema, selected, options, readSide);
  },

  observe(onRead: QueryReaderObserver): { readonly close: () => void } {
    observers.add(onRead);
    return Object.freeze({
      close: () => observers.delete(onRead),
    });
  },
});
