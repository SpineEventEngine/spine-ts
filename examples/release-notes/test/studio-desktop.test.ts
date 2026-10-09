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
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import { afterEach, expect, it, vi } from "vitest";
import { VersionSchema } from "@spine-event-engine/proto";

import { ReleaseNotesDocumentSchema } from "../generated/spine/examples/releasenotes/types_pb.js";
import { StudioDesktop } from "../src/trusted/studio-desktop.js";
import type { ReleaseStudio, StudioDraft } from "../src/trusted/studio-service.js";

const native = vi.hoisted(() => ({
  open: vi.fn(),
  save: vi.fn(),
  quit: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { quit: native.quit },
  dialog: { showOpenDialog: native.open, showSaveDialog: native.save },
}));

afterEach(() => {
  vi.clearAllMocks();
});

const window = { destroy: vi.fn() } as unknown as BrowserWindow;
const version = create(VersionSchema, { number: 7 });

it("projects nested committed evidence and approval without credentials", () => {
  const document = create(ReleaseNotesDocumentSchema, {
    sections: [
      {
        heading: "Changes",
        entries: [
          {
            text: "Fix",
            evidence: [
              {
                commit: { value: "a".repeat(40) },
                parent: { value: "b".repeat(40) },
                path: "nested/<fix>.ts",
              },
            ],
          },
        ],
      },
    ],
  });
  const draft: StudioDraft = {
    id: "draft",
    version,
    title: "October",
    audience: "SDK users",
    generationStatus: "approved",
    comparison: {
      selectionId: "selection",
      base: "a",
      target: "b",
      commits: [],
      changes: [],
      evidence: [],
    },
    document,
    approvalDigest: "digest",
  };
  const projected = StudioDesktop.draft(draft);
  expect(projected.version).toEqual(toJson(VersionSchema, version));
  expect(projected.document).toEqual({
    sections: [
      {
        heading: "Changes",
        entries: [
          {
            text: "Fix",
            evidence: [
              {
                commit: { value: "a".repeat(40) },
                parent: { value: "b".repeat(40) },
                path: "nested/<fix>.ts",
              },
            ],
          },
        ],
      },
    ],
  });
  expect(projected.approvalDigest).toBe("digest");
  expect(JSON.stringify(projected)).not.toContain("accessToken");
});

it("cancels native comparison before any Git operation", async () => {
  native.open.mockResolvedValue({ canceled: true, filePaths: [] });
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
    .mockResolvedValueOnce({ canceled: false, filePaths: ["/repo/one", "/repo/two"] })
    .mockResolvedValueOnce({ canceled: false, filePaths: ["/repo/one"] });
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

it("transports editor Version and exact review bytes through trusted actions", async () => {
  const document = create(ReleaseNotesDocumentSchema, {
    sections: [{ heading: "Changes", entries: [] }],
  });
  const draft: StudioDraft = {
    id: "draft",
    version,
    title: "October",
    audience: "SDK users",
    generationStatus: "approved",
    comparison: {
      selectionId: "selection",
      base: "a",
      target: "b",
      commits: [],
      changes: [],
      evidence: [],
    },
    document,
  };
  const bytes = new Uint8Array([35, 32, 65, 10]);
  const edit = vi.fn().mockResolvedValue(draft);
  const approve = vi.fn().mockResolvedValue({ ...draft, approvalDigest: "reviewed" });
  const studio = {
    readDraft: vi.fn().mockResolvedValue(draft),
    openDraft: vi.fn().mockResolvedValue(draft),
    edit,
    preview: vi.fn().mockResolvedValue({ version, markdown: bytes, digest: "reviewed" }),
    approve,
  } as unknown as ReleaseStudio;
  const inputVersion = toJson(VersionSchema, version);
  await expect(
    StudioDesktop.action(window, studio, "read-draft", { id: "draft" }),
  ).resolves.toMatchObject({ id: "draft", version: inputVersion });
  await expect(
    StudioDesktop.action(window, studio, "open-draft", {
      selectionId: "selection",
      title: "October",
      audience: "SDK users",
    }),
  ).resolves.toMatchObject({ id: "draft" });
  const edited = await StudioDesktop.action(window, studio, "edit", {
    id: "draft",
    version: inputVersion,
    document: toJson(ReleaseNotesDocumentSchema, document),
  });
  expect(edited).toMatchObject({ document: { sections: [{ heading: "Changes", entries: [] }] } });
  expect(edit).toHaveBeenCalledWith("draft", version, document);
  await expect(StudioDesktop.action(window, studio, "preview", { id: "draft" })).resolves.toEqual({
    version: inputVersion,
    markdown: bytes,
    digest: "reviewed",
  });
  await expect(
    StudioDesktop.action(window, studio, "approve", {
      id: "draft",
      version: inputVersion,
      markdown: bytes,
    }),
  ).resolves.toMatchObject({ approvalDigest: "reviewed" });
  expect(approve).toHaveBeenCalledWith("draft", version, bytes);
});

it("cancels export before the Command and writes only exact approved bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "spine-desktop-export-"));
  try {
    const destination = join(directory, "notes.md");
    const prepareExport = vi.fn().mockResolvedValue(new Uint8Array([35, 32, 65, 10]));
    const studio = { prepareExport } as unknown as ReleaseStudio;
    const input = { id: "draft", version: toJson(VersionSchema, version) };
    native.save
      .mockResolvedValueOnce({ canceled: true })
      .mockResolvedValueOnce({ canceled: false, filePath: destination });
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

it("closes the in-memory context before destroying the window and quitting", async () => {
  const sequence: string[] = [];
  const studio = {
    close: () => {
      sequence.push("close");
      return Promise.resolve();
    },
  } as unknown as ReleaseStudio;
  native.quit.mockImplementation(() => {
    sequence.push("quit");
  });
  const closing = {
    destroy: () => {
      sequence.push("destroy");
    },
  } as unknown as BrowserWindow;
  await StudioDesktop.action(closing, studio, "stop-quit", null);
  expect(sequence).toEqual(["close", "destroy", "quit"]);
});
