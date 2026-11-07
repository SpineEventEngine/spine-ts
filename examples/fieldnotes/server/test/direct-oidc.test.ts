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

import { randomBytes } from "node:crypto";
import { OpaqueSessions, type OpaqueSessionCreateResult } from "@spine-event-engine/auth";
import { Time } from "@spine-event-engine/core";
import { expect, it, vi } from "vitest";
import { FieldnotesGoogleIdentity, FieldnotesSessionIssuer } from "../src/direct-oidc.js";

it("maps only the configured issuer and never links Google identities by email", async () => {
  const mapping = new FieldnotesGoogleIdentity("https://accounts.google.com");
  const signal = new AbortController().signal;
  expect(
    await mapping.resolve({ issuer: "https://different.test", subject: "same" }, signal),
  ).toBeUndefined();
  expect(
    await mapping.resolve({ issuer: "https://accounts.google.com", subject: "same" }, signal),
  ).toMatchObject({
    principal: { id: JSON.stringify(["google-oidc", "https://accounts.google.com", "same"]) },
  });
});

it("compensates a late issued session when grant exchange is cancelled", async () => {
  const sessions = await OpaqueSessions.create({
    scope: "fieldnotes-test",
    password: randomBytes(32).toString("base64url"),
    ttlMilliseconds: 3_600_000,
    clock: { now: Time.currentTimeMillis },
  });
  try {
    const created = await sessions.issue({ id: "late-user" });
    if (created.kind !== "created") throw new Error("Fixture session was not created.");
    let release!: (result: OpaqueSessionCreateResult) => void;
    const pending = new Promise<OpaqueSessionCreateResult>((resolve) => {
      release = resolve;
    });
    vi.spyOn(sessions, "issue").mockReturnValueOnce(pending);
    const controller = new AbortController();
    const issuer = new FieldnotesSessionIssuer(sessions);
    const request = issuer.issue({ id: "late-user" }, controller.signal);
    const reason = new Error("cancelled");
    controller.abort(reason);
    release(created);
    await expect(request).rejects.toBe(reason);
    await expect(sessions.resolve(created.credential)).resolves.toBeUndefined();
  } finally {
    await sessions.close();
  }
});
