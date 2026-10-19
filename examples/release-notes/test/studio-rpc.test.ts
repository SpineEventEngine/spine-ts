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
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VersionSchema } from "@spine-event-engine/proto";
import { expect, it, vi } from "vitest";
import type { RequestContext } from "@mobrowser/api";
import type { StudioService } from "../src/main/gen/ipc_service.js";
import { registerStudioRpc } from "../src/trusted/studio-rpc.js";
import { StudioTransport } from "../src/trusted/studio-transport.js";

const native = vi.hoisted(() => ({
  registerService: vi.fn(),
  openUrl: vi.fn(),
  clipboardWrite: vi.fn(),
  save: vi.fn(),
  open: vi.fn(),
}));
vi.mock("@mobrowser/api", () => ({
  app: { showSaveDialog: native.save, showOpenDialog: native.open },
  ipc: { registerService: native.registerService },
  workspace: { openUrl: native.openUrl },
  clipboard: { write: native.clipboardWrite },
}));

const setup = () => {
  native.registerService.mockClear();
  const browser = {};
  const auth = {
    status: vi.fn().mockResolvedValue({ accounts: [], pendingClientIds: [], planEnabled: false }),
    signInOrResume: vi.fn(),
    models: vi.fn().mockResolvedValue([{ slug: "account-model", displayName: "Account Model" }]),
    signOut: vi.fn(),
  };
  const plan = { activeBinding: vi.fn().mockResolvedValue(undefined), selectDiscovered: vi.fn() };
  const studio = {
    withAccountTransition: vi.fn((action: () => Promise<unknown>) => action()),
    selectionLocked: vi.fn().mockResolvedValue(false),
    isClosing: vi.fn().mockReturnValue(false),
    openDraft: vi.fn(),
    readDraft: vi.fn(),
    edit: vi.fn(),
    preview: vi.fn(),
    history: vi.fn(),
    prepareExport: vi.fn(),
    session: vi.fn(),
    selectProject: vi.fn(),
    compareProject: vi.fn(),
    compare: vi.fn(),
    evidencePatch: vi.fn(),
    requestGeneration: vi.fn(),
    repeatGeneration: vi.fn(),
    cancelGeneration: vi.fn(),
    generationObservation: vi.fn(),
  };
  registerStudioRpc({
    window: { browser } as never,
    auth: auth as never,
    plan: plan as never,
    studio: studio as never,
  });
  const service = native.registerService.mock.calls[0]?.[1] as unknown as StudioService | undefined;
  if (!service) throw new Error("Studio service was not registered.");
  return { service, browser, auth, plan, studio };
};

it("rejects another browser before reading account state", async () => {
  const { service, browser, auth } = setup();
  await expect(service.Status({}, { browser: {} } as RequestContext)).rejects.toThrow(
    "We could not confirm this action",
  );
  expect(auth.status).not.toHaveBeenCalled();
  await expect(service.Status({}, { browser } as RequestContext)).resolves.toEqual({
    accounts: [],
    pendingClientIds: [],
    planEnabled: false,
  });
});

const draftId = "58bf50ce-7cde-450a-b77c-ae65e79d6f55";
const selectionId = "b3824f16-a999-489f-80bb-67bf99367d48";

const draftFixture = () => ({
  id: draftId,
  version: create(VersionSchema, {
    number: 5,
    timestamp: create(TimestampSchema, { seconds: 1n, nanos: 123456789 }),
  }),
  title: "Release",
  audience: "SDK users",
  comparison: {
    selectionId,
    projectName: "Fixture",
    baseLabel: "before",
    targetLabel: "after",
    base: "a".repeat(40),
    target: "b".repeat(40),
    commits: [],
    changes: [],
    evidence: [],
  },
  generationStatus: "staged",
  markdown: new TextEncoder().encode("# Café\n\nTrailing  \n"),
});

it("maps authoritative drafts and exact edits through the registered service", async () => {
  const { service, browser, studio } = setup();
  const ctx = { browser } as RequestContext;
  const draft = draftFixture();
  studio.openDraft.mockResolvedValue(draft);
  studio.readDraft.mockResolvedValue(draft);
  studio.edit.mockResolvedValue(draft);
  const opened = await service.OpenDraft(
    { id: draftId, selectionId, title: "Release", audience: "SDK users" },
    ctx,
  );
  expect(opened.markdown).toEqual(Buffer.from(draft.markdown));
  expect(StudioTransport.versionJson(opened.version)).toEqual(
    StudioTransport.versionJson(
      StudioTransport.versionWire({
        number: "5",
        timestamp: "1970-01-01T00:00:01.123456789Z",
      }),
    ),
  );
  expect(studio.openDraft).toHaveBeenCalledExactlyOnceWith(
    selectionId,
    "Release",
    "SDK users",
    draftId,
  );
  await expect(
    service.ReadDraft({ id: draftId }, { browser: {} } as RequestContext),
  ).rejects.toThrow("We could not confirm this action");
  expect(studio.readDraft).not.toHaveBeenCalled();
  expect((await service.ReadDraft({ id: draftId }, ctx)).id).toBe(draftId);
  const unsaved = new TextEncoder().encode("# Unsaved\n  exact  \n");
  const edited = await service.Edit(
    { id: draftId, version: opened.version, markdown: Buffer.from(unsaved) },
    ctx,
  );
  expect(studio.edit).toHaveBeenCalledExactlyOnceWith(draftId, draft.version, unsaved);
  expect(edited.markdown).toEqual(Buffer.from(draft.markdown));
});

it("maps preview and native export without changing Markdown bytes", async () => {
  const { service, browser, studio } = setup();
  const ctx = { browser } as RequestContext;
  const draft = draftFixture();
  studio.preview.mockResolvedValue({
    version: draft.version,
    markdown: draft.markdown,
    digest: "verified-digest",
  });
  const preview = await service.Preview({ id: draftId }, ctx);
  expect(preview.markdown).toEqual(Buffer.from(draft.markdown));
  expect(StudioTransport.versionJson(preview.version)).toEqual(
    StudioTransport.versionJson(StudioTransport.draft(draft).version),
  );
  const directory = await mkdtemp(join(tmpdir(), "studio-rpc-export-"));
  try {
    const path = join(directory, "release.md");
    native.save.mockResolvedValue({ canceled: false, path });
    studio.prepareExport.mockResolvedValue(draft.markdown);
    await expect(
      service.ExportMarkdown({ id: draftId, version: preview.version }, ctx),
    ).resolves.toEqual({ saved: true });
    expect(studio.prepareExport).toHaveBeenCalledExactlyOnceWith(draftId, draft.version);
    expect(await readFile(path)).toEqual(Buffer.from(draft.markdown));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("maps history cursor and sanitizes failures before they reach the renderer", async () => {
  const { service, browser, studio, auth } = setup();
  auth.status.mockResolvedValue({
    accounts: [{ clientId: "client", email: "person@example.invalid", planEnabled: true }],
    selectedClientId: "client",
    pendingClientIds: [],
    planEnabled: true,
  });
  const ctx = { browser } as RequestContext;
  studio.history.mockResolvedValue({
    items: [{ kind: "domain", text: "Recorded" }],
    cursor: "older",
  });
  await expect(
    service.History({ id: draftId, category: "domain", pageSize: 3, cursor: "next" }, ctx),
  ).resolves.toEqual({ itemsJson: ['{"kind":"domain","text":"Recorded"}'], cursor: "older" });
  expect(studio.history).toHaveBeenCalledExactlyOnceWith(draftId, "domain", 3, "next");
  studio.history.mockRejectedValue(new Error("secret provider token"));
  await expect(
    service.History({ id: draftId, category: "domain", pageSize: 3 }, ctx),
  ).rejects.toThrow("Activity could not be loaded. Try again.");
  await expect(
    service.History({ id: draftId, category: "domain", pageSize: 3 }, {
      browser: {},
    } as RequestContext),
  ).rejects.toThrow("We could not confirm this action");
});

it("validates model selection and holds the account transition fence", async () => {
  const { service, browser, plan, studio } = setup();
  const ctx = { browser } as RequestContext;
  await expect(
    service.SelectModel({ clientId: "bad id", model: "account-model" }, ctx),
  ).rejects.toThrow("We could not confirm this action");
  expect(plan.selectDiscovered).not.toHaveBeenCalled();
  await expect(
    service.SelectModel({ clientId: "issued-client", model: "account-model" }, ctx),
  ).resolves.toEqual({ model: "account-model" });
  expect(studio.withAccountTransition).toHaveBeenCalledOnce();
  expect(plan.selectDiscovered).toHaveBeenCalledExactlyOnceWith("issued-client", "account-model");
});

it("copies exact unsaved editor text only from the application browser", async () => {
  const { service, browser } = setup();
  native.clipboardWrite.mockClear();
  const markdown = "# Heading\n\nLine with trailing spaces  \n\0";
  await expect(
    service.CopyMarkdown({ markdown }, { browser: {} } as RequestContext),
  ).rejects.toThrow("We could not confirm this action");
  expect(native.clipboardWrite).not.toHaveBeenCalled();
  await expect(service.CopyMarkdown({ markdown }, { browser } as RequestContext)).resolves.toEqual(
    {},
  );
  expect(native.clipboardWrite).toHaveBeenCalledExactlyOnceWith("text/plain", markdown);
});

it("rejects new renderer work after a terminal native close is accepted", async () => {
  const { service, browser, studio, auth } = setup();
  studio.isClosing.mockReturnValue(true);
  await expect(service.Status({}, { browser } as RequestContext)).rejects.toThrow(
    "Could not check your ChatGPT connection. Try again.",
  );
  expect(auth.status).not.toHaveBeenCalled();
});

it("maps account status, discovered models, sign-out, and usage through the registered service", async () => {
  const { service, browser, auth, plan, studio } = setup();
  const ctx = { browser } as RequestContext;
  const status = {
    accounts: [{ clientId: "issued-client", label: "Work" }],
    pendingClientIds: [],
    planEnabled: true,
  };
  auth.status.mockResolvedValue(status);
  auth.signInOrResume.mockResolvedValue(status);
  auth.signOut.mockResolvedValue({ status, revocationConfirmed: true });
  plan.activeBinding.mockResolvedValue({ model: "account-model" });
  expect(await service.Status({}, ctx)).toEqual(status);
  expect(await service.CurrentModel({}, ctx)).toEqual({ model: "account-model" });
  expect(await service.SignIn({}, ctx)).toEqual(status);
  expect(await service.Models({ clientId: "issued-client" }, ctx)).toEqual({
    models: [{ slug: "account-model", displayName: "Account Model" }],
  });
  expect(await service.SignOut({ clientId: "issued-client" }, ctx)).toEqual({
    status,
    revocationConfirmed: true,
  });
  expect(auth.signOut).toHaveBeenCalledExactlyOnceWith("issued-client");
  native.openUrl.mockClear();
  expect(await service.ManageUsage({}, ctx)).toEqual({});
  expect(native.openUrl).toHaveBeenCalledExactlyOnceWith("https://chatgpt.com/#settings/usage");
  expect(studio.withAccountTransition).toHaveBeenCalledTimes(2);
});

it("maps session, native project selection, comparisons, and committed evidence", async () => {
  const { service, browser, studio } = setup();
  const ctx = { browser } as RequestContext;
  const comparison = draftFixture().comparison;
  studio.session.mockReturnValue({ drafts: [draftId], generations: {} });
  expect(await service.Session({}, ctx)).toEqual({ drafts: [draftId], generations: {} });
  native.open.mockResolvedValueOnce({ canceled: true, paths: [] });
  expect(await service.ChooseProject({}, ctx)).toEqual({});
  expect(studio.selectProject).not.toHaveBeenCalled();
  native.open.mockResolvedValueOnce({ canceled: false, paths: ["/tmp/release-repo"] });
  studio.selectProject.mockResolvedValue({ handle: selectionId, name: "Repo", refs: ["main"] });
  expect(await service.ChooseProject({}, ctx)).toEqual({
    project: { handle: selectionId, name: "Repo", refs: ["main"] },
  });
  expect(studio.selectProject).toHaveBeenCalledExactlyOnceWith("/tmp/release-repo");
  studio.compareProject.mockResolvedValue(comparison);
  expect(
    await service.CompareProject({ handle: selectionId, base: "main", target: "next" }, ctx),
  ).toEqual(comparison);
  expect(studio.compareProject).toHaveBeenCalledExactlyOnceWith(selectionId, "main", "next");
  native.open.mockResolvedValueOnce({ canceled: true, paths: [] });
  expect(await service.ChooseComparison({ base: "main", target: "next" }, ctx)).toEqual({});
  native.open.mockResolvedValueOnce({ canceled: false, paths: ["/tmp/release-repo"] });
  studio.compare.mockResolvedValue(comparison);
  expect(await service.ChooseComparison({ base: "main", target: "next" }, ctx)).toEqual({
    comparison,
  });
  expect(studio.compare).toHaveBeenCalledExactlyOnceWith("/tmp/release-repo", "main", "next");
  studio.evidencePatch.mockResolvedValue({ complete: true, patch: "diff --git a/a b/a\n" });
  expect(await service.EvidencePatch({ selectionId, index: 0 }, ctx)).toEqual({
    complete: true,
    patch: "diff --git a/a b/a\n",
  });
  expect(studio.evidencePatch).toHaveBeenCalledExactlyOnceWith(selectionId, 0);
});

it("routes generation admission, repeat, cancellation, phase, and optional history", async () => {
  const { service, browser, studio, auth } = setup();
  const ctx = { browser } as RequestContext;
  const generation = "cdfbca32-1027-4ef6-80e6-7b7178f20dcf";
  studio.requestGeneration.mockResolvedValue(generation);
  studio.repeatGeneration.mockResolvedValue(generation);
  studio.cancelGeneration.mockResolvedValue(draftFixture());
  studio.generationObservation.mockResolvedValue({ receipt: true, phase: "running" });
  expect(await service.Generate({ id: draftId, instruction: "Focus on migration" }, ctx)).toEqual({
    generation,
  });
  expect(studio.requestGeneration).toHaveBeenCalledExactlyOnceWith(draftId, "Focus on migration");
  expect(await service.RepeatGeneration({ generation }, ctx)).toEqual({ generation });
  expect(studio.repeatGeneration).toHaveBeenCalledExactlyOnceWith(generation);
  const canceled = await service.CancelGeneration({ id: draftId, generation }, ctx);
  expect(canceled.markdown).toEqual(Buffer.from(draftFixture().markdown));
  expect(studio.cancelGeneration).toHaveBeenCalledExactlyOnceWith(draftId, generation);
  expect(await service.Phase({ generation }, ctx)).toEqual({ receipt: true, phase: "running" });
  expect(studio.generationObservation).toHaveBeenCalledExactlyOnceWith(generation);
  studio.history.mockResolvedValue({ items: [], cursor: undefined });
  auth.status.mockResolvedValue({
    accounts: [{ clientId: "client", email: "person@example.invalid", planEnabled: true }],
    selectedClientId: "client",
    pendingClientIds: [],
    planEnabled: true,
  });
  expect(await service.History({ id: draftId, category: "all", pageSize: 1 }, ctx)).toEqual({
    itemsJson: [],
  });
  expect(studio.history).toHaveBeenCalledExactlyOnceWith(draftId, "all", 1, undefined);
});

it("rejects signed-out history reads at the trusted bridge", async () => {
  const { service, browser, studio } = setup();
  await expect(
    service.History({ id: draftId, category: "all", pageSize: 20 }, { browser } as RequestContext),
  ).rejects.toThrow();
  expect(studio.history).not.toHaveBeenCalled();
});

it("does not return an in-flight history page after account sign-out", async () => {
  const { service, browser, studio, auth } = setup();
  const pending = Promise.withResolvers<{ items: unknown[] }>();
  studio.history.mockReturnValue(pending.promise);
  auth.status
    .mockResolvedValueOnce({ selectedClientId: "client", planEnabled: true })
    .mockResolvedValue({ selectedClientId: undefined, planEnabled: false });
  const read = service.History({ id: draftId, category: "all", pageSize: 20 }, {
    browser,
  } as RequestContext);
  await vi.waitFor(() => {
    expect(studio.history).toHaveBeenCalledOnce();
  });
  pending.resolve({ items: [{ conversationRecord: { id: { value: "private" } } }] });
  await expect(read).rejects.toThrow("Activity could not be loaded");
});

it("returns cancellation for native export without preparing or writing Markdown", async () => {
  const { service, browser, studio } = setup();
  native.save.mockResolvedValue({ canceled: true });
  const version = StudioTransport.draft(draftFixture()).version;
  expect(
    await service.ExportMarkdown({ id: draftId, version }, { browser } as RequestContext),
  ).toEqual({ saved: false });
  expect(studio.prepareExport).not.toHaveBeenCalled();
});
