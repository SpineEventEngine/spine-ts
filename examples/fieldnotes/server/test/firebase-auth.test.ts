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

import { describe, expect, it, vi } from "vitest";
import { AuthErrorCode, FirebaseAuthError } from "firebase-admin/auth";
import { FieldnotesFirebaseIdentity } from "../src/firebase-auth.js";

describe("Firebase Google identity verification", () => {
  const projectId = "demo-fieldnotes";
  const now = 1_800_000_000_000;
  const token = () => ({
    uid: "uid-1",
    aud: projectId,
    iss: `https://securetoken.google.com/${projectId}`,
    auth_time: now / 1000 - 60,
    firebase: { sign_in_provider: "google.com" },
  });
  const identity = (claims: ReturnType<typeof token>) => {
    const verifier = { verifyIdToken: vi.fn().mockResolvedValue(claims) };
    return {
      adapter: new FieldnotesFirebaseIdentity(projectId, 300_000, verifier, () => now),
      verifier,
    };
  };

  it("requires revoked-token verification and namespaces the Firebase principal", async () => {
    const { adapter, verifier } = identity(token());
    expect(await adapter.verify("id-token")).toEqual({
      id: JSON.stringify(["firebase-google", projectId, "uid-1"]),
    });
    expect(verifier.verifyIdToken).toHaveBeenCalledExactlyOnceWith("id-token", true);
  });

  it.each([
    { field: "aud", value: "another-project" },
    { field: "iss", value: "https://securetoken.google.com/another-project" },
    { field: "auth_time", value: now / 1000 - 301 },
    { field: "auth_time", value: now / 1000 + 1 },
    { field: "auth_time", value: Number.NaN },
    { field: "firebase", value: { sign_in_provider: "password" } },
    { field: "uid", value: "" },
  ])("rejects invalid $field claims", async ({ field, value }) => {
    const { adapter } = identity({ ...token(), [field]: value });
    expect(await adapter.verify("id-token")).toBeUndefined();
  });

  it.each([
    AuthErrorCode.INVALID_ID_TOKEN,
    AuthErrorCode.ID_TOKEN_EXPIRED,
    AuthErrorCode.ID_TOKEN_REVOKED,
    AuthErrorCode.USER_DISABLED,
    AuthErrorCode.USER_NOT_FOUND,
  ])("rejects an Admin credential error %s", async (code) => {
    const verifier = {
      verifyIdToken: vi.fn().mockRejectedValue(new FirebaseAuthError({ code, message: "refused" })),
    };
    const adapter = new FieldnotesFirebaseIdentity(projectId, 300_000, verifier, () => now);
    expect(await adapter.verify("refused-token")).toBeUndefined();
  });

  it("propagates provider and configuration failures", async () => {
    const unavailable = new FirebaseAuthError({
      code: AuthErrorCode.INTERNAL_ERROR,
      message: "provider unavailable",
    });
    const verifier = { verifyIdToken: vi.fn().mockRejectedValue(unavailable) };
    const adapter = new FieldnotesFirebaseIdentity(projectId, 300_000, verifier, () => now);
    await expect(adapter.verify("id-token")).rejects.toBe(unavailable);
  });

  it("propagates ambiguous Admin argument errors", async () => {
    const ambiguous = new FirebaseAuthError({
      code: AuthErrorCode.INVALID_ARGUMENT,
      message: "ambiguous verification failure",
    });
    const verifier = { verifyIdToken: vi.fn().mockRejectedValue(ambiguous) };
    const adapter = new FieldnotesFirebaseIdentity(projectId, 300_000, verifier, () => now);
    await expect(adapter.verify("candidate")).rejects.toBe(ambiguous);
  });
});
