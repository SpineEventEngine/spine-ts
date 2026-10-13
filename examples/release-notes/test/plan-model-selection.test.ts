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
import { VercelAx } from "@spine-event-engine/ai-vercel-ax";
import type { PlanSessionModelOptions } from "@spine-event-engine/ai-vercel-ax";
import { backendDefinition, type AiExecutionControl } from "@spine-event-engine/ai/spi/adapter";
import { expect, test, vi } from "vitest";

import { PlanModelSelection } from "../src/trusted/plan-model-selection.js";

const control = (): AiExecutionControl => ({
  signal: new AbortController().signal,
  deadlineEpochMs: Date.now() + 1_000,
  nowEpochMs: () => Date.now(),
  hasAuthority: () => true,
  beginAttempt: vi.fn(),
  reserveTransport: vi.fn(),
  onReceived: vi.fn(),
  finishAttempt: vi.fn(),
  recordFailure: vi.fn(),
  admitGeneration: vi.fn(),
  admitDecision: vi.fn(),
  callTool: vi.fn(),
});

const modelRegistration =
  (
    subject: () => string,
    models: (clientId: string) => Promise<readonly { slug: string; displayName: string }[]>,
    accessToken: (clientId: string) => Promise<string>,
  ) =>
  async (options: PlanSessionModelOptions) => {
    if (!(await models(options.clientId)).some((entry) => entry.slug === options.model))
      throw new Error("Model is not available to this account.");
    const selectedSubject = subject();
    const identity = {
      provider: "openai-chatgpt-plan",
      account: `${options.clientId}:${selectedSubject}`,
      endpoint: "https://api.openai.com/v1",
      model: options.model,
    };
    return VercelAx.chatgptPlanModel({
      ref: options.ref,
      ...(options.platformFetch === undefined ? {} : { platformFetch: options.platformFetch }),
      resolveIdentity: () => identity,
      authorizeUse: async (scope, _identity, execution) =>
        subject() === selectedSubject && (await options.authorizeUse(scope, execution)),
      connect: async (_scope, _identity, execution) => {
        if (!(await models(options.clientId)).some((entry) => entry.slug === options.model))
          throw new Error("Model is not available to this account.");
        if (!(await options.authorizeUse({} as AiScope, execution)))
          throw new Error("ChatGPT account or model selection changed.");
        const token = await accessToken(options.clientId);
        if (
          !(await options.authorizeUse({} as AiScope, execution)) ||
          subject() !== selectedSubject
        )
          throw new Error("ChatGPT account or model selection changed.");
        return { accessToken: token, identity };
      },
    });
  };

test("provider HTTP failures log only fixed status metadata", async () => {
  let transport: typeof fetch | undefined;
  const original = VercelAx.chatgptPlanModel.bind(VercelAx);
  const registration = vi.spyOn(VercelAx, "chatgptPlanModel").mockImplementation((options) => {
    transport = options.platformFetch;
    return original(options);
  });
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("private provider body", { status: 400 }));
  const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const selector = new PlanModelSelection(
      {
        status: () =>
          Promise.resolve({
            selectedClientId: "issued-client",
            planEnabled: true,
            pendingClientIds: [],
            accounts: [{ clientId: "issued-client", subject: "subject", planEnabled: true }],
          }),
      },
      {
        models: () => Promise.resolve([{ slug: "model", displayName: "Model" }]),
        model: modelRegistration(
          () => "subject",
          () => Promise.resolve([{ slug: "model", displayName: "Model" }]),
          () => Promise.resolve("private token"),
        ),
      },
    );
    await selector.selectDiscovered("issued-client", "model");
    if (!transport) throw new Error("Expected the plan transport callback.");
    await transport("https://api.openai.com/v1/responses");
    expect(report).toHaveBeenCalledWith(
      "[Release Notes Studio generation] stage=provider-response code=http-status status=400",
    );
    expect(JSON.stringify(report.mock.calls)).not.toContain("private provider body");
    expect(JSON.stringify(report.mock.calls)).not.toContain("private token");
  } finally {
    report.mockRestore();
    fetcher.mockRestore();
    registration.mockRestore();
  }
});

test("a nonselected or plan-disabled account cannot browse or register a model", async () => {
  let selectedClientId = "other-client";
  let planEnabled = true;
  const models = vi.fn(() => Promise.resolve([{ slug: "model", displayName: "Model" }]));
  const model = vi.fn(
    modelRegistration(
      () => "subject",
      models,
      () => Promise.resolve("secret"),
    ),
  );
  const selector = new PlanModelSelection(
    {
      status: () =>
        Promise.resolve({
          selectedClientId,
          planEnabled,
          pendingClientIds: [],
          accounts: [{ clientId: "issued-client", subject: "subject", planEnabled }],
        }),
    },
    { models, model },
  );
  expect(selector.current()).toBeUndefined();
  expect(await selector.activeBinding()).toBeUndefined();
  await expect(selector.selectDiscovered("issued-client", "model")).rejects.toThrow("not selected");
  selectedClientId = "issued-client";
  planEnabled = false;
  await expect(selector.selectDiscovered("issued-client", "model")).rejects.toThrow("not selected");
  expect(models).not.toHaveBeenCalled();
  expect(model).not.toHaveBeenCalled();
  expect(selector.current()).toBeUndefined();
});

test("selection uses the session registration's single authoritative model check", async () => {
  const models = vi.fn(() => Promise.resolve([{ slug: "model", displayName: "Model" }]));
  const selector = new PlanModelSelection(
    {
      status: () =>
        Promise.resolve({
          selectedClientId: "client",
          planEnabled: true,
          pendingClientIds: [],
          accounts: [{ clientId: "client", subject: "subject", planEnabled: true }],
        }),
    },
    {
      models,
      model: modelRegistration(
        () => "subject",
        models,
        () => Promise.resolve("secret"),
      ),
    },
  );
  await selector.selectDiscovered("client", "model");
  expect(models).toHaveBeenCalledExactlyOnceWith("client");
  models.mockResolvedValue([]);
  await expect(selector.selectDiscovered("client", "unknown")).rejects.toThrow(
    "Model is not available to this account.",
  );
  expect(selector.current()).toBeUndefined();
});

test("a discovered model registration binds the issued client and verified subject", async () => {
  let selectedClientId: string | undefined = "issued-client";
  let subject = "subject-1";
  let modelAvailable = true;
  const accessToken = vi.fn(() => Promise.resolve("access-secret"));
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
      models: () =>
        Promise.resolve(
          modelAvailable ? [{ slug: "account-model", displayName: "Account Model" }] : [],
        ),
      model: modelRegistration(
        () => subject,
        () =>
          Promise.resolve(
            modelAvailable ? [{ slug: "account-model", displayName: "Account Model" }] : [],
          ),
        accessToken,
      ),
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
  expect(await selector.activeBinding()).toMatchObject({
    clientId: "issued-client",
    subject: "subject-1",
    model: "account-model",
    registration: deployment,
  });
  const connection = await binding.connect(scope, identity, control());
  expect(connection.identity).toEqual(identity);
  expect(connection.model).toBeDefined();
  expect(accessToken).toHaveBeenCalledExactlyOnceWith("issued-client");
  subject = "subject-2";
  expect(
    await binding.authorizeUse(scope, identity, {
      signal: new AbortController().signal,
      deadlineEpochMs: Date.now() + 1000,
    }),
  ).toBe(false);
  subject = "subject-1";
  modelAvailable = false;
  expect(await selector.activeBinding()).toBeUndefined();
  await expect(binding.connect(scope, identity, control())).rejects.toThrow("not available");
  expect(accessToken).toHaveBeenCalledOnce();
  modelAvailable = true;
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
      model: modelRegistration(
        () => (selectedClientId === "client-A" ? "subject-A" : "subject-B"),
        (clientId) =>
          clientId === "client-A"
            ? (markStarted?.(), catalogA)
            : Promise.resolve([{ slug: "model-B", displayName: "Model B" }]),
        () => Promise.resolve("access-secret"),
      ),
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
      model: modelRegistration(
        () => "subject-A",
        () => {
          if (firstCatalog) {
            firstCatalog = false;
            markStarted?.();
            return catalog;
          }
          return Promise.resolve([{ slug: "model-B", displayName: "Model B" }]);
        },
        () => Promise.resolve("access-secret"),
      ),
    },
  );
  const first = selector.select("client-A", "model-A", ModelRef.of("plan", "A"));
  await started;
  const second = await selector.select("client-A", "model-B", ModelRef.of("plan", "B"));
  releaseFirst?.([{ slug: "model-A", displayName: "Model A" }]);
  await expect(first).rejects.toThrow("changed");
  expect(selector.current()).toBe(second);
});

test("an account change during catalog refresh cannot yield an active generation binding", async () => {
  let selectedClientId = "issued-client";
  let releaseCatalog:
    ((models: readonly { slug: string; displayName: string }[]) => void) | undefined;
  let catalogCalls = 0;
  let catalogStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    catalogStarted = resolve;
  });
  const delayedCatalog = new Promise<readonly { slug: string; displayName: string }[]>(
    (resolve) => {
      releaseCatalog = resolve;
    },
  );
  const selector = new PlanModelSelection(
    {
      status: () =>
        Promise.resolve({
          selectedClientId,
          planEnabled: true,
          pendingClientIds: [],
          accounts: [{ clientId: "issued-client", subject: "subject", planEnabled: true }],
        }),
    },
    {
      models: () => {
        catalogCalls++;
        if (catalogCalls === 1) catalogStarted?.();
        return catalogCalls === 1
          ? delayedCatalog
          : Promise.resolve([{ slug: "model", displayName: "Model" }]);
      },
      model: modelRegistration(
        () => "subject",
        () => Promise.resolve([{ slug: "model", displayName: "Model" }]),
        () => Promise.resolve("access-secret"),
      ),
    },
  );
  await selector.select("issued-client", "model", ModelRef.of("plan", "model"));
  const pending = selector.activeBinding();
  await started;
  selectedClientId = "other-client";
  releaseCatalog?.([{ slug: "model", displayName: "Model" }]);
  expect(await pending).toBeUndefined();
});

test("a connection cannot use a credential after its account changes during catalog refresh", async () => {
  let selectedClientId = "issued-client";
  let releaseCatalog:
    ((models: readonly { slug: string; displayName: string }[]) => void) | undefined;
  let catalogStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    catalogStarted = resolve;
  });
  const delayedCatalog = new Promise<readonly { slug: string; displayName: string }[]>(
    (resolve) => {
      releaseCatalog = resolve;
    },
  );
  let catalogCalls = 0;
  const accessToken = vi.fn(() => Promise.resolve("access-secret"));
  const selector = new PlanModelSelection(
    {
      status: () =>
        Promise.resolve({
          selectedClientId,
          planEnabled: true,
          pendingClientIds: [],
          accounts: [{ clientId: "issued-client", subject: "subject", planEnabled: true }],
        }),
    },
    {
      models: () => {
        catalogCalls++;
        if (catalogCalls === 1) catalogStarted?.();
        return catalogCalls === 1
          ? delayedCatalog
          : Promise.resolve([{ slug: "model", displayName: "Model" }]);
      },
      model: modelRegistration(
        () => "subject",
        () => {
          catalogCalls++;
          if (catalogCalls === 2) catalogStarted?.();
          return catalogCalls === 2
            ? delayedCatalog
            : Promise.resolve([{ slug: "model", displayName: "Model" }]);
        },
        accessToken,
      ),
    },
  );
  const registration = await selector.select(
    "issued-client",
    "model",
    ModelRef.of("plan", "model"),
  );
  const binding = backendDefinition(registration);
  const scope = {} as AiScope;
  const identity = await binding.resolveIdentity(scope, control());
  const pending = binding.connect(scope, identity, control());
  await started;
  selectedClientId = "other-client";
  releaseCatalog?.([{ slug: "model", displayName: "Model" }]);
  await expect(pending).rejects.toThrow("changed");
  expect(accessToken).not.toHaveBeenCalled();
});

test("a connection discards a token obtained after account selection changes", async () => {
  let selectedClientId = "issued-client";
  let releaseToken: ((token: string) => void) | undefined;
  let tokenStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    tokenStarted = resolve;
  });
  const token = new Promise<string>((resolve) => {
    releaseToken = resolve;
  });
  const selector = new PlanModelSelection(
    {
      status: () =>
        Promise.resolve({
          selectedClientId,
          planEnabled: true,
          pendingClientIds: [],
          accounts: [{ clientId: "issued-client", subject: "subject", planEnabled: true }],
        }),
    },
    {
      models: () => Promise.resolve([{ slug: "model", displayName: "Model" }]),
      model: modelRegistration(
        () => "subject",
        () => Promise.resolve([{ slug: "model", displayName: "Model" }]),
        () => {
          tokenStarted?.();
          return token;
        },
      ),
    },
  );
  const registration = await selector.select(
    "issued-client",
    "model",
    ModelRef.of("plan", "model"),
  );
  const binding = backendDefinition(registration);
  const scope = {} as AiScope;
  const identity = await binding.resolveIdentity(scope, control());
  const pending = binding.connect(scope, identity, control());
  await started;
  selectedClientId = "other-client";
  releaseToken?.("access-secret");
  await expect(pending).rejects.toThrow("changed");
});
