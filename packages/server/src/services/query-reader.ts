/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { clone } from "@bufbuild/protobuf";
import type { MessageSchema } from "@spine-event-engine/core";
import type { TenantId } from "@spine-event-engine/proto";
import { QuerySchema, type Query } from "@spine-event-engine/proto/client";
import type { NormalizedQueryPlan } from "@spine-event-engine/storage";

import type { Stand, StandReadResult } from "../stand/stand.js";

type QueryReaderObserver = (query: Readonly<Query>) => void;

const observers = new Set<QueryReaderObserver>();

/**
 * Executes normalized Entity query plans against a Stand and exposes a testing-only read observer.
 *
 * @internal
 */
export const QueryReader: Readonly<{
  readonly read: <Schema extends MessageSchema>(
    stand: Stand,
    schema: Schema,
    plan: NormalizedQueryPlan<unknown>,
    tenantId: TenantId | undefined,
    candidateLimit: number,
    query?: Query,
  ) => Promise<readonly StandReadResult<Schema>[]>;
  readonly observe: (onRead: QueryReaderObserver) => { readonly close: () => void };
}> = Object.freeze({
  read<Schema extends MessageSchema>(
    stand: Stand,
    schema: Schema,
    plan: NormalizedQueryPlan<unknown>,
    tenantId: TenantId | undefined,
    candidateLimit: number,
    query?: Query,
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
    return stand.queryPlanVersioned(
      schema,
      { ...plan, candidateLimit },
      tenantId === undefined ? {} : { tenantId },
    );
  },

  observe(onRead: QueryReaderObserver): { readonly close: () => void } {
    observers.add(onRead);
    return Object.freeze({
      close: () => observers.delete(onRead),
    });
  },
});
