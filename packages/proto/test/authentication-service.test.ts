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
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import {
  AuthenticationService,
  ResolveContextRequestSchema,
  ResolveContextResponseSchema,
} from "../src/auth/index.js";

describe("AuthenticationService", () => {
  it("exposes an informational context-resolution RPC without credential fields", () => {
    const request = create(ResolveContextRequestSchema);
    const response = create(ResolveContextResponseSchema, {
      actor: { value: "user-1" },
      tenant: { kind: { case: "value", value: "tenant-1" } },
      expiresAt: { seconds: 120n },
    });

    expect(AuthenticationService.typeName).toBe("spine.auth.AuthenticationService");
    expect(AuthenticationService.methods).toHaveLength(1);
    expect(AuthenticationService.methods[0]).toMatchObject({
      name: "ResolveContext",
      methodKind: "unary",
      input: ResolveContextRequestSchema,
      output: ResolveContextResponseSchema,
    });
    expect(request).toEqual({ $typeName: "spine.auth.ResolveContextRequest" });
    expect(response).toMatchObject({
      $typeName: "spine.auth.ResolveContextResponse",
      actor: { value: "user-1" },
      expiresAt: { seconds: 120n },
    });
    expect(Object.keys(request)).not.toContain("credential");
    expect(Object.keys(response)).not.toContain("sessionToken");
  });
});
