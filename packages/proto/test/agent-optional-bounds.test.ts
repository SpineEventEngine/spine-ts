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

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { AgentInvocationBoundsSchema } from "../generated/spine/server/agent/execution_record_pb.js";

describe("Agent invocation bound presence", () => {
  it("keeps absent ceilings distinct from an explicit zero across the wire", () => {
    const absent = fromBinary(
      AgentInvocationBoundsSchema,
      toBinary(AgentInvocationBoundsSchema, create(AgentInvocationBoundsSchema)),
    );
    const explicitZero = fromBinary(
      AgentInvocationBoundsSchema,
      toBinary(
        AgentInvocationBoundsSchema,
        create(AgentInvocationBoundsSchema, { toolCalls: 0n }),
      ),
    );
    expect(absent.toolCalls).toBeUndefined();
    expect(explicitZero.toolCalls).toBe(0n);
  });
});
