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

import process from "node:process";

import { StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import {
  BetterAuthAccountRecordSchema,
  BetterAuthSessionRecordSchema,
  BetterAuthUserRecordSchema,
  BetterAuthVerificationRecordSchema,
} from "@spine-event-engine/proto/auth";
import { StorageGroup } from "@spine-event-engine/storage";
import { PostgresStorageFactory } from "@spine-event-engine/storage-postgres";

import {
  BetterAuthIntegration,
  PersistentBetterAuthStore,
  genericOAuth,
} from "../../dist/better-auth/index.js";

const [groupName, issuer, callbackUrl, cookie] = process.argv.slice(2);
if ([groupName, issuer, callbackUrl, cookie].some((value) => !value))
  throw new Error("Fresh callback requires complete test configuration.");

const registry = new StringifierRegistry();
registry.setTypeRegistry(
  new TypeRegistry([
    BetterAuthUserRecordSchema,
    BetterAuthAccountRecordSchema,
    BetterAuthSessionRecordSchema,
    BetterAuthVerificationRecordSchema,
  ]),
);
let factory;
let store;
let integration;
try {
  factory = await PostgresStorageFactory.newBuilder()
    .setOptions({ url: process.env.SPINE_TS_POSTGRESQL_URL })
    .setStringifierRegistry(registry)
    .build();
  store = await PersistentBetterAuthStore.create({
    storageFactory: factory,
    group: new StorageGroup(groupName),
    models: ["user", "account", "session", "verification"],
    createMissingStructures: false,
  });
  integration = await BetterAuthIntegration.create({
    store,
    routePolicy: { maxRequestBytes: 4_096, timeoutMs: 5_000 },
    options: {
      baseURL: "http://localhost:3000",
      basePath: "/auth",
      secret: "native-process-oidc-secret-at-least-32-characters",
      trustedOrigins: ["http://localhost:3000"],
      plugins: [
        genericOAuth({
          config: [
            {
              providerId: "company",
              discoveryUrl: `${issuer}/metadata/custom`,
              clientId: "client",
              tokenEndpointAuth: { method: "none" },
              pkce: true,
              requireIdTokenVerification: true,
              disableSignUp: true,
              overrideUserInfo: false,
            },
          ],
        }),
      ],
    },
    onPrincipal: (user) => Promise.resolve({ id: user.id }),
  });
  const callback = integration.routes.find((route) => route.path === "/auth/callback/company");
  if (callback === undefined) throw new Error("Native callback was not selected.");
  const admitted = await globalThis.fetch(`${issuer}/gate`);
  if (!admitted.ok) throw new Error("Callback gate was unavailable.");
  const result = await callback.onRequest(
    new globalThis.Request(callbackUrl, { headers: { cookie } }),
    new globalThis.AbortController().signal,
  );
  if (![302, 401].includes(result.status)) throw new Error("Unexpected callback outcome.");
  if (result.status === 401 && result.headers.has("location"))
    throw new Error("Refused callback exposed a redirect.");
  const hasSession = result.headers.getSetCookie().some((line) => line.includes("session_token="));
  if (hasSession !== (result.status === 302))
    throw new Error("Callback credential result did not match its status.");
  process.stdout.write(`${String(result.status)}\n`);
} catch {
  process.stderr.write("Fresh process native OIDC callback proof failed.\n");
  process.exitCode = 1;
} finally {
  try {
    try {
      await integration?.close();
    } finally {
      try {
        await store?.close();
      } finally {
        await factory?.close();
      }
    }
  } catch {
    process.stderr.write("Fresh process native OIDC callback cleanup failed.\n");
    process.exitCode = 1;
  }
}
