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

import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { createRouterTransport } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { ModelRef } from "@spine-event-engine/ai";
import { VercelAx } from "@spine-event-engine/ai-vercel-ax";
import { Client } from "@spine-event-engine/client-node";
import { AnyMessages } from "@spine-event-engine/core";
import { BoundedContext } from "@spine-event-engine/server";

import {
  EditReleaseNotesSchema,
  PrepareReleaseNotesExportSchema,
  RequestReleaseGenerationSchema,
  type RequestReleaseGeneration,
} from "../generated/spine/examples/releasenotes/commands_pb.js";
import { ReleaseGenerationInputsConflictSchema } from "../generated/spine/examples/releasenotes/rejections_pb.js";
import {
  ReleaseDraftIdSchema,
  ReleaseInstructionSchema,
  ReleaseNotesDocumentSchema,
} from "../generated/spine/examples/releasenotes/types_pb.js";
import { ReleaseStudio } from "../dist/src/trusted/studio-service.js";
import { PlanModelSelection } from "../src/trusted/plan-model-selection.js";
import { StudioAccountGate } from "../src/trusted/studio-account-gate.js";
import { StudioWindowClose } from "../src/trusted/studio-window-close.js";

const delayRejectionDelivery = () => {
  const client = Client.usingTransport(
    createRouterTransport((router) => {
      void router;
    }),
  );
  const prototype = Object.getPrototypeOf(client.asGuest()) as {
    createSubscription: ReturnType<typeof client.asGuest>["createSubscription"];
  };
  const original = prototype.createSubscription;
  const release = Promise.withResolvers<undefined>();
  const seen: { draft: string; generation: string }[] = [];
  let created = 0;
  prototype.createSubscription = async function (this: unknown, ...args) {
    const subscription = await Reflect.apply(original, this, args);
    if (++created === 2) {
      const updates = subscription.updates;
      Object.defineProperty(subscription, "updates", {
        get: () => ({
          async *[Symbol.asyncIterator]() {
            for await (const delivery of updates) {
              await release.promise;
              yield delivery;
              const update = delivery.kind === "update" ? delivery.update : undefined;
              const events =
                update?.update.case === "eventUpdates" ? update.update.value.event : [];
              for (const event of events) {
                const rejected =
                  event.message &&
                  AnyMessages.unpack(event.message, ReleaseGenerationInputsConflictSchema);
                if (rejected?.id?.value && rejected.generation?.value)
                  seen.push({ draft: rejected.id.value, generation: rejected.generation.value });
              }
            }
          },
        }),
      });
    }
    return subscription;
  };
  return {
    release: () => {
      release.resolve(undefined);
    },
    seen: () => [...seen],
    restore: async () => {
      prototype.createSubscription = original;
      await client.close();
    },
  };
};

it("opens a draft through the public in-process Client with one pinned Git comparison", async () => {
  const directory = mkdtempSync(join(tmpdir(), "spine-studio-service-"));
  const gitExecutable = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const git = (...args: string[]) =>
    execFileSync(gitExecutable, args, { cwd: directory, encoding: "utf8" }).trim();
  git("init", "--quiet");
  git("config", "user.name", "Studio Fixture");
  git("config", "user.email", "fixture@example.invalid");
  writeFileSync(join(directory, "notes.md"), "Before\n");
  git("add", "notes.md");
  git("commit", "--quiet", "-m", "Before");
  const base = git("rev-parse", "HEAD");
  writeFileSync(join(directory, "notes.md"), "After\n");
  git("add", "notes.md");
  git("commit", "--quiet", "-m", "After");
  const target = git("rev-parse", "HEAD");
  const plan = new PlanModelSelection(
    { status: () => Promise.resolve({ accounts: [], pendingClientIds: [], planEnabled: false }) },
    { models: () => Promise.resolve([]), accessToken: () => Promise.reject(new Error("No plan")) },
  );
  let catalogUnavailable = true;
  const studio = await ReleaseStudio.start({
    gitExecutable,
    workerExecutable: process.execPath,
    workerPath: resolve("examples/release-notes/dist/src/trusted/git-worker-main.js"),
    workerCwd: directory,
    plan: {
      activeBinding: () => {
        if (catalogUnavailable) {
          catalogUnavailable = false;
          return Promise.reject(new Error("Account model catalog is unavailable."));
        }
        return plan.activeBinding();
      },
    },
  });
  try {
    const selected = await studio.compare(directory, base, target);
    expect(selected.base).toBe(base);
    expect(selected.target).toBe(target);
    expect(selected.changes).toEqual([{ path: "notes.md", status: "M" }]);
    expect((await studio.evidencePatch(selected.selectionId, 0)).patch).toContain("+After");
    const draft = await studio.openDraft(selected.selectionId, "October release", "SDK users");
    expect(draft.title).toBe("October release");
    expect(draft.comparison.selectionId).toBe(selected.selectionId);
    expect(draft.version.number).toBeGreaterThan(0);
    expect(draft.version.timestamp?.seconds).toBeTypeOf("bigint");
    expect((await studio.readDraft(draft.id)).version).toEqual(draft.version);
    for (const category of ["all", "conversation", "system", "domain"] as const) {
      expect(await studio.history(draft.id, category, 20)).toEqual({ items: [] });
    }
    await expect(studio.history(draft.id, "conversation", 20, "unexpected-cursor")).rejects.toThrow(
      "No generation conversation is available.",
    );
    await expect(studio.history("missing-draft", "all", 20)).rejects.toThrow(
      "Release draft is unavailable.",
    );
    await expect(studio.history(draft.id, "all", 0)).rejects.toThrow("positive safe integer");
    await expect(studio.history(draft.id, "all", Number.MAX_SAFE_INTEGER + 1)).rejects.toThrow(
      "positive safe integer",
    );
    await expect(studio.readDraft("prior-session-draft")).rejects.toThrow("unavailable");
    await expect(studio.preview("prior-session-draft")).rejects.toThrow("unavailable");
    await expect(
      studio.approve("prior-session-draft", draft.version, new TextEncoder().encode("review")),
    ).rejects.toThrow("unavailable");
    await expect(studio.prepareExport("prior-session-draft", draft.version)).rejects.toThrow(
      "unavailable",
    );
    await expect(studio.requestGeneration("prior-session-draft", "Explain")).rejects.toThrow(
      "unavailable",
    );
    expect(await studio.generationObservation("prior-session-generation")).toEqual({
      receipt: false,
      phase: undefined,
    });
    await expect(studio.repeatGeneration("prior-session-generation")).rejects.toThrow(
      "unavailable",
    );
    await expect(studio.openDraft("missing-comparison", "October", "Users")).rejects.toThrow(
      "comparison is unavailable",
    );
    await expect(studio.openDraft(selected.selectionId, " ", "Users")).rejects.toThrow(
      "bounded and nonblank",
    );
    await expect(studio.openDraft(selected.selectionId, "Release", " ")).rejects.toThrow(
      "bounded and nonblank",
    );
    await expect(studio.evidencePatch(selected.selectionId, -1)).rejects.toThrow(
      "evidence is unavailable",
    );
    await expect(
      studio.evidencePatch(selected.selectionId, selected.evidence.length),
    ).rejects.toThrow("evidence is unavailable");
    await expect(studio.evidencePatch("missing-comparison", 0)).rejects.toThrow(
      "evidence is unavailable",
    );
    await expect(studio.edit("missing-draft", draft.version, draft.document)).rejects.toThrow(
      "draft is unavailable",
    );
    await expect(
      studio.approve(draft.id, draft.version, new Uint8Array(1_000_001)),
    ).rejects.toThrow("Approval is unavailable");
    await expect(studio.requestGeneration(draft.id, "Explain the change")).rejects.toThrow(
      "Account model catalog is unavailable.",
    );
    await expect(studio.requestGeneration(draft.id, "Explain the change")).rejects.toThrow(
      "Select an available ChatGPT plan model",
    );
    expect((await studio.readDraft(draft.id)).version).toEqual(draft.version);
    const started = Promise.withResolvers<undefined>();
    const releaseMutation = Promise.withResolvers<undefined>();
    const mutation = StudioAccountGate.run(studio, "select-model", null, async () => {
      started.resolve(undefined);
      await releaseMutation.promise;
    });
    await started.promise;
    await expect(studio.requestGeneration(draft.id, "Overlapping action")).rejects.toThrow("Wait");
    releaseMutation.resolve(undefined);
    await mutation;
  } finally {
    await studio.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("binds an accepted generation to its model and committed Git evidence through the real Agent", async () => {
  const directory = mkdtempSync(join(tmpdir(), "spine-studio-agent-"));
  const gitExecutable = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const git = (...args: string[]) =>
    execFileSync(gitExecutable, args, { cwd: directory, encoding: "utf8" }).trim();
  git("init", "--quiet");
  git("config", "user.name", "Studio Fixture");
  git("config", "user.email", "fixture@example.invalid");
  writeFileSync(join(directory, "notes.txt"), "Before\n");
  git("add", "notes.txt");
  git("commit", "--quiet", "-m", "Before");
  const base = git("rev-parse", "HEAD");
  writeFileSync(join(directory, "notes.txt"), "After\n");
  git("add", "notes.txt");
  git("commit", "--quiet", "-m", "After");
  const target = git("rev-parse", "HEAD");
  const bodies: unknown[] = [];
  const freshStarted = Promise.withResolvers<undefined>();
  const releaseFresh = Promise.withResolvers<undefined>();
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of request) chunks.push(chunk as Uint8Array);
      bodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
      if (bodies.length === 3) {
        freshStarted.resolve(undefined);
        await releaseFresh.promise;
      }
      response.setHeader("content-type", "text/event-stream");
      response.end(studioResponse(bodies.length, base, target));
    })().catch(() => response.writeHead(500).end());
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address.");
  const identity = {
    provider: "chatgpt-plan",
    account: "client:subject",
    endpoint: `http://127.0.0.1:${String(address.port)}/v1`,
    model: "fixture-model",
  };
  const registration = VercelAx.chatgptPlanModel({
    ref: ModelRef.of("studio-plan", "client:fixture-model"),
    resolveIdentity: () => identity,
    authorizeUse: () => true,
    connect: () => ({ accessToken: "fixture-token", identity }),
  });
  const delayedRejection = delayRejectionDelivery();
  const studio = await ReleaseStudio.start({
    gitExecutable,
    workerExecutable: process.execPath,
    workerPath: resolve("examples/release-notes/dist/src/trusted/git-worker-main.js"),
    workerCwd: directory,
    plan: {
      activeBinding: () =>
        Promise.resolve({
          clientId: "client",
          subject: "subject",
          model: "fixture-model",
          registration,
        }),
    },
  }).finally(delayedRejection.restore);
  try {
    const selected = await studio.compare(directory, base, target);
    const draft = await studio.openDraft(selected.selectionId, "October release", "SDK users");
    const generation = await studio.requestGeneration(draft.id, "Explain the change");
    expect(generation).toBeTruthy();
    let staged = await studio.readDraft(draft.id);
    for (let attempt = 0; attempt < 100 && staged.generationStatus !== "staged"; attempt++) {
      await new Promise((done) => setTimeout(done, 20));
      staged = await studio.readDraft(draft.id);
    }
    expect(staged.generationStatus).toBe("staged");
    expect(staged.document.sections[0]?.entries[0]?.evidence[0]?.path).toBe("notes.txt");
    expect(bodies).toHaveLength(2);
    expect(await studio.generationPhase(generation)).toBe("completed");
    expect((await studio.history(draft.id, "all", 20)).items.length).toBeGreaterThan(0);
    expect((await studio.history(draft.id, "conversation", 20)).items.length).toBeGreaterThan(0);
    expect((await studio.history(draft.id, "system", 20)).items.length).toBeGreaterThan(0);
    expect((await studio.history(draft.id, "domain", 20)).items.length).toBeGreaterThan(0);
    for (const category of ["all", "conversation", "system", "domain"] as const) {
      const complete = await studio.history(draft.id, category, 100);
      const pages: unknown[] = [];
      let cursor: string | undefined;
      for (let pageNumber = 0; pageNumber <= complete.items.length; pageNumber++) {
        const page = await studio.history(draft.id, category, 1, cursor);
        pages.push(...page.items);
        cursor = page.cursor;
        if (!cursor) break;
      }
      expect(cursor).toBeUndefined();
      expect(pages).toEqual(complete.items);
    }
    const accountStarted = Promise.withResolvers<undefined>();
    const releaseAccount = Promise.withResolvers<undefined>();
    const accountAction = StudioAccountGate.run(studio, "select-model", null, async () => {
      accountStarted.resolve(undefined);
      await releaseAccount.promise;
    });
    await accountStarted.promise;
    await expect(studio.repeatGeneration(generation)).rejects.toThrow("Wait");
    releaseAccount.resolve(undefined);
    await accountAction;
    expect(bodies).toHaveLength(2);
    const preview = await studio.preview(draft.id);
    expect(new TextDecoder().decode(preview.markdown)).toContain(
      "Evidence: <code>&quot;notes.txt&quot;</code> in commit",
    );
    const approved = await studio.approve(draft.id, preview.version, preview.markdown);
    expect(approved.approvalDigest).toBe(preview.digest);
    expect(await studio.prepareExport(draft.id, approved.version)).toEqual(preview.markdown);
    await expect(studio.edit(draft.id, preview.version, staged.document)).rejects.toThrow(
      "displayed draft Version is stale",
    );
    const guest = Client.usingTransport(
      createRouterTransport((router) => {
        void router;
      }),
    ).asGuest();
    const prototype = Object.getPrototypeOf(guest) as {
      post: (...args: unknown[]) => Promise<{ kind: string }>;
      createSubscription: typeof guest.createSubscription;
    };
    const originalPost = prototype.post;
    const originalCreateSubscription = prototype.createSubscription;
    let cancelledExportSubscription = 0;
    prototype.createSubscription = async function (this: unknown, ...args) {
      const subscription = await Reflect.apply(originalCreateSubscription, this, args);
      const cancel = subscription.cancel.bind(subscription);
      subscription.cancel = () => {
        cancelledExportSubscription++;
        return cancel();
      };
      Object.defineProperty(subscription, "updates", {
        get: () => ({
          [Symbol.asyncIterator]: () => ({
            next: () => Promise.resolve({ done: true as const, value: undefined }),
          }),
        }),
      });
      return subscription;
    };
    try {
      const current = await studio.readDraft(draft.id);
      await expect(studio.prepareExport(draft.id, current.version)).rejects.toThrow(
        "Export Event is not yet confirmed.",
      );
      expect(cancelledExportSubscription).toBe(1);
      const displayed = await studio.readDraft(draft.id);
      prototype.post = async function (this: unknown, ...args: unknown[]) {
        if (
          (args[0] as { typeName?: string }).typeName === PrepareReleaseNotesExportSchema.typeName
        ) {
          const edited = await Reflect.apply(originalPost, this, [
            EditReleaseNotesSchema,
            create(EditReleaseNotesSchema, {
              id: create(ReleaseDraftIdSchema, { value: draft.id }),
              expectedVersion: displayed.version,
              document: create(ReleaseNotesDocumentSchema, { sections: [] }),
            }),
          ]);
          expect(edited.kind).toBe("ok");
        }
        return Reflect.apply(originalPost, this, args);
      };
      await expect(studio.prepareExport(draft.id, displayed.version)).rejects.toThrow(
        "Export Event is not yet confirmed.",
      );
      expect(cancelledExportSubscription).toBe(2);
      await expect
        .poll(async () => (await studio.readDraft(draft.id)).approvalDigest)
        .toBeUndefined();
    } finally {
      prototype.post = originalPost;
      prototype.createSubscription = originalCreateSubscription;
    }
    let changedBeforeGeneration = false;
    let staleCommand: RequestReleaseGeneration | undefined;
    let freshCommand: RequestReleaseGeneration | undefined;
    let postThroughService:
      ((command: RequestReleaseGeneration) => Promise<{ kind: string }>) | undefined;
    prototype.post = async function (this: unknown, ...args: unknown[]) {
      if (
        !changedBeforeGeneration &&
        (args[0] as { typeName?: string }).typeName === RequestReleaseGenerationSchema.typeName
      ) {
        changedBeforeGeneration = true;
        const attempted = args[1] as RequestReleaseGeneration;
        staleCommand = attempted;
        const edit = create(EditReleaseNotesSchema, {
          id: attempted.id,
          expectedVersion: attempted.expectedVersion,
          document: create(ReleaseNotesDocumentSchema, { sections: [] }),
        });
        const accepted = await Reflect.apply(originalPost, this, [EditReleaseNotesSchema, edit]);
        expect(accepted.kind).toBe("ok");
      } else if (
        (args[0] as { typeName?: string }).typeName === RequestReleaseGenerationSchema.typeName
      ) {
        postThroughService = (command) =>
          Reflect.apply(originalPost, this, [RequestReleaseGenerationSchema, command]);
        freshCommand = args[1] as RequestReleaseGeneration;
      }
      return Reflect.apply(originalPost, this, args);
    };
    try {
      await expect(studio.requestGeneration(draft.id, "Stale after edit")).rejects.toThrow(
        "acceptance is unconfirmed",
      );
      const rejected = studio.session().generations[draft.id];
      expect(rejected).toBeTruthy();
      expect(await studio.generationObservation(rejected ?? "")).toMatchObject({
        receipt: false,
        phase: undefined,
      });
      expect(await studio.selectionLocked()).toBe(true);
      delayedRejection.release();
      await expect.poll(() => delayedRejection.seen().length).toBe(1);
      expect((await studio.generationObservation(rejected ?? "")).rejection).toBe(
        "inputs-conflict",
      );
      const unavailable = vi.spyOn(BoundedContext.prototype, "stand").mockImplementation(() => {
        throw new Error("Fixture storage read failed.");
      });
      try {
        expect(await studio.generationObservation(rejected ?? "")).toMatchObject({
          receipt: false,
          rejection: "inputs-conflict",
        });
      } finally {
        unavailable.mockRestore();
      }
      expect(await studio.selectionLocked()).toBe(false);
      expect(bodies).toHaveLength(2);
      await expect(studio.repeatGeneration(rejected ?? "")).rejects.toThrow("inputs changed");
      const other = await studio.openDraft(selected.selectionId, "Other release", "SDK users");
      const fresh = await studio.requestGeneration(draft.id, "Use the edited draft");
      expect(fresh).not.toBe(rejected);
      expect((await studio.generationObservation(fresh)).receipt).toBe(true);
      await freshStarted.promise;
      expect(await studio.allowsReconnect("client")).toBe(true);
      expect(await studio.allowsReconnect("other-client")).toBe(false);
      if (!postThroughService || !staleCommand || !freshCommand)
        throw new Error("Public Client did not capture both generation Commands.");
      const oldOutcome = await postThroughService(staleCommand);
      const unrelated = create(RequestReleaseGenerationSchema, {
        ...freshCommand,
        id: create(ReleaseDraftIdSchema, { value: other.id }),
      });
      const otherOutcome = await postThroughService(unrelated);
      expect(oldOutcome.kind).toBe("ok");
      expect(otherOutcome.kind).toBe("ok");
      await expect.poll(() => delayedRejection.seen().length).toBe(3);
      expect(delayedRejection.seen()).toEqual([
        { draft: draft.id, generation: rejected },
        { draft: draft.id, generation: rejected },
        { draft: other.id, generation: fresh },
      ]);
      expect((await studio.generationObservation(fresh)).rejection).toBeUndefined();
      expect(await studio.selectionLocked()).toBe(true);
      await expect(studio.requestGeneration(draft.id, "Cannot overlap")).rejects.toThrow("Wait");
      expect((await studio.generationObservation(rejected ?? "")).rejection).toBe(
        "inputs-conflict",
      );
      releaseFresh.resolve(undefined);
    } finally {
      prototype.post = originalPost;
    }
  } finally {
    delayedRejection.release();
    releaseFresh.resolve(undefined);
    await studio.close();
    server.close();
    rmSync(directory, { recursive: true, force: true });
  }
}, 12_000);

it.each(["second creation", "second activation"])(
  "closes subscriptions, client, and Bounded Context after %s fails",
  async (failure) => {
    const dummyClient = Client.usingTransport(
      createRouterTransport((router) => {
        void router;
      }),
    );
    const guest = dummyClient.asGuest();
    const prototype = Object.getPrototypeOf(guest) as {
      createSubscription: typeof guest.createSubscription;
    };
    const original = prototype.createSubscription;
    const cancellations: (() => number)[] = [];
    const clientPrototype = Object.getPrototypeOf(dummyClient) as {
      close: typeof dummyClient.close;
    };
    const closedClient = vi.spyOn(clientPrototype, "close");
    const closedContext = vi.spyOn(BoundedContext.prototype, "close");
    let created = 0;
    prototype.createSubscription = async function (this: unknown, ...args) {
      created++;
      if (created === 2 && failure === "second creation") throw new Error("Fixture create failed.");
      const subscription = await Reflect.apply(original, this, args);
      const cancel = subscription.cancel.bind(subscription);
      let calls = 0;
      subscription.cancel = () => {
        calls++;
        return cancel();
      };
      cancellations.push(() => calls);
      if (created === 2 && failure === "second activation")
        vi.spyOn(subscription, "activate").mockRejectedValue(
          new Error("Fixture activation failed."),
        );
      return subscription;
    };
    try {
      await expect(
        ReleaseStudio.start({
          gitExecutable: "git",
          workerExecutable: process.execPath,
          workerPath: resolve("examples/release-notes/dist/src/trusted/git-worker-main.js"),
          workerCwd: process.cwd(),
          plan: { activeBinding: () => Promise.resolve(undefined) },
        }),
      ).rejects.toThrow(failure === "second creation" ? "create failed" : "activation failed");
      expect(cancellations).toHaveLength(failure === "second creation" ? 1 : 2);
      for (const count of cancellations) expect(count()).toBeGreaterThan(0);
      expect(closedClient).toHaveBeenCalled();
      expect(closedContext).toHaveBeenCalled();
    } finally {
      prototype.createSubscription = original;
      closedClient.mockRestore();
      closedContext.mockRestore();
      await dummyClient.close();
    }
  },
);

it("closes client and Bounded Context after subscription cancellation reports a failure", async () => {
  const dummyClient = Client.usingTransport(
    createRouterTransport((router) => {
      void router;
    }),
  );
  const guest = dummyClient.asGuest();
  const prototype = Object.getPrototypeOf(guest) as {
    createSubscription: typeof guest.createSubscription;
  };
  const original = prototype.createSubscription;
  const closedClient = vi.spyOn(
    Object.getPrototypeOf(dummyClient) as { close: typeof dummyClient.close },
    "close",
  );
  const closedContext = vi.spyOn(BoundedContext.prototype, "close");
  let created = 0;
  prototype.createSubscription = async function (this: unknown, ...args) {
    const subscription = await Reflect.apply(original, this, args);
    if (++created === 1) {
      const cancel = subscription.cancel.bind(subscription);
      subscription.cancel = async () => {
        await cancel();
        throw new Error("Fixture subscription cancellation failed.");
      };
    }
    return subscription;
  };
  try {
    const studio = await ReleaseStudio.start({
      gitExecutable: "git",
      workerExecutable: process.execPath,
      workerPath: resolve("examples/release-notes/dist/src/trusted/git-worker-main.js"),
      workerCwd: process.cwd(),
      plan: { activeBinding: () => Promise.resolve(undefined) },
    });
    await expect(studio.close()).rejects.toThrow("subscription cancellation failed");
    expect(closedClient).toHaveBeenCalled();
    expect(closedContext).toHaveBeenCalled();
  } finally {
    prototype.createSubscription = original;
    closedClient.mockRestore();
    closedContext.mockRestore();
    await dummyClient.close();
  }
});

it("retains uncertain accepted admission and locks account switching without a duplicate paid call", async () => {
  const directory = mkdtempSync(join(tmpdir(), "spine-studio-lock-"));
  const gitExecutable = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const git = (...args: string[]) =>
    execFileSync(gitExecutable, args, { cwd: directory, encoding: "utf8" }).trim();
  git("init", "--quiet");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  writeFileSync(join(directory, "notes.txt"), "Before\n");
  git("add", "notes.txt");
  git("commit", "--quiet", "-m", "Base");
  const base = git("rev-parse", "HEAD");
  writeFileSync(join(directory, "notes.txt"), "After\n");
  git("commit", "--quiet", "-am", "Release");
  const target = git("rev-parse", "HEAD");
  let releaseResponse: (() => void) | undefined;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let providerRequests = 0;
  const server = createServer((request, response) => {
    void (async () => {
      providerRequests++;
      for await (const chunk of request) {
        void chunk;
        /* consume body */
      }
      await responseGate;
      response.setHeader("content-type", "text/event-stream");
      response.end(studioResponse(2, base, target));
    })().catch(() => response.writeHead(500).end());
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing provider fixture.");
  const identity = {
    provider: "chatgpt-plan",
    account: "client:subject",
    endpoint: `http://127.0.0.1:${String(address.port)}/v1`,
    model: "fixture-model",
  };
  const registration = VercelAx.chatgptPlanModel({
    ref: ModelRef.of("studio-plan", "client:fixture-model"),
    resolveIdentity: () => identity,
    authorizeUse: () => true,
    connect: () => ({ accessToken: "fixture-token", identity }),
  });
  const studio = await ReleaseStudio.start({
    gitExecutable,
    workerExecutable: process.execPath,
    workerPath: resolve("examples/release-notes/dist/src/trusted/git-worker-main.js"),
    workerCwd: directory,
    plan: {
      activeBinding: () =>
        Promise.resolve({
          clientId: "client",
          subject: "subject",
          model: "fixture-model",
          registration,
        }),
    },
  });
  try {
    const selected = await studio.compare(directory, base, target);
    const first = await studio.openDraft(selected.selectionId, "First", "Users");
    const second = await studio.openDraft(selected.selectionId, "Second", "Users");
    const guest = Client.usingTransport(
      createRouterTransport((router) => {
        void router;
      }),
    ).asGuest();
    const prototype = Object.getPrototypeOf(guest) as {
      post: (...args: unknown[]) => Promise<{ kind: string }>;
    };
    const originalPost = prototype.post;
    let heldBeforeCommit = false;
    let lostAfterCommit = false;
    let conflictingReplay = false;
    const submitted: unknown[] = [];
    prototype.post = async function (this: unknown, ...args: unknown[]) {
      if ((args[0] as { typeName?: string }).typeName === RequestReleaseGenerationSchema.typeName)
        submitted.push(structuredClone(args[1]));
      if (
        !heldBeforeCommit &&
        (args[0] as { typeName?: string }).typeName === RequestReleaseGenerationSchema.typeName
      ) {
        heldBeforeCommit = true;
        throw new Error("Fixture lost the Command before dispatch.");
      }
      const posted =
        conflictingReplay &&
        (args[0] as { typeName?: string }).typeName === RequestReleaseGenerationSchema.typeName
          ? [
              args[0],
              create(RequestReleaseGenerationSchema, {
                ...(args[1] as RequestReleaseGeneration),
                instruction: create(ReleaseInstructionSchema, {
                  value: "Changed accepted instruction",
                }),
              }),
            ]
          : args;
      const result = await Reflect.apply(originalPost, this, posted);
      if (
        !lostAfterCommit &&
        (args[0] as { typeName?: string }).typeName === RequestReleaseGenerationSchema.typeName &&
        result.kind === "ok"
      ) {
        lostAfterCommit = true;
        throw new Error("Fixture lost the Command acknowledgment after commit.");
      }
      return result;
    };
    try {
      await expect(studio.requestGeneration(first.id, "")).rejects.toThrow("before dispatch");
      const retained = studio.session().generations[first.id];
      if (!retained) throw new Error("Original generation was not retained.");
      expect(await studio.generationObservation(retained)).toEqual({
        receipt: false,
        phase: undefined,
      });
      await expect(studio.repeatGeneration(retained)).rejects.toThrow("acknowledgment");
      expect(studio.session().generations[first.id]).toBe(retained);
      expect((await studio.generationObservation(retained)).receipt).toBe(true);
      expect(await studio.repeatGeneration(retained)).toBe(retained);
      expect(submitted).toHaveLength(3);
      expect(submitted[1]).toEqual(submitted[0]);
      expect(submitted[2]).toEqual(submitted[0]);
      conflictingReplay = true;
      expect(await studio.repeatGeneration(retained)).toBe(retained);
      expect(await studio.generationObservation(retained)).toMatchObject({ receipt: true });
      expect(await studio.selectionLocked()).toBe(true);
      conflictingReplay = false;
    } finally {
      prototype.post = originalPost;
    }
    const generation = studio.session().generations[first.id];
    if (!generation) throw new Error("Original generation was not retained.");
    expect(studio.session().generations[first.id]).toBe(generation);
    expect(await studio.selectionLocked()).toBe(true);
    expect(await studio.allowsReconnect("client")).toBe(true);
    expect(await studio.allowsReconnect("different-client")).toBe(false);
    await expect(StudioAccountGate.requireUnlocked(studio, "sign-in", null)).rejects.toThrow(
      "Wait",
    );
    await expect(
      StudioAccountGate.requireUnlocked(studio, "reconnect", "different-client"),
    ).rejects.toThrow("Wait");
    await expect(StudioAccountGate.requireUnlocked(studio, "select-model", null)).rejects.toThrow(
      "Wait",
    );
    await expect(StudioAccountGate.requireUnlocked(studio, "sign-out", null)).rejects.toThrow(
      "Wait",
    );
    await expect(
      StudioAccountGate.requireUnlocked(studio, "reconnect", "client"),
    ).resolves.toBeUndefined();
    await expect(
      StudioAccountGate.run(studio, "reconnect", "client", () => Promise.resolve("renewed")),
    ).resolves.toBe("renewed");
    let changedAccount = false;
    await expect(
      StudioAccountGate.run(studio, "reconnect", "different-client", () => {
        changedAccount = true;
        return Promise.resolve();
      }),
    ).rejects.toThrow("Wait");
    expect(changedAccount).toBe(false);
    await expect(studio.requestGeneration(first.id, "Clicked twice")).rejects.toThrow("Wait");
    expect(studio.session().generations[first.id]).toBe(generation);
    await expect(studio.requestGeneration(second.id, "Another release")).rejects.toThrow("Wait");
    expect((await studio.readDraft(second.id)).generationStatus).toBe("");
    await expect.poll(() => providerRequests).toBe(1);

    const closeEvents: string[] = [];
    const window = new EventEmitter() as EventEmitter & { close(): void };
    window.close = () => {
      const event = {
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
      };
      window.emit("close", event);
      if (!event.defaultPrevented) {
        closeEvents.push("window-closed");
        window.emit("closed");
      }
    };
    const decisions: ("wait" | "stop")[] = ["wait", "stop"];
    StudioWindowClose.install(
      window as unknown as Parameters<typeof StudioWindowClose.install>[0],
      studio,
      {
        close: () => {
          closeEvents.push("auth-closed");
          return Promise.resolve();
        },
      },
      () => {
        const decision = decisions.shift() ?? "wait";
        closeEvents.push(decision);
        return Promise.resolve(decision);
      },
    );
    window.close();
    await expect.poll(() => closeEvents.includes("wait")).toBe(true);
    expect(closeEvents).not.toContain("window-closed");
    expect(studio.session().generations[first.id]).toBe(generation);
    window.close();
    await expect.poll(() => closeEvents.includes("window-closed")).toBe(true);
    expect(closeEvents).toEqual(["wait", "stop", "window-closed", "auth-closed"]);
    expect(providerRequests).toBe(1);
  } finally {
    releaseResponse?.();
    await studio.close();
    server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("releases account selection after a credential denial is saved for the accepted Agent", async () => {
  const directory = mkdtempSync(join(tmpdir(), "spine-studio-denied-"));
  const gitExecutable = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const git = (...args: string[]) =>
    execFileSync(gitExecutable, args, { cwd: directory, encoding: "utf8" }).trim();
  git("init", "--quiet");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  writeFileSync(join(directory, "notes.txt"), "Before\n");
  git("add", "notes.txt");
  git("commit", "--quiet", "-m", "Base");
  const base = git("rev-parse", "HEAD");
  writeFileSync(join(directory, "notes.txt"), "After\n");
  git("commit", "--quiet", "-am", "Release");
  const target = git("rev-parse", "HEAD");
  let requests = 0;
  const server = createServer((request, response) => {
    void (async () => {
      for await (const chunk of request) void chunk;
      response.setHeader("content-type", "text/event-stream");
      response.end(studioResponse(++requests, base, target));
    })().catch(() => response.writeHead(500).end());
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing provider fixture.");
  let allowUse = false;
  let useChecks = 0;
  const identity = {
    provider: "chatgpt-plan",
    account: "client:subject",
    endpoint: `http://127.0.0.1:${String(address.port)}/v1`,
    model: "fixture-model",
  };
  const registration = VercelAx.chatgptPlanModel({
    ref: ModelRef.of("studio-plan", "client:fixture-model"),
    resolveIdentity: () => identity,
    authorizeUse: () => {
      useChecks++;
      return allowUse;
    },
    connect: () => ({ accessToken: "fixture-token", identity }),
  });
  const studio = await ReleaseStudio.start({
    gitExecutable,
    workerExecutable: process.execPath,
    workerPath: resolve("examples/release-notes/dist/src/trusted/git-worker-main.js"),
    workerCwd: directory,
    plan: {
      activeBinding: () =>
        Promise.resolve({
          clientId: "client",
          subject: "subject",
          model: "fixture-model",
          registration,
        }),
    },
  });
  try {
    const selected = await studio.compare(directory, base, target);
    const draft = await studio.openDraft(selected.selectionId, "Denied", "Users");
    const generation = await studio.requestGeneration(draft.id, "Explain the change");
    let phase = await studio.generationPhase(generation);
    for (let attempt = 0; attempt < 100 && phase !== "terminated"; attempt++) {
      await new Promise((done) => setTimeout(done, 20));
      phase = await studio.generationPhase(generation);
    }
    expect(phase).toBe("terminated");
    expect(requests).toBe(0);
    expect(useChecks).toBe(1);
    const system = await studio.history(draft.id, "system", 20);
    const terminal = system.items.filter((item) =>
      JSON.stringify(item).includes('"reason":"MODEL_USE_DENIED"'),
    );
    expect(terminal).toHaveLength(1);
    expect(await studio.selectionLocked()).toBe(false);
    await expect(
      StudioAccountGate.requireUnlocked(studio, "sign-in", null),
    ).resolves.toBeUndefined();
    await expect(
      StudioAccountGate.run(studio, "select-model", null, () =>
        Promise.reject(new Error("Selection failed.")),
      ),
    ).rejects.toThrow("Selection failed.");
    allowUse = true;
    const later = await studio.requestGeneration(draft.id, "Explain the change again");
    let next = await studio.generationPhase(later);
    for (let attempt = 0; attempt < 100 && next !== "completed"; attempt++) {
      await new Promise((done) => setTimeout(done, 20));
      next = await studio.generationPhase(later);
    }
    expect(next).toBe("completed");
    expect((await studio.readDraft(draft.id)).generationStatus).toBe("staged");
    expect(useChecks).toBe(3);
    expect(requests).toBe(2);
  } finally {
    await studio.close();
    server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

function studioResponse(number: number, base: string, target: string): string {
  const text = JSON.stringify({
    sections: [
      {
        heading: "Changes",
        entries: [
          {
            text: "Changed release file.",
            evidence: [{ commit: { value: target }, parent: { value: base }, path: "notes.txt" }],
          },
        ],
      },
    ],
  });
  const item =
    number === 1
      ? {
          type: "function_call",
          id: "fc-1",
          call_id: "provider-call-1",
          name: "tool_0",
          namespace: "spine_mcp",
          arguments: "{}",
          status: "completed",
        }
      : {
          type: "message",
          id: "msg-2",
          role: "assistant",
          phase: "final_answer",
          content: [{ type: "output_text", text, annotations: [] }],
        };
  const events = [
    {
      type: "response.created",
      response: { id: `resp-${String(number)}`, created_at: number, model: "fixture-model" },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item:
        number === 1
          ? {
              type: "function_call",
              id: "fc-1",
              call_id: "provider-call-1",
              name: "tool_0",
              namespace: "spine_mcp",
              arguments: "{}",
            }
          : { type: "message", id: "msg-2" },
    },
    number === 1
      ? {
          type: "response.function_call_arguments.done",
          item_id: "fc-1",
          output_index: 0,
          arguments: "{}",
        }
      : {
          type: "response.output_text.delta",
          item_id: "msg-2",
          output_index: 0,
          content_index: 0,
          delta: text,
        },
    { type: "response.output_item.done", output_index: 0, item },
    {
      type: "response.completed",
      response: {
        id: `resp-${String(number)}`,
        status: "completed",
        usage: { input_tokens: 10, output_tokens: 8 },
      },
    },
  ];
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}
