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

import { expect, test } from "vitest";
import { CredentialStore } from "../src/trusted/credential-store.js";

test("credential state and host identity exist only in one store instance", async () => {
  const store = new CredentialStore();
  const hostId = await store.hostId();
  expect(hostId).toMatch(/^urn:uuid:/);
  expect(await store.hostId()).toBe(hostId);
  await store.stageIssuedClient("issued-client");
  const grant = {
    clientId: "issued-client",
    issuer: "https://auth.openai.com",
    subject: "subject-1",
    scopes: ["openid", "chatgpt.tokens.use.direct"],
    accessToken: "access-secret",
    refreshToken: "refresh-secret",
  };
  await store.save(grant);
  grant.scopes[0] = "mutated";
  expect((await store.registration("issued-client"))?.scopes).toEqual([
    "openid",
    "chatgpt.tokens.use.direct",
  ]);
  const returned = await store.registration("issued-client");
  returned?.scopes?.push("mutated-again");
  expect((await store.registration("issued-client"))?.scopes).toHaveLength(2);
  const registrations = await store.registrations();
  expect(registrations).toHaveLength(1);
  expect(await store.pendingClientIds()).toEqual([]);
  expect(await store.registration("issued-client")).toMatchObject({ accessToken: "access-secret" });
  await store.save({ clientId: "replacement-client", issuer: "issuer", subject: "replacement" });
  expect(await store.registration("issued-client")).toBeUndefined();
  expect(await store.registrations()).toHaveLength(1);

  const fresh = new CredentialStore();
  expect(await fresh.hostId()).not.toBe(hostId);
  expect(await fresh.registrations()).toEqual([]);
  expect(await fresh.pendingClientIds()).toEqual([]);
  expect(await fresh.registration("issued-client")).toBeUndefined();
});

test("sign-out clears the in-session registration and issued client", async () => {
  const store = new CredentialStore();
  await store.stageIssuedClient("issued-client");
  expect(await store.pendingClientIds()).toEqual(["issued-client"]);
  await store.save({
    clientId: "issued-client",
    issuer: "https://auth.openai.com",
    subject: "subject-1",
    accessToken: "access-secret",
  });
  await store.clearTokens("issued-client");
  expect(await store.registration("issued-client")).toBeUndefined();
  expect(await store.registrations()).toEqual([]);
  expect(await store.pendingClientIds()).toEqual([]);
});
