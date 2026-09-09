/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import type { MessageSchema } from "@spine-event-engine/core";
import type { TenantId } from "@spine-event-engine/proto";
import type { NormalizedQueryPlan } from "@spine-event-engine/storage";

import type { Stand, StandReadResult } from "../stand/stand.js";

/** @internal */
export const QueryReader: Readonly<{
  readonly read: <Schema extends MessageSchema>(
    stand: Stand,
    schema: Schema,
    plan: NormalizedQueryPlan<unknown>,
    tenantId: TenantId | undefined,
    candidateLimit: number,
  ) => Promise<readonly StandReadResult<Schema>[]>;
}> = Object.freeze({
  read<Schema extends MessageSchema>(
    stand: Stand,
    schema: Schema,
    plan: NormalizedQueryPlan<unknown>,
    tenantId: TenantId | undefined,
    candidateLimit: number,
  ): Promise<readonly StandReadResult<Schema>[]> {
    return stand.queryPlanVersioned(
      schema,
      { ...plan, candidateLimit },
      tenantId === undefined ? {} : { tenantId },
    );
  },
});
