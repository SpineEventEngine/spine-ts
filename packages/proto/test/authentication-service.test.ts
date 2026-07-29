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
