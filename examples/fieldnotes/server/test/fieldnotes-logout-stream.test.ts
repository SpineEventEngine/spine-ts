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

import { randomBytes, randomUUID } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { ActorContextSchema, UserIdSchema } from "@spine-event-engine/proto";
import { SubscriptionService, TopicIdSchema, TopicSchema } from "@spine-event-engine/proto/client";
import { PlaceViewQuery } from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/entities_query.js";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { expect, it, vi } from "vitest";
import { FieldnotesHost } from "../src/fieldnotes-host.js";
import type { FieldnotesSettings } from "../src/host-settings.js";

const origin = "https://localhost:3000";

it("ends an active private entity stream when its app session is logged out", async () => {
  const settings: FieldnotesSettings = {
    postgresUrl: "postgres://localhost/fieldnotes",
    publicOrigin: origin,
    sessionPassword: randomBytes(32).toString("base64url"),
    csrfSecret: randomBytes(32),
    readerProofSecret: randomBytes(32),
    sessionTtlMilliseconds: 3_600_000,
    authRouteTimeoutMs: 10_000,
    authRouteMaxBytes: 65_536,
  };
  const projectId = "demo-fieldnotes";
  const verifier = {
    verifyIdToken: vi.fn().mockResolvedValue({
      uid: "stream-user",
      aud: projectId,
      iss: `https://securetoken.google.com/${projectId}`,
      auth_time: Math.floor(Date.now() / 1000),
      firebase: { sign_in_provider: "google.com" },
    }),
  };
  const host = await FieldnotesHost.open(settings, {
    storageFactory: new InMemoryStorageFactory(),
    authentication: { mode: "firebase", projectId, recentLoginMilliseconds: 300_000 },
    firebaseVerifier: verifier,
  });
  const controller = new AbortController();
  try {
    const exchange = await fetch(`${host.gateway.baseUrl}/auth/firebase/exchange`, {
      method: "POST",
      headers: { origin, "content-type": "application/json", "x-fieldnotes-auth": "1" },
      body: JSON.stringify({ idToken: "stream-id-token" }),
    });
    expect(exchange.status).toBe(200);
    const cookies = exchange.headers.getSetCookie();
    const credential = cookies[0]?.split(";", 1)[0]?.split("=", 2)[1];
    const csrf = cookies[1]?.split(";", 1)[0]?.split("=", 2)[1];
    if (!credential || !csrf) throw new Error("Missing app cookies.");
    const headers = {
      origin,
      cookie: `__Host-spine-session=${credential}; __Host-spine-csrf=${csrf}`,
      "x-spine-csrf": csrf,
    };
    const principalId = JSON.stringify(["firebase-google", projectId, "stream-user"]);
    const target = PlaceViewQuery.create()
      .author()
      .is(create(UserIdSchema, { value: principalId }))
      .build()
      .build().target;
    const service = createClient(
      SubscriptionService,
      createConnectTransport({ baseUrl: host.gateway.baseUrl, httpVersion: "1.1" }),
    );
    const handle = await service.subscribe(
      create(TopicSchema, {
        id: create(TopicIdSchema, { value: randomUUID() }),
        context: create(ActorContextSchema, {
          actor: create(UserIdSchema, { value: principalId }),
        }),
        target,
      }),
      { headers },
    );
    const active = service
      .activate(handle, { headers, signal: controller.signal })
      [Symbol.asyncIterator]();
    const acknowledgement = await active.next();
    expect(acknowledgement.done).toBe(false);
    let settled = false;
    const pending = active.next().then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    expect(settled).toBe(false);
    const logout = await fetch(`${host.gateway.baseUrl}/auth/logout`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", "x-fieldnotes-auth": "1" },
      body: "{}",
    });
    expect(logout.status).toBe(200);
    await vi.waitFor(() => {
      expect(settled).toBe(true);
    });
    await pending;
  } finally {
    controller.abort();
    await host.close();
  }
});
