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

import { create, toJson } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserWindow } from "@mobrowser/api";
import { afterEach, expect, it, vi } from "vitest";
import { VersionSchema } from "@spine-event-engine/proto";

import { StudioDesktop } from "../src/trusted/studio-desktop.js";
import { StudioTransport } from "../src/trusted/studio-transport.js";
import type { ReleaseStudio, StudioDraft } from "../src/trusted/studio-service.js";

const native = vi.hoisted(() => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@mobrowser/api", () => ({
  app: { showOpenDialog: native.open, showSaveDialog: native.save },
}));

afterEach(() => {
  vi.clearAllMocks();
});

const window = { destroy: vi.fn() } as unknown as BrowserWindow;
const version = create(VersionSchema, {
  number: 7,
  timestamp: create(TimestampSchema, { seconds: 1n, nanos: 123456789 }),
});

it("projects exact Markdown without credentials", () => {
  const markdown = new TextEncoder().encode("# Café 🐈\n\nTrailing  \n");
  const draft: StudioDraft = {
    id: "draft",
    version,
    title: "October",
    audience: "SDK users",
    generationStatus: "staged",
    comparison: {
      selectionId: "selection",
      projectName: "fixture",
      baseLabel: "base",
      targetLabel: "target",
      base: "a",
      target: "b",
      commits: [],
      changes: [],
      evidence: [],
    },
    markdown,
  };
  const projected = StudioTransport.draft(draft);
  markdown[0] = 0;
  expect(StudioTransport.versionJson(projected.version)).toEqual(toJson(VersionSchema, version));
  expect(projected.markdown).toEqual(Buffer.from("# Café 🐈\n\nTrailing  \n"));
  expect(JSON.stringify(projected)).not.toContain("accessToken");
});

it("cancels native comparison before any Git operation", async () => {
  native.open.mockResolvedValue({ canceled: true, paths: [] });
  const compare = vi.fn();
  const studio = { compare } as unknown as ReleaseStudio;
  await expect(
    StudioDesktop.action(window, studio, "choose-comparison", { base: "a", target: "b" }),
  ).resolves.toBeNull();
  expect(compare).not.toHaveBeenCalled();
});

it("passes exactly the native-selected repository to comparison admission", async () => {
  const compare = vi.fn().mockResolvedValue({ selectionId: "selected" });
  const studio = { compare } as unknown as ReleaseStudio;
  native.open
    .mockResolvedValueOnce({ canceled: false, paths: ["/repo/one", "/repo/two"] })
    .mockResolvedValueOnce({ canceled: false, paths: ["/repo/one"] });
  await expect(
    StudioDesktop.action(window, studio, "choose-comparison", {
      base: "main~1",
      target: "main",
    }),
  ).resolves.toBeNull();
  expect(compare).not.toHaveBeenCalled();
  await expect(
    StudioDesktop.action(window, studio, "choose-comparison", {
      base: "main~1",
      target: "main",
    }),
  ).resolves.toEqual({ selectionId: "selected" });
  expect(compare).toHaveBeenCalledExactlyOnceWith("/repo/one", "main~1", "main");
});

it("returns admitted generation and indexed history through fixed desktop actions", async () => {
  const requestGeneration = vi.fn().mockResolvedValue("generation");
  const history = vi.fn().mockResolvedValue({ items: [{ kind: "recorded" }], cursor: "older" });
  const evidencePatch = vi.fn().mockResolvedValue({ complete: true, patch: "committed patch" });
  const studio = {
    session: () => ({ drafts: ["draft"], generations: { draft: "generation" } }),
    requestGeneration,
    repeatGeneration: vi.fn().mockResolvedValue("generation"),
    generationObservation: vi.fn().mockResolvedValue({ receipt: true, phase: "active" }),
    history,
    evidencePatch,
  } as unknown as ReleaseStudio;
  await expect(StudioDesktop.action(window, studio, "session", null)).resolves.toEqual({
    drafts: ["draft"],
    generations: { draft: "generation" },
  });
  await expect(
    StudioDesktop.action(window, studio, "generate", {
      id: "draft",
      instruction: "Explain changes",
    }),
  ).resolves.toEqual({ generation: "generation" });
  await expect(
    StudioDesktop.action(window, studio, "repeat-generation", {
      generation: "generation",
    }),
  ).resolves.toEqual({ generation: "generation" });
  await expect(
    StudioDesktop.action(window, studio, "phase", {
      generation: "generation",
    }),
  ).resolves.toEqual({ receipt: true, phase: "active" });
  await expect(
    StudioDesktop.action(window, studio, "history", {
      id: "draft",
      category: "domain",
      pageSize: 1,
      cursor: "older",
    }),
  ).resolves.toEqual({ items: [{ kind: "recorded" }], cursor: "older" });
  await expect(
    StudioDesktop.action(window, studio, "evidence-patch", {
      selectionId: "comparison",
      index: 0,
    }),
  ).resolves.toEqual({ complete: true, patch: "committed patch" });
  expect(requestGeneration).toHaveBeenCalledWith("draft", "Explain changes");
  expect(history).toHaveBeenCalledWith("draft", "domain", 1, "older");
  expect(evidencePatch).toHaveBeenCalledWith("comparison", 0);
});

it("transports exact editor bytes, stable draft ID, and cancel through trusted actions", async () => {
  const bytes = new TextEncoder().encode("# Café 🐈\n");
  const draft: StudioDraft = {
    id: "draft",
    version,
    title: "October",
    audience: "SDK users",
    generationStatus: "staged",
    comparison: {
      selectionId: "selection",
      projectName: "fixture",
      baseLabel: "base",
      targetLabel: "target",
      base: "a",
      target: "b",
      commits: [],
      changes: [],
      evidence: [],
    },
    markdown: bytes,
  };
  const edit = vi.fn().mockResolvedValue(draft);
  const cancelGeneration = vi.fn().mockResolvedValue(draft);
  const openDraft = vi.fn().mockResolvedValue(draft);
  const studio = {
    readDraft: vi.fn().mockResolvedValue(draft),
    openDraft,
    edit,
    cancelGeneration,
    preview: vi.fn().mockResolvedValue({ version, markdown: bytes, digest: "snapshot" }),
  } as unknown as ReleaseStudio;
  const inputVersion = toJson(VersionSchema, version);
  await expect(
    StudioDesktop.action(window, studio, "read-draft", { id: "draft" }),
  ).resolves.toMatchObject({ id: "draft", version });
  await expect(
    StudioDesktop.action(window, studio, "open-draft", {
      id: "retained-id",
      selectionId: "selection",
      title: "October",
      audience: "SDK users",
    }),
  ).resolves.toMatchObject({ id: "draft" });
  expect(openDraft).toHaveBeenCalledWith("selection", "October", "SDK users", "retained-id");
  await expect(
    StudioDesktop.action(window, studio, "edit", {
      id: "draft",
      version: inputVersion,
      markdown: bytes,
    }),
  ).resolves.toMatchObject({ markdown: bytes });
  expect(edit).toHaveBeenCalledWith("draft", version, bytes);
  await expect(StudioDesktop.action(window, studio, "preview", { id: "draft" })).resolves.toEqual({
    version: inputVersion,
    markdown: bytes,
    digest: "snapshot",
  });
  await expect(
    StudioDesktop.action(window, studio, "cancel-generation", {
      id: "draft",
      generation: "generation",
    }),
  ).resolves.toMatchObject({ id: "draft" });
  expect(cancelGeneration).toHaveBeenCalledWith("draft", "generation");
});

it("cancels export before the Command and writes only exact saved bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "spine-desktop-export-"));
  try {
    const destination = join(directory, "notes.md");
    const prepareExport = vi.fn().mockResolvedValue(new Uint8Array([35, 32, 65, 10]));
    const studio = { prepareExport } as unknown as ReleaseStudio;
    const input = { id: "draft", version: toJson(VersionSchema, version) };
    native.save
      .mockResolvedValueOnce({ canceled: true })
      .mockResolvedValueOnce({ canceled: false, path: destination });
    await expect(StudioDesktop.action(window, studio, "export", input)).resolves.toEqual({
      saved: false,
    });
    expect(prepareExport).not.toHaveBeenCalled();
    await expect(StudioDesktop.action(window, studio, "export", input)).resolves.toEqual({
      saved: true,
    });
    expect(prepareExport).toHaveBeenCalledWith("draft", version);
    expect(await readFile(destination)).toEqual(Buffer.from([35, 32, 65, 10]));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
