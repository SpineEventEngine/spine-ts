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

import { ModelRef, type AiScope } from "@spine-event-engine/ai";
import { backendDefinition } from "@spine-event-engine/ai/spi/adapter";
import { expect, test } from "vitest";

import { PlanModelSelection } from "../src/trusted/plan-model-selection.js";

test("a discovered model registration binds the issued client and verified subject", async () => {
  let selectedClientId: string | undefined = "issued-client";
  let subject = "subject-1";
  const selector = new PlanModelSelection(
    {
      status: () =>
        Promise.resolve({
          ...(selectedClientId === undefined ? {} : { selectedClientId }),
          planEnabled: true,
          pendingClientIds: [],
          accounts: [{ clientId: "issued-client", subject, planEnabled: true }],
        }),
    },
    {
      models: () => Promise.resolve([{ slug: "account-model", displayName: "Account Model" }]),
      accessToken: () => Promise.resolve("access-secret"),
    },
  );
  const ref = ModelRef.of("release-notes-plan", "account-model");
  await expect(selector.select("issued-client", "unlisted-model", ref)).rejects.toThrow();
  const deployment = await selector.select("issued-client", "account-model", ref);
  const binding = backendDefinition(deployment);
  const scope = {} as AiScope;
  const identity = await binding.resolveIdentity(scope, {
    signal: new AbortController().signal,
    deadlineEpochMs: Date.now() + 1000,
  });
  expect(identity).toEqual({
    provider: "openai-chatgpt-plan",
    account: "issued-client:subject-1",
    endpoint: "https://api.openai.com/v1",
    model: "account-model",
  });
  expect(
    await binding.authorizeUse(scope, identity, {
      signal: new AbortController().signal,
      deadlineEpochMs: Date.now() + 1000,
    }),
  ).toBe(true);
  subject = "subject-2";
  expect(
    await binding.authorizeUse(scope, identity, {
      signal: new AbortController().signal,
      deadlineEpochMs: Date.now() + 1000,
    }),
  ).toBe(false);
  subject = "subject-1";
  selectedClientId = undefined;
  expect(
    await binding.authorizeUse(scope, identity, {
      signal: new AbortController().signal,
      deadlineEpochMs: Date.now() + 1000,
    }),
  ).toBe(false);
});

test("a delayed account catalog cannot replace the selected account model registration", async () => {
  let selectedClientId = "client-A";
  let releaseA: ((models: readonly { slug: string; displayName: string }[]) => void) | undefined;
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const catalogA = new Promise<readonly { slug: string; displayName: string }[]>((resolve) => {
    releaseA = resolve;
  });
  const selector = new PlanModelSelection(
    {
      status: () =>
        Promise.resolve({
          selectedClientId,
          planEnabled: true,
          pendingClientIds: [],
          accounts: [
            { clientId: "client-A", subject: "subject-A", planEnabled: true },
            { clientId: "client-B", subject: "subject-B", planEnabled: true },
          ],
        }),
    },
    {
      models: (clientId) => {
        if (clientId === "client-A") {
          markStarted?.();
          return catalogA;
        }
        return Promise.resolve([{ slug: "model-B", displayName: "Model B" }]);
      },
      accessToken: () => Promise.resolve("access-secret"),
    },
  );
  const first = selector.select("client-A", "model-A", ModelRef.of("plan", "A"));
  await started;
  selectedClientId = "client-B";
  const second = await selector.select("client-B", "model-B", ModelRef.of("plan", "B"));
  releaseA?.([{ slug: "model-A", displayName: "Model A" }]);
  await expect(first).rejects.toThrow("changed");
  expect(selector.current()).toBe(second);
});

test("a delayed earlier model choice cannot replace a later choice on the same account", async () => {
  let firstCatalog = true;
  let releaseFirst:
    ((models: readonly { slug: string; displayName: string }[]) => void) | undefined;
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const catalog = new Promise<readonly { slug: string; displayName: string }[]>((resolve) => {
    releaseFirst = resolve;
  });
  const selector = new PlanModelSelection(
    {
      status: () =>
        Promise.resolve({
          selectedClientId: "client-A",
          planEnabled: true,
          pendingClientIds: [],
          accounts: [{ clientId: "client-A", subject: "subject-A", planEnabled: true }],
        }),
    },
    {
      models: () => {
        if (firstCatalog) {
          firstCatalog = false;
          markStarted?.();
          return catalog;
        }
        return Promise.resolve([{ slug: "model-B", displayName: "Model B" }]);
      },
      accessToken: () => Promise.resolve("access-secret"),
    },
  );
  const first = selector.select("client-A", "model-A", ModelRef.of("plan", "A"));
  await started;
  const second = await selector.select("client-A", "model-B", ModelRef.of("plan", "B"));
  releaseFirst?.([{ slug: "model-A", displayName: "Model A" }]);
  await expect(first).rejects.toThrow("changed");
  expect(selector.current()).toBe(second);
});
