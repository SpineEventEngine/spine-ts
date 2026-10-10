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

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StudioPanel, type StudioBridge } from "../src/studio-ui.js";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const labeled = (name: string, index: number): HTMLElement => {
  const element = screen.getAllByLabelText(name)[index];
  if (!element) throw new Error(`Missing ${name} control.`);
  return element;
};

const buttonAt = (name: string, index: number): HTMLElement => {
  const element = screen.getAllByRole("button", { name })[index];
  if (!element) throw new Error(`Missing ${name} button.`);
  return element;
};

const phaseText: Record<string, string> = {
  accepted: "Writing",
  active: "Writing",
  completed: "Writing finished",
  rejected: "Needs attention",
  unknown: "Checking status",
  terminated: "Stopped",
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

const editableDraft = () => ({
  id: "draft",
  version: { number: "1" },
  title: "Release",
  audience: "Users",
  comparison: { selectionId: "s", base: "a", target: "b", commits: [], changes: [], evidence: [] },
  generationStatus: "staged",
  document: { sections: [{ heading: "Changes", entries: [{ text: "First", evidence: [] }] }] },
});

it("keeps text typed after Save begins and requires saving before review", async () => {
  const draft = editableDraft();
  const pending = deferred<unknown>();
  const edit = vi.fn<StudioBridge["edit"]>(
    () => pending.promise as ReturnType<StudioBridge["edit"]>,
  );
  const preview = vi.fn<StudioBridge["preview"]>();
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () => Promise.resolve({ drafts: [draft.id], generations: {} }),
      readDraft: () => Promise.resolve(draft),
      edit,
      preview,
    },
  });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  const entry = await screen.findByLabelText("Entry");
  fireEvent.change(entry, { target: { value: "Saved text" } });
  fireEvent.click(screen.getByRole("button", { name: "Save edits" }));
  fireEvent.change(entry, { target: { value: "Later text" } });
  await act(async () => {
    pending.resolve({
      ...draft,
      version: { number: "2" },
      document: {
        sections: [{ heading: "Changes", entries: [{ text: "Saved text", evidence: [] }] }],
      },
    });
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(screen.getByLabelText<HTMLInputElement>("Entry").value).toBe("Later text");
  });
  fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
  expect(screen.getByRole("button", { name: "Refresh preview" })).toHaveProperty("disabled", true);
  expect(preview).not.toHaveBeenCalled();
});

it("does not submit a clean approved draft or a second Save while the first is pending", async () => {
  const draft = { ...editableDraft(), generationStatus: "approved", approvalDigest: "approved" };
  const pending = deferred<unknown>();
  const edit = vi.fn<StudioBridge["edit"]>(
    () => pending.promise as ReturnType<StudioBridge["edit"]>,
  );
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () => Promise.resolve({ drafts: [draft.id], generations: {} }),
      readDraft: () => Promise.resolve(draft),
      edit,
    },
  });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  await screen.findByLabelText("Entry");
  const save = screen.getByRole("button", { name: "Save edits" });
  expect(save).toHaveProperty("disabled", true);
  fireEvent.click(save);
  expect(edit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Entry"), { target: { value: "Changed" } });
  fireEvent.click(screen.getByRole("button", { name: "Save edits" }));
  expect(screen.getByRole("button", { name: "Saving edits…" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "Saving edits…" }));
  expect(edit).toHaveBeenCalledTimes(1);
  await act(async () => {
    pending.resolve({ ...draft, version: { number: "2" } });
    await Promise.resolve();
  });
});

it("allows a failed Save to be tried again without losing unsaved text", async () => {
  const draft = editableDraft();
  const edit = vi
    .fn<StudioBridge["edit"]>()
    .mockRejectedValueOnce(new Error("save failed"))
    .mockImplementationOnce((_id, _version, document) =>
      Promise.resolve({ ...draft, version: { number: "2" }, document }),
    );
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () => Promise.resolve({ drafts: [draft.id], generations: {} }),
      readDraft: () => Promise.resolve(draft),
      edit,
    },
  });
  const notice = vi.fn();
  render(<StudioPanel modelReady notice={notice} />);
  fireEvent.change(await screen.findByLabelText("Entry"), { target: { value: "Keep my text" } });
  fireEvent.click(screen.getByRole("button", { name: "Save edits" }));
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Save edits" })).toHaveProperty("disabled", false);
  });
  expect(screen.getByLabelText<HTMLInputElement>("Entry").value).toBe("Keep my text");
  fireEvent.click(screen.getByRole("button", { name: "Save edits" }));
  await waitFor(() => {
    expect(edit).toHaveBeenCalledTimes(2);
  });
  expect(notice).toHaveBeenCalled();
});

it("keeps a newer edit paired with the original Version when Refresh finishes later", async () => {
  const draft = editableDraft();
  const newer = {
    ...draft,
    version: { number: "2" },
    document: {
      sections: [{ heading: "Changes", entries: [{ text: "New Agent result", evidence: [] }] }],
    },
  };
  const refresh = deferred<unknown>();
  const edit = vi.fn<StudioBridge["edit"]>(() => Promise.reject(new Error("stale Version")));
  let reads = 0;
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () => Promise.resolve({ drafts: [draft.id], generations: {} }),
      readDraft: () => (++reads === 1 ? Promise.resolve(draft) : refresh.promise),
      edit,
    },
  });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  const entry = await screen.findByLabelText("Entry");
  fireEvent.click(screen.getByRole("button", { name: "Refresh draft" }));
  fireEvent.change(entry, { target: { value: "My later edit" } });
  await act(async () => {
    refresh.resolve(newer);
    await Promise.resolve();
  });
  fireEvent.click(screen.getByRole("button", { name: "Save edits" }));
  await waitFor(() => {
    expect(edit).toHaveBeenCalledOnce();
  });
  expect(edit.mock.calls[0]?.[1]).toEqual(draft.version);
  expect(edit.mock.calls[0]?.[2].sections[0]?.entries[0]?.text).toBe("My later edit");
});

it("lets Refresh replace unsaved edits only when no newer typing follows", async () => {
  const draft = editableDraft();
  const current = {
    ...draft,
    version: { number: "2" },
    document: {
      sections: [{ heading: "Changes", entries: [{ text: "Current draft", evidence: [] }] }],
    },
  };
  const edit = vi.fn<StudioBridge["edit"]>(() => Promise.reject(new Error("test stop")));
  let reads = 0;
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () => Promise.resolve({ drafts: [draft.id], generations: {} }),
      readDraft: () => Promise.resolve(++reads === 1 ? draft : current),
      edit,
    },
  });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  fireEvent.change(await screen.findByLabelText("Entry"), { target: { value: "Unsaved edit" } });
  fireEvent.click(screen.getByRole("button", { name: "Refresh draft" }));
  await waitFor(() => {
    expect(screen.getByLabelText<HTMLInputElement>("Entry").value).toBe("Current draft");
  });
  fireEvent.change(screen.getByLabelText("Entry"), { target: { value: "New edit" } });
  fireEvent.click(screen.getByRole("button", { name: "Save edits" }));
  await waitFor(() => {
    expect(edit).toHaveBeenCalledOnce();
  });
  expect(edit.mock.calls[0]?.[1]).toEqual(current.version);
});

it("ignores an old Refresh that finishes after a new draft selection starts", async () => {
  const first = { ...editableDraft(), id: "first", title: "First release" };
  const second = { ...editableDraft(), id: "second", title: "Second release" };
  const refresh = deferred<unknown>();
  const selectSecond = deferred<unknown>();
  let firstReads = 0;
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () => Promise.resolve({ drafts: [first.id, second.id], generations: {} }),
      readDraft: (id: string) =>
        id === first.id
          ? ++firstReads === 3
            ? refresh.promise
            : Promise.resolve(first)
          : selectSecond.promise,
    },
  });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  // Initial load includes both drafts; release the second before selecting the first.
  await act(async () => {
    selectSecond.resolve(second);
    await Promise.resolve();
  });
  const picker = await screen.findByLabelText("Session drafts");
  fireEvent.change(picker, { target: { value: first.id } });
  expect(await screen.findByRole("heading", { name: first.title })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Refresh draft" }));
  fireEvent.change(picker, { target: { value: second.id } });
  await act(async () => {
    refresh.resolve({ ...first, version: { number: "2" } });
    await Promise.resolve();
  });
  expect(await screen.findByRole("heading", { name: second.title })).toBeTruthy();
});

it("does not show an older draft after its delayed Save completes during another selection", async () => {
  const first = { ...editableDraft(), id: "first", title: "First release" };
  const second = { ...editableDraft(), id: "second", title: "Second release" };
  const pending = deferred<unknown>();
  const edit = vi.fn<StudioBridge["edit"]>(
    () => pending.promise as ReturnType<StudioBridge["edit"]>,
  );
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () => Promise.resolve({ drafts: [first.id, second.id], generations: {} }),
      readDraft: (id: string) => Promise.resolve(id === first.id ? first : second),
      edit,
    },
  });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  const picker = await screen.findByLabelText("Session drafts");
  fireEvent.change(picker, { target: { value: first.id } });
  expect(await screen.findByRole("heading", { name: first.title })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Entry"), { target: { value: "Changed first" } });
  fireEvent.click(screen.getByRole("button", { name: "Save edits" }));
  fireEvent.change(picker, { target: { value: second.id } });
  expect(await screen.findByRole("heading", { name: second.title })).toBeTruthy();
  await act(async () => {
    pending.resolve({ ...first, version: { number: "2" } });
    await Promise.resolve();
  });
  expect(screen.getByRole("heading", { name: second.title })).toBeTruthy();
});

it("ignores an exported draft read that finishes after another selection", async () => {
  const first = {
    ...editableDraft(),
    id: "first",
    title: "First release",
    approvalDigest: "approved",
  };
  const second = { ...editableDraft(), id: "second", title: "Second release" };
  const oldRead = deferred<unknown>();
  let firstReads = 0;
  const readDraft = vi.fn((id: string) =>
    id === first.id
      ? ++firstReads === 3
        ? oldRead.promise
        : Promise.resolve(first)
      : Promise.resolve(second),
  );
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () => Promise.resolve({ drafts: [first.id, second.id], generations: {} }),
      readDraft,
      exportApproved: () => Promise.resolve({ saved: true }),
    },
  });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  const picker = await screen.findByLabelText("Session drafts");
  fireEvent.change(picker, { target: { value: first.id } });
  expect(await screen.findByRole("heading", { name: first.title })).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
  fireEvent.click(screen.getByRole("button", { name: "Export release notes" }));
  await waitFor(() => {
    expect(firstReads).toBe(3);
  });
  fireEvent.change(picker, { target: { value: second.id } });
  expect(await screen.findByRole("heading", { name: second.title })).toBeTruthy();
  await act(async () => {
    oldRead.resolve({ ...first, version: { number: "2" } });
    await Promise.resolve();
  });
  expect(screen.getByRole("heading", { name: second.title })).toBeTruthy();
});

it("ignores an old picker session response after another draft is selected", async () => {
  const first = { ...editableDraft(), id: "first", title: "First release" };
  const second = { ...editableDraft(), id: "second", title: "Second release" };
  const oldSession = deferred<{ drafts: string[]; generations: Record<string, string> }>();
  let sessionReads = 0;
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () =>
        ++sessionReads === 2
          ? oldSession.promise
          : Promise.resolve({ drafts: [first.id, second.id], generations: {} }),
      readDraft: (id: string) => Promise.resolve(id === first.id ? first : second),
    },
  });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  const picker = await screen.findByLabelText("Session drafts");
  fireEvent.change(picker, { target: { value: first.id } });
  await waitFor(() => {
    expect(sessionReads).toBe(2);
  });
  fireEvent.change(picker, { target: { value: second.id } });
  expect(await screen.findByRole("heading", { name: second.title })).toBeTruthy();
  await act(async () => {
    oldSession.resolve({ drafts: [first.id, second.id], generations: {} });
    await Promise.resolve();
  });
  expect(screen.getByRole("heading", { name: second.title })).toBeTruthy();
});

it("does not apply an old Save after selecting A, then B, then A again", async () => {
  const first = { ...editableDraft(), id: "first", title: "First release" };
  const latest = { ...first, version: { number: "3" } };
  const second = { ...editableDraft(), id: "second", title: "Second release" };
  const pending = deferred<unknown>();
  let firstReads = 0;
  const edit = vi
    .fn<StudioBridge["edit"]>()
    .mockReturnValueOnce(pending.promise as ReturnType<StudioBridge["edit"]>)
    .mockRejectedValueOnce(new Error("stale Version"));
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () => Promise.resolve({ drafts: [first.id, second.id], generations: {} }),
      readDraft: (id: string) =>
        Promise.resolve(
          id === first.id && ++firstReads >= 3 ? latest : id === first.id ? first : second,
        ),
      edit,
    },
  });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  const picker = await screen.findByLabelText("Session drafts");
  fireEvent.change(picker, { target: { value: first.id } });
  expect(await screen.findByRole("heading", { name: first.title })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Entry"), { target: { value: "Old edit" } });
  fireEvent.click(screen.getByRole("button", { name: "Save edits" }));
  fireEvent.change(picker, { target: { value: second.id } });
  expect(await screen.findByRole("heading", { name: second.title })).toBeTruthy();
  fireEvent.change(picker, { target: { value: first.id } });
  expect(await screen.findByRole("heading", { name: first.title })).toBeTruthy();
  await act(async () => {
    pending.resolve({ ...first, version: { number: "2" } });
    await Promise.resolve();
  });
  fireEvent.change(screen.getByLabelText("Entry"), { target: { value: "Current edit" } });
  fireEvent.click(screen.getByRole("button", { name: "Save edits" }));
  await waitFor(() => {
    expect(edit).toHaveBeenCalledTimes(2);
  });
  expect(edit.mock.calls[1]?.[1]).toEqual(latest.version);
});

it("does not bind an old generation after choosing another draft", async () => {
  const first = { ...editableDraft(), id: "first", title: "First release", generationStatus: "" };
  const second = {
    ...editableDraft(),
    id: "second",
    title: "Second release",
    generationStatus: "",
  };
  const pending = deferred<unknown>();
  const phase = vi.fn<StudioBridge["phase"]>(() =>
    Promise.resolve({ receipt: true, phase: "active" }),
  );
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () => Promise.resolve({ drafts: [first.id, second.id], generations: {} }),
      readDraft: (id: string) => Promise.resolve(id === first.id ? first : second),
      generate: () => pending.promise,
      phase,
    },
  });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  const picker = await screen.findByLabelText("Session drafts");
  fireEvent.change(picker, { target: { value: first.id } });
  expect(await screen.findByRole("heading", { name: first.title })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Write a draft" }));
  fireEvent.change(picker, { target: { value: second.id } });
  expect(await screen.findByRole("heading", { name: second.title })).toBeTruthy();
  await act(async () => {
    pending.resolve({ generation: "old-generation" });
    await Promise.resolve();
  });
  expect(screen.getByRole("heading", { name: second.title })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Write a draft" })).toHaveProperty("disabled", false);
  expect(phase).not.toHaveBeenCalledWith("old-generation");
});

it("does not show an old lost-acknowledgment warning after switching drafts", async () => {
  const first = { ...editableDraft(), id: "first", title: "First release", generationStatus: "" };
  const second = {
    ...editableDraft(),
    id: "second",
    title: "Second release",
    generationStatus: "",
  };
  const pending = deferred<unknown>();
  const notice = vi.fn();
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () => Promise.resolve({ drafts: [first.id, second.id], generations: {} }),
      readDraft: (id: string) => Promise.resolve(id === first.id ? first : second),
      generate: () => pending.promise,
    },
  });
  render(<StudioPanel modelReady notice={notice} />);
  const picker = await screen.findByLabelText("Session drafts");
  fireEvent.change(picker, { target: { value: first.id } });
  expect(await screen.findByRole("heading", { name: first.title })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Write a draft" }));
  fireEvent.change(picker, { target: { value: second.id } });
  expect(await screen.findByRole("heading", { name: second.title })).toBeTruthy();
  await act(async () => {
    pending.reject(new Error("old acknowledgment lost"));
    await Promise.resolve();
  });
  expect(screen.getByRole("button", { name: "Write a draft" })).toHaveProperty("disabled", false);
  expect(notice).not.toHaveBeenCalledWith(expect.stringContaining("old acknowledgment"));
});

it("explains a stopped Agent without claiming the draft is ready", async () => {
  const draft = { ...editableDraft(), generationStatus: "requested" };
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () =>
        Promise.resolve({ drafts: [draft.id], generations: { [draft.id]: "generation" } }),
      readDraft: () => Promise.resolve(draft),
      phase: () => Promise.resolve({ receipt: true, phase: "terminated" }),
    },
  });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  expect(await screen.findByRole("status")).toHaveProperty("textContent", "Stopped");
  expect(
    await screen.findByText(/Check your account and model, then refresh the draft/),
  ).toBeTruthy();
  expect(screen.queryByText("Draft ready")).toBeNull();
});

it("does not bind an old explicit retry after another draft is selected", async () => {
  const first = {
    ...editableDraft(),
    id: "first",
    title: "First release",
    generationStatus: "requested",
  };
  const second = {
    ...editableDraft(),
    id: "second",
    title: "Second release",
    generationStatus: "",
  };
  const pending = deferred<unknown>();
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () =>
        Promise.resolve({
          drafts: [first.id, second.id],
          generations: { [first.id]: "first-generation" },
        }),
      readDraft: (id: string) => Promise.resolve(id === first.id ? first : second),
      phase: () => Promise.resolve({ receipt: false, phase: "unknown" }),
      repeatGeneration: () => pending.promise,
    },
  });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  const picker = await screen.findByLabelText("Session drafts");
  fireEvent.change(picker, { target: { value: first.id } });
  expect(await screen.findByRole("button", { name: "Retry saved draft" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry saved draft" }));
  fireEvent.change(picker, { target: { value: second.id } });
  expect(await screen.findByRole("heading", { name: second.title })).toBeTruthy();
  await act(async () => {
    pending.resolve({ generation: "first-generation" });
    await Promise.resolve();
  });
  expect(screen.getByRole("button", { name: "Write a draft" })).toHaveProperty("disabled", false);
  expect(screen.queryByRole("button", { name: "Retry saved draft" })).toBeNull();
});

it.each(["approve", "export"] as const)(
  "does not apply an old %s completion after switching drafts",
  async (action) => {
    const first = {
      ...editableDraft(),
      id: "first",
      title: "First release",
      approvalDigest: action === "export" ? "approved" : undefined,
    };
    const second = { ...editableDraft(), id: "second", title: "Second release" };
    const pending = deferred<unknown>();
    const notice = vi.fn();
    const readDraft = vi.fn((id: string) => Promise.resolve(id === first.id ? first : second));
    Object.defineProperty(window, "releaseNotes", {
      configurable: true,
      value: {
        session: () => Promise.resolve({ drafts: [first.id, second.id], generations: {} }),
        readDraft,
        preview: () =>
          Promise.resolve({
            version: first.version,
            markdown: new TextEncoder().encode("# First"),
            digest: "d",
          }),
        approve: () => pending.promise,
        exportApproved: () => pending.promise,
      },
    });
    render(<StudioPanel modelReady notice={notice} />);
    const picker = await screen.findByLabelText("Session drafts");
    fireEvent.change(picker, { target: { value: first.id } });
    expect(await screen.findByRole("heading", { name: first.title })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
    if (action === "approve") {
      fireEvent.click(screen.getByRole("button", { name: "Refresh preview" }));
      fireEvent.click(await screen.findByRole("button", { name: "Approve release notes" }));
    } else fireEvent.click(screen.getByRole("button", { name: "Export release notes" }));
    fireEvent.change(picker, { target: { value: second.id } });
    expect(await screen.findByRole("heading", { name: second.title })).toBeTruthy();
    await act(async () => {
      pending.resolve(
        action === "approve" ? { ...first, version: { number: "2" } } : { saved: true },
      );
      await Promise.resolve();
    });
    expect(screen.getByRole("heading", { name: second.title })).toBeTruthy();
    expect(notice).not.toHaveBeenCalledWith("Approved Markdown exported.");
    if (action === "export") expect(readDraft).toHaveBeenCalledTimes(4);
  },
);

it("keeps the later draft choice when earlier reads finish last", async () => {
  const first = { ...editableDraft(), id: "first", title: "First release" };
  const second = { ...editableDraft(), id: "second", title: "Second release" };
  const oldRead = deferred<unknown>();
  const newRead = deferred<unknown>();
  let initial = 0;
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () => Promise.resolve({ drafts: [first.id, second.id], generations: {} }),
      readDraft: (id: string) => {
        if (initial++ < 2) return Promise.resolve(id === first.id ? first : second);
        return id === first.id ? oldRead.promise : newRead.promise;
      },
    },
  });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  const picker = await screen.findByLabelText("Session drafts");
  fireEvent.change(picker, { target: { value: first.id } });
  fireEvent.change(picker, { target: { value: second.id } });
  await act(async () => {
    newRead.resolve(second);
    await Promise.resolve();
  });
  expect(screen.getByRole("heading", { name: second.title })).toBeTruthy();
  await act(async () => {
    oldRead.resolve(first);
    await Promise.resolve();
  });
  expect(screen.getByRole("heading", { name: second.title })).toBeTruthy();
});

it("does not replace a newly opened draft when initial session loading finishes", async () => {
  const old = { ...editableDraft(), id: "old", title: "Earlier release" };
  const opened = { ...editableDraft(), id: "opened", title: "New release" };
  const initialSession = deferred<unknown>();
  const comparison = opened.comparison;
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () => initialSession.promise,
      readDraft: () => Promise.resolve(old),
      chooseComparison: () => Promise.resolve(comparison),
      openDraft: () => Promise.resolve(opened),
    },
  });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Choose repository" }));
  fireEvent.change(await screen.findByLabelText("Release title"), {
    target: { value: opened.title },
  });
  fireEvent.change(screen.getByLabelText("Audience"), { target: { value: "Users" } });
  fireEvent.click(screen.getByRole("button", { name: "Open release draft" }));
  expect(await screen.findByRole("heading", { name: opened.title })).toBeTruthy();
  await act(async () => {
    initialSession.resolve({ drafts: [old.id], generations: {} });
    await Promise.resolve();
  });
  expect(screen.getByRole("heading", { name: opened.title })).toBeTruthy();
});

it("does not show a preview returned after the document changes", async () => {
  const draft = editableDraft();
  const pending = deferred<unknown>();
  const preview = vi.fn<StudioBridge["preview"]>(
    () => pending.promise as ReturnType<StudioBridge["preview"]>,
  );
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () => Promise.resolve({ drafts: [draft.id], generations: {} }),
      readDraft: () => Promise.resolve(draft),
      preview,
    },
  });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  await screen.findByLabelText("Entry");
  fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh preview" }));
  fireEvent.click(screen.getByRole("tab", { name: "Write" }));
  fireEvent.change(screen.getByLabelText("Entry"), { target: { value: "Changed meanwhile" } });
  await act(async () => {
    pending.resolve({
      version: draft.version,
      markdown: new TextEncoder().encode("Old"),
      digest: "old",
    });
    await Promise.resolve();
  });
  fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
  await waitFor(() => {
    expect(screen.queryByText("Old")).toBeNull();
  });
  expect(screen.getByRole("button", { name: "Refresh preview" })).toHaveProperty("disabled", true);
});

it("does not restore an old preview after the authoritative draft changes", async () => {
  const draft = editableDraft();
  const newer = {
    ...draft,
    version: { number: "2" },
    document: {
      sections: [{ heading: "Changes", entries: [{ text: "Current", evidence: [] }] }],
    },
  };
  const pending = deferred<unknown>();
  let reads = 0;
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () => Promise.resolve({ drafts: [draft.id], generations: {} }),
      readDraft: () => Promise.resolve(++reads === 1 ? draft : newer),
      preview: () => pending.promise,
    },
  });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  fireEvent.click(await screen.findByRole("tab", { name: "Preview" }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh preview" }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh draft" }));
  await waitFor(() => {
    expect(reads).toBe(2);
  });
  await act(async () => {
    pending.resolve({
      version: draft.version,
      markdown: new TextEncoder().encode("Old"),
      digest: "old",
    });
    await Promise.resolve();
  });
  expect(screen.queryByText("Old")).toBeNull();
  expect(screen.getByText("Your preview will appear here.")).toBeTruthy();
});

it("does not show a preview after the user starts choosing another draft", async () => {
  const first = { ...editableDraft(), id: "first", title: "First release" };
  const second = { ...editableDraft(), id: "second", title: "Second release" };
  const pendingPreview = deferred<unknown>();
  const pendingSelection = deferred<unknown>();
  let secondReads = 0;
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () => Promise.resolve({ drafts: [first.id, second.id], generations: {} }),
      readDraft: (id: string) =>
        id === first.id
          ? Promise.resolve(first)
          : ++secondReads === 1
            ? Promise.resolve(second)
            : pendingSelection.promise,
      preview: () => pendingPreview.promise,
    },
  });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  const picker = await screen.findByLabelText("Session drafts");
  fireEvent.change(picker, { target: { value: first.id } });
  expect(await screen.findByRole("heading", { name: first.title })).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh preview" }));
  fireEvent.change(picker, { target: { value: second.id } });
  await act(async () => {
    pendingPreview.resolve({
      version: first.version,
      markdown: new TextEncoder().encode("Old preview"),
      digest: "old",
    });
    await Promise.resolve();
  });
  expect(screen.queryByText("Old preview")).toBeNull();
  await act(async () => {
    pendingSelection.resolve(second);
    await Promise.resolve();
  });
  expect(screen.getByRole("heading", { name: second.title })).toBeTruthy();
});

it("shows failed writing as needing attention even when earlier notes remain", async () => {
  const draft = { ...editableDraft(), generationStatus: "failed:PROVIDER_UNAVAILABLE" };
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () => Promise.resolve({ drafts: [draft.id], generations: {} }),
      readDraft: () => Promise.resolve(draft),
    },
  });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  expect(await screen.findByRole("status")).toHaveProperty("textContent", "Needs attention");
  expect(screen.queryByText("PROVIDER_UNAVAILABLE")).toBeNull();
});

it("shows failed writing as needing attention without prior notes", async () => {
  const draft = {
    ...editableDraft(),
    generationStatus: "failed:PROVIDER_UNAVAILABLE",
    document: { sections: [] },
  };
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () => Promise.resolve({ drafts: [draft.id], generations: {} }),
      readDraft: () => Promise.resolve(draft),
    },
  });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  expect(await screen.findByRole("status")).toHaveProperty("textContent", "Needs attention");
});

it.each([
  ["AUTHENTICATION_REQUIRED", "Check your account and selected model"],
  ["BUDGET_EXCEEDED", "Choose fewer changes"],
  ["RATE_LIMITED", "Wait a little"],
  ["INVALID_OUTPUT", "Review the changes"],
  ["UNAVAILABLE", "OpenAI is unavailable"],
  ["DEADLINE_EXCEEDED", "Writing took too long"],
  ["TOOL_OUTCOME_UNKNOWN", "source lookup"],
  ["UNRECOGNIZED", "Review the current draft"],
])("explains %s without exposing a raw failure code", async (code, explanation) => {
  const draft = { ...editableDraft(), generationStatus: `failed:${code}` };
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () => Promise.resolve({ drafts: [draft.id], generations: {} }),
      readDraft: () => Promise.resolve(draft),
    },
  });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  expect(await screen.findByText(new RegExp(explanation))).toBeTruthy();
  expect(screen.queryByText(code)).toBeNull();
});

it("shows inert link and image destinations and the exact Markdown bytes", async () => {
  const draft = editableDraft();
  const markdown =
    "[Guide](https://example.invalid/guide) ![Screen](https://example.invalid/screen.png)\n\n<b>Literal HTML</b>";
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () => Promise.resolve({ drafts: [draft.id], generations: {} }),
      readDraft: () => Promise.resolve(draft),
      preview: () =>
        Promise.resolve({
          version: draft.version,
          markdown: new TextEncoder().encode(markdown),
          digest: "digest",
        }),
    },
  });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  fireEvent.click(await screen.findByRole("tab", { name: "Preview" }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh preview" }));
  const rendered = await screen.findByLabelText("Release notes preview");
  expect(rendered.textContent).toContain("Guide (https://example.invalid/guide)");
  expect(rendered.textContent).toContain("Image: Screen (https://example.invalid/screen.png)");
  expect(rendered.querySelector("a, img, b")).toBeNull();
  fireEvent.click(screen.getByText("Show export text"));
  expect(document.querySelector(".export-text pre")?.textContent).toBe(markdown);
});

it("does not open a comparison after From or To changes", async () => {
  const chosen = {
    selectionId: "original",
    base: "a".repeat(40),
    target: "b".repeat(40),
    commits: [],
    changes: [],
    evidence: [],
  };
  const pending = deferred<unknown>();
  const chooseComparison = vi
    .fn<StudioBridge["chooseComparison"]>()
    .mockResolvedValueOnce(chosen)
    .mockReturnValueOnce(pending.promise as ReturnType<StudioBridge["chooseComparison"]>);
  const openDraft = vi.fn<StudioBridge["openDraft"]>();
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () => Promise.resolve({ drafts: [], generations: {} }),
      chooseComparison,
      openDraft,
    },
  });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Choose repository" }));
  expect(await screen.findByRole("button", { name: "Open release draft" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "older" } });
  expect(screen.queryByRole("button", { name: "Open release draft" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Choose repository" }));
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "newer" } });
  await act(async () => {
    pending.resolve(chosen);
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(screen.queryByRole("button", { name: "Open release draft" })).toBeNull();
  });
  expect(openDraft).not.toHaveBeenCalled();
});

it("saves multiple edited sections and selected citations with the displayed Version", async () => {
  const initial = {
    id: "draft",
    version: { number: "4" },
    title: "Release",
    audience: "Users",
    comparison: {
      selectionId: "selection",
      base: "a",
      target: "b",
      commits: [],
      changes: [],
      evidence: [
        { commit: "a".repeat(40), parent: "b".repeat(40), path: "src/change.ts", status: "M" },
      ],
    },
    generationStatus: "staged",
    document: {
      sections: [
        {
          heading: "Overview",
          entries: [
            { text: "Initial", evidence: [] },
            { text: "Remove this", evidence: [] },
          ],
        },
        { heading: "Details", entries: [{ text: "Keep this", evidence: [] }] },
      ],
    },
  };
  const edit = vi.fn<StudioBridge["edit"]>((_id, _version, document) =>
    Promise.resolve({ ...initial, version: { number: "5" }, document }),
  );
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () => Promise.resolve({ drafts: [initial.id], generations: {} }),
      readDraft: () => Promise.resolve(initial),
      edit,
    },
  });
  const notice = vi.fn();
  const { rerender } = render(<StudioPanel modelReady notice={notice} />);
  await screen.findByRole("heading", { name: "Release" });
  fireEvent.change(labeled("Section title", 0), {
    target: { value: "Highlights" },
  });
  rerender(<StudioPanel modelReady notice={notice} />);
  const heading = labeled("Section title", 0);
  if (!(heading instanceof HTMLInputElement)) throw new Error("Section title is missing.");
  expect(heading.value).toBe("Highlights");
  fireEvent.change(labeled("Entry", 0), { target: { value: "Updated" } });
  const picker = labeled("Sources for this entry", 0);
  if (!(picker instanceof HTMLSelectElement)) throw new Error("Citation picker is missing.");
  const citation = picker.options[0];
  if (!citation) throw new Error("Citation option is missing.");
  citation.selected = true;
  fireEvent.change(picker);
  fireEvent.click(buttonAt("Remove entry", 1));
  fireEvent.click(buttonAt("Add entry", 1));
  fireEvent.change(labeled("Entry", 2), { target: { value: "Another detail" } });
  fireEvent.click(screen.getByRole("button", { name: "Save edits" }));
  await waitFor(() => {
    expect(edit).toHaveBeenCalledOnce();
  });
  expect(edit.mock.calls[0]?.[1]).toEqual(initial.version);
  expect(edit.mock.calls[0]?.[2]).toEqual({
    sections: [
      {
        heading: "Highlights",
        entries: [
          {
            text: "Updated",
            evidence: [
              {
                commit: { value: "a".repeat(40) },
                parent: { value: "b".repeat(40) },
                path: "src/change.ts",
              },
            ],
          },
        ],
      },
      {
        heading: "Details",
        entries: [
          { text: "Keep this", evidence: [] },
          { text: "Another detail", evidence: [] },
        ],
      },
    ],
  });
});

it("offers an explicit repeat of the retained generation after an uncertain submission", async () => {
  const draft = {
    id: "draft",
    version: { number: "1" },
    title: "Release",
    audience: "Users",
    comparison: {
      selectionId: "selection",
      base: "a",
      target: "b",
      commits: [],
      changes: [],
      evidence: [],
    },
    generationStatus: "",
    document: { sections: [] },
  };
  let retained = false;
  const repeatGeneration = vi.fn(() => Promise.resolve({ generation: "original-generation" }));
  const bridge = {
    session: () =>
      Promise.resolve({
        drafts: [draft.id],
        generations: retained ? { [draft.id]: "original-generation" } : {},
      }),
    readDraft: () => Promise.resolve(draft),
    generate: () => {
      retained = true;
      return Promise.reject(new Error("Acknowledgment lost"));
    },
    phase: () => Promise.resolve({ phase: undefined, receipt: false }),
    repeatGeneration,
  } as unknown as StudioBridge;
  Object.defineProperty(window, "releaseNotes", { configurable: true, value: bridge });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  fireEvent.change(await screen.findByLabelText("What should readers know?"), {
    target: { value: "Original instruction" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Write a draft" }));
  const repeat = await screen.findByRole("button", { name: "Retry saved draft" });
  fireEvent.change(screen.getByLabelText("What should readers know?"), {
    target: { value: "Changed instruction" },
  });
  fireEvent.click(repeat);
  await waitFor(() => {
    expect(repeatGeneration).toHaveBeenCalledWith("original-generation");
  });
});

it("does not turn a completed generation into an unconfirmed retry after a new preadmission failure", async () => {
  const draft = {
    id: "draft",
    version: { number: "2" },
    title: "Release",
    audience: "Users",
    comparison: {
      selectionId: "s",
      base: "a",
      target: "b",
      commits: [],
      changes: [],
      evidence: [],
    },
    generationStatus: "staged",
    document: { sections: [] },
  };
  const generate = vi.fn(() => Promise.reject(new Error("No plan model is available.")));
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () =>
        Promise.resolve({
          drafts: [draft.id],
          generations: { [draft.id]: "completed-generation" },
        }),
      readDraft: () => Promise.resolve(draft),
      phase: () => Promise.resolve({ receipt: true, phase: "completed" }),
      generate,
    },
  });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  await waitFor(() => {
    expect(screen.getByText(/Writing finished/)).toBeTruthy();
  });
  fireEvent.click(screen.getByRole("button", { name: "Write a draft" }));
  await waitFor(() => {
    expect(generate).toHaveBeenCalledOnce();
  });
  expect(screen.getByText(/Writing finished/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Retry saved draft" })).toBeNull();
});

it("keeps the observed Agent phase when a newly retained generation loses its acknowledgment", async () => {
  const draft = {
    id: "draft",
    version: { number: "2" },
    title: "Release",
    audience: "Users",
    comparison: {
      selectionId: "s",
      base: "a",
      target: "b",
      commits: [],
      changes: [],
      evidence: [],
    },
    generationStatus: "staged",
    document: { sections: [] },
  };
  let latest = "old-generation";
  let newReads = 0;
  const phase = vi.fn((generation: string) => {
    if (generation === "old-generation")
      return Promise.resolve({ receipt: true, phase: "completed" });
    newReads++;
    return newReads === 1
      ? Promise.resolve({ receipt: true, phase: "active" })
      : new Promise<{ receipt: boolean; phase: string }>(() => undefined);
  });
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () => Promise.resolve({ drafts: [draft.id], generations: { [draft.id]: latest } }),
      readDraft: () => Promise.resolve(draft),
      phase,
      generate: () => {
        latest = "new-generation";
        return Promise.reject(new Error("Ack lost"));
      },
    },
  });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  await waitFor(() => {
    expect(screen.getByText(/Writing finished/)).toBeTruthy();
  });
  fireEvent.click(screen.getByRole("button", { name: "Write a draft" }));
  await waitFor(() => {
    expect(newReads).toBeGreaterThan(0);
  });
  expect(screen.getByRole("status").textContent).toBe("Writing");
  expect(screen.queryByRole("button", { name: "Retry saved draft" })).toBeNull();
});

it("leaves a draft ready after generation fails before any Command is retained", async () => {
  const draft = {
    id: "draft",
    version: { number: "1" },
    title: "Release",
    audience: "Users",
    comparison: {
      selectionId: "s",
      base: "a",
      target: "b",
      commits: [],
      changes: [],
      evidence: [],
    },
    generationStatus: "",
    document: { sections: [] },
  };
  const notice = vi.fn();
  const generate = vi.fn(() => Promise.reject(new Error("No plan model is available.")));
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () => Promise.resolve({ drafts: [draft.id], generations: {} }),
      readDraft: () => Promise.resolve(draft),
      generate,
    },
  });
  render(<StudioPanel modelReady notice={notice} />);
  await screen.findByRole("heading", { name: "Release" });
  fireEvent.click(screen.getByRole("button", { name: "Write a draft" }));
  await waitFor(() => {
    expect(generate).toHaveBeenCalledOnce();
  });
  expect(screen.queryByRole("button", { name: "Retry saved draft" })).toBeNull();
  expect(screen.getByRole("button", { name: "Write a draft" })).toHaveProperty("disabled", false);
  expect(notice).toHaveBeenCalledWith(
    "The draft action is unconfirmed. Read the current draft before another action.",
  );
  expect(JSON.stringify(notice.mock.calls)).not.toContain("No plan model is available.");
});

it("shows an accepted generation awaiting Agent execution without offering a retry", async () => {
  const draft = {
    id: "draft",
    version: { number: "1" },
    title: "Release",
    audience: "Users",
    comparison: {
      selectionId: "s",
      base: "a",
      target: "b",
      commits: [],
      changes: [],
      evidence: [],
    },
    generationStatus: "requested",
    document: { sections: [] },
  };
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () =>
        Promise.resolve({ drafts: [draft.id], generations: { [draft.id]: "generation" } }),
      readDraft: () => Promise.resolve(draft),
      phase: () => Promise.resolve({ receipt: true, phase: undefined }),
    },
  });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  await waitFor(() => {
    expect(screen.getByText(/Writing/)).toBeTruthy();
  });
  expect(screen.getByRole("button", { name: "Write a draft" })).toHaveProperty("disabled", true);
  expect(screen.queryByRole("button", { name: "Retry saved draft" })).toBeNull();
});

it.each([
  ["accepted", { receipt: true, phase: undefined }],
  ["rejected", { receipt: false, rejection: "inputs-conflict" }],
] as const)(
  "reconciles a newly retained %s outcome after lost acknowledgment",
  async (phase, observed) => {
    const draft = {
      id: "draft",
      version: { number: "1" },
      title: "Release",
      audience: "Users",
      comparison: {
        selectionId: "s",
        base: "a",
        target: "b",
        commits: [],
        changes: [],
        evidence: [],
      },
      generationStatus: "",
      document: { sections: [] },
    };
    let retained = false;
    Object.defineProperty(window, "releaseNotes", {
      configurable: true,
      value: {
        session: () =>
          Promise.resolve({
            drafts: [draft.id],
            generations: retained ? { [draft.id]: "generation" } : {},
          }),
        readDraft: () => Promise.resolve(draft),
        generate: () => {
          retained = true;
          return Promise.reject(new Error("Ack lost"));
        },
        phase: () => Promise.resolve(observed),
      },
    });
    render(<StudioPanel modelReady notice={vi.fn()} />);
    await screen.findByRole("heading", { name: "Release" });
    fireEvent.click(screen.getByRole("button", { name: "Write a draft" }));
    await waitFor(() => {
      expect(screen.getByText(phaseText[phase] ?? "Unexpected phase")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "Retry saved draft" })).toBeNull();
  },
);

it("shows a correlated rejected generation and offers a fresh draft instead of retry", async () => {
  const draft = {
    id: "draft",
    version: { number: "2" },
    title: "Release",
    audience: "Users",
    comparison: {
      selectionId: "selection",
      base: "a",
      target: "b",
      commits: [],
      changes: [],
      evidence: [],
    },
    generationStatus: "edited",
    document: { sections: [] },
  };
  let attempts = 0;
  const generate = vi.fn(() => {
    attempts++;
    return attempts === 1
      ? Promise.reject(new Error("Generation inputs changed; read the current draft."))
      : Promise.resolve({ generation: "fresh-generation" });
  });
  const bridge = {
    session: () =>
      Promise.resolve({ drafts: [draft.id], generations: { [draft.id]: "old-generation" } }),
    readDraft: () => Promise.resolve(draft),
    generate,
    phase: () => Promise.resolve({ receipt: false, rejection: "inputs-conflict" }),
  } as unknown as StudioBridge;
  Object.defineProperty(window, "releaseNotes", { configurable: true, value: bridge });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  await screen.findByRole("heading", { name: "Release" });
  expect(screen.getByRole("tab", { name: "Write" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Sources" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Preview" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Activity" })).toBeTruthy();
  await waitFor(() => {
    expect(screen.getByText(/Needs attention/)).toBeTruthy();
  });
  expect(screen.queryByRole("button", { name: "Retry saved draft" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Write a draft" }));
  await waitFor(() => {
    expect(generate).toHaveBeenCalledOnce();
  });
  expect(screen.queryByRole("button", { name: "Retry saved draft" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Write a draft" }));
  await waitFor(() => {
    expect(generate).toHaveBeenCalledTimes(2);
  });
});

it.each([
  ["rejected", { receipt: false, rejection: "inputs-conflict" }],
  ["completed", { receipt: true, phase: "completed" }],
] as const)(
  "keeps a known %s generation when the subsequent draft reread fails",
  async (phase, observed) => {
    const draft = {
      id: "draft",
      version: { number: "2" },
      title: "Release",
      audience: "Users",
      comparison: {
        selectionId: "s",
        base: "a",
        target: "b",
        commits: [],
        changes: [],
        evidence: [],
      },
      generationStatus: "edited",
      document: { sections: [] },
    };
    let reads = 0;
    const failedRead = Promise.withResolvers<undefined>();
    Object.defineProperty(window, "releaseNotes", {
      configurable: true,
      value: {
        session: () =>
          Promise.resolve({ drafts: [draft.id], generations: { [draft.id]: "rejected" } }),
        readDraft: () => {
          if (++reads === 1) return Promise.resolve(draft);
          failedRead.resolve(undefined);
          return Promise.reject(new Error("private storage error"));
        },
        phase: () => Promise.resolve(observed),
      },
    });
    render(<StudioPanel modelReady notice={vi.fn()} />);
    await screen.findByRole("heading", { name: "Release" });
    await act(async () => {
      await failedRead.promise;
    });
    expect(screen.getByText(phaseText[phase] ?? "Unexpected phase")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Write a draft" })).toHaveProperty("disabled", false);
    expect(screen.queryByRole("button", { name: "Retry saved draft" })).toBeNull();
  },
);

it("keeps the displayed draft locked when the Agent phase cannot be read", async () => {
  const draft = {
    id: "draft",
    version: { number: "4" },
    title: "Release",
    audience: "Users",
    comparison: {
      selectionId: "s",
      base: "a",
      target: "b",
      commits: [],
      changes: [],
      evidence: [],
    },
    generationStatus: "active",
    document: { sections: [{ heading: "Notes", entries: [{ text: "Preserve", evidence: [] }] }] },
  };
  const readDraft = vi.fn(() => Promise.resolve(draft));
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () =>
        Promise.resolve({ drafts: [draft.id], generations: { [draft.id]: "pending" } }),
      readDraft,
      phase: () => Promise.reject(new Error("private Agent storage detail")),
    },
  });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  expect(await screen.findByRole("heading", { name: "Release" })).toBeTruthy();
  await waitFor(() => {
    expect(screen.getByText(/Checking status/)).toBeTruthy();
  });
  expect(screen.getByLabelText("Entry")).toHaveProperty("value", "Preserve");
  expect(screen.getByRole("button", { name: "Write a draft" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "Retry saved draft" })).toBeTruthy();
  expect(readDraft).toHaveBeenCalledOnce();
  expect(screen.queryByText("private Agent storage detail")).toBeNull();
});

it("shows a newer Agent draft when the displayed document has no local edits", async () => {
  const initial = {
    id: "draft",
    version: { number: "1" },
    title: "Release",
    audience: "Users",
    comparison: {
      selectionId: "s",
      base: "a",
      target: "b",
      commits: [],
      changes: [],
      evidence: [],
    },
    generationStatus: "active",
    document: { sections: [{ heading: "Notes", entries: [{ text: "Before", evidence: [] }] }] },
  };
  const staged = {
    ...initial,
    version: { number: "2" },
    generationStatus: "staged",
    document: { sections: [{ heading: "Notes", entries: [{ text: "After", evidence: [] }] }] },
  };
  let reads = 0;
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () =>
        Promise.resolve({ drafts: [initial.id], generations: { [initial.id]: "generation" } }),
      readDraft: () => Promise.resolve(++reads === 1 ? initial : staged),
      phase: () => Promise.resolve({ receipt: true, phase: "completed" }),
    },
  });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  await waitFor(() => {
    expect(screen.getByLabelText("Entry")).toHaveProperty("value", "After");
  });
  expect(screen.getByText(/Draft ready/)).toBeTruthy();
});

it("keeps a dirty document paired with its original Version after a later Agent result", async () => {
  let releasePhase: (() => void) | undefined;
  const phaseGate = new Promise<void>((resolve) => {
    releasePhase = resolve;
  });
  const original = {
    id: "draft",
    version: { number: "1" },
    title: "Release",
    audience: "Users",
    comparison: {
      selectionId: "selection",
      base: "a",
      target: "b",
      commits: [],
      changes: [],
      evidence: [],
    },
    generationStatus: "active",
    document: {
      sections: [{ heading: "Changes", entries: [{ text: "Old claim", evidence: [] }] }],
    },
  };
  const newer = { ...original, version: { number: "2" }, generationStatus: "staged" };
  const edit = vi.fn<StudioBridge["edit"]>(() =>
    Promise.reject(
      new Error(
        "Error invoking remote method: The draft changed. Read the current draft before trying again.",
      ),
    ),
  );
  let reads = 0;
  const bridge = {
    session: () =>
      Promise.resolve({ drafts: [original.id], generations: { [original.id]: "generation" } }),
    readDraft: () => Promise.resolve(++reads === 1 ? original : newer),
    phase: async () => {
      await phaseGate;
      return { phase: "completed" };
    },
    edit,
  } as unknown as StudioBridge;
  Object.defineProperty(window, "releaseNotes", { configurable: true, value: bridge });
  const notice = vi.fn();
  render(<StudioPanel modelReady notice={notice} />);
  expect(screen.getByText(/committed changes between them/)).toBeTruthy();
  const claim = await screen.findByLabelText("Entry");
  fireEvent.change(claim, { target: { value: "Unsaved claim" } });
  await waitFor(() => {
    expect(screen.getByLabelText("Entry")).toHaveProperty("value", "Unsaved claim");
  });
  releasePhase?.();
  await waitFor(() => {
    expect(notice).toHaveBeenCalledWith(expect.stringContaining("Read the current draft"));
  });
  fireEvent.click(screen.getByRole("button", { name: "Save edits" }));
  await waitFor(() => {
    expect(edit).toHaveBeenCalled();
  });
  expect(edit.mock.calls[0]?.[1]).toEqual(original.version);
  expect(edit.mock.calls[0]?.[2]).toEqual({
    sections: [{ heading: "Changes", entries: [{ text: "Unsaved claim", evidence: [] }] }],
  });
  await waitFor(() => {
    expect(notice).toHaveBeenCalledWith(
      "The draft changed. Read the current draft before trying again.",
    );
  });
});

it("ignores a delayed generation read after the user selects another draft", async () => {
  const first = {
    id: "A",
    version: { number: "1" },
    title: "First",
    audience: "Users",
    comparison: {
      selectionId: "s",
      base: "a",
      target: "b",
      commits: [],
      changes: [],
      evidence: [],
    },
    generationStatus: "active",
    document: { sections: [] },
  };
  const second = { ...first, id: "B", title: "Second" };
  const delayed = Promise.withResolvers<typeof first>();
  let firstReads = 0;
  const bridge = {
    session: () =>
      Promise.resolve({
        drafts: [second.id, first.id],
        generations: { [first.id]: "generation-A" },
      }),
    readDraft: (id: string) =>
      id === first.id && ++firstReads > 1
        ? delayed.promise
        : Promise.resolve(id === first.id ? first : second),
    phase: () => Promise.resolve({ receipt: true, phase: "active" }),
  } as unknown as StudioBridge;
  Object.defineProperty(window, "releaseNotes", { configurable: true, value: bridge });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  await screen.findByRole("heading", { name: "First" });
  await waitFor(() => {
    expect(firstReads).toBe(2);
  });
  fireEvent.change(screen.getByLabelText("Session drafts"), { target: { value: "B" } });
  await screen.findByRole("heading", { name: "Second" });
  await act(async () => {
    delayed.resolve({ ...first, version: { number: "2" }, title: "Stale First" });
    await delayed.promise;
  });
  await waitFor(() => {
    expect(screen.queryByRole("heading", { name: "Stale First" })).toBeNull();
  });
  expect(screen.getByRole("heading", { name: "Second" })).toBeTruthy();
});

it("keeps an explicit newer Version when an earlier poll for the same draft finishes late", async () => {
  const draft = {
    id: "draft",
    version: { number: "1" },
    title: "Original",
    audience: "Users",
    comparison: {
      selectionId: "s",
      base: "a",
      target: "b",
      commits: [],
      changes: [],
      evidence: [],
    },
    generationStatus: "active",
    document: { sections: [] },
  };
  const pending = Promise.withResolvers<typeof draft>();
  const current = { ...draft, version: { number: "3" }, title: "Current" };
  let reads = 0;
  const bridge = {
    session: () =>
      Promise.resolve({ drafts: [draft.id], generations: { [draft.id]: "generation" } }),
    readDraft: () =>
      ++reads === 2 ? pending.promise : Promise.resolve(reads === 1 ? draft : current),
    phase: () => Promise.resolve({ receipt: true, phase: "active" }),
  } as unknown as StudioBridge;
  Object.defineProperty(window, "releaseNotes", { configurable: true, value: bridge });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  await screen.findByRole("heading", { name: "Original" });
  await waitFor(() => {
    expect(reads).toBe(2);
  });
  fireEvent.click(screen.getByRole("button", { name: "Refresh draft" }));
  await screen.findByRole("heading", { name: "Current" });
  await act(async () => {
    pending.resolve({ ...draft, version: { number: "2" }, title: "Stale" });
    await pending.promise;
  });
  expect(screen.getByRole("heading", { name: "Current" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Stale" })).toBeNull();
});

it("does not overlap interval reads while an earlier generation snapshot is pending", async () => {
  const draft = {
    id: "draft",
    version: { number: "1" },
    title: "Release",
    audience: "Users",
    comparison: {
      selectionId: "s",
      base: "a",
      target: "b",
      commits: [],
      changes: [],
      evidence: [],
    },
    generationStatus: "active",
    document: { sections: [] },
  };
  const pending = Promise.withResolvers<typeof draft>();
  let reads = 0;
  const bridge = {
    session: () =>
      Promise.resolve({ drafts: [draft.id], generations: { [draft.id]: "generation" } }),
    readDraft: () => (++reads === 2 ? pending.promise : Promise.resolve(draft)),
    phase: () => Promise.resolve({ receipt: true, phase: "active" }),
  } as unknown as StudioBridge;
  Object.defineProperty(window, "releaseNotes", { configurable: true, value: bridge });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  await screen.findByRole("heading", { name: "Release" });
  await waitFor(() => {
    expect(reads).toBe(2);
  });
  await new Promise((resolve) => setTimeout(resolve, 1600));
  expect(reads).toBe(2);
  pending.resolve(draft);
});

it("keeps delayed and duplicate history pages within the selected view", async () => {
  const draft = {
    id: "draft",
    version: { number: "1" },
    title: "Release",
    audience: "Users",
    comparison: {
      selectionId: "s",
      base: "a",
      target: "b",
      commits: [],
      changes: [],
      evidence: [],
    },
    generationStatus: "",
    document: { sections: [] },
  };
  const oldAll = Promise.withResolvers<{ items: readonly unknown[]; cursor?: string }>();
  const older = Promise.withResolvers<{ items: readonly unknown[]; cursor?: string }>();
  const history = vi.fn<StudioBridge["history"]>((_id, category, _size, cursor) => {
    if (category === "all") return oldAll.promise;
    if (cursor) return older.promise;
    return Promise.resolve({ items: [{ systemEvent: { message: "new" } }], cursor: "next" });
  });
  const bridge = {
    session: () => Promise.resolve({ drafts: [draft.id], generations: {} }),
    readDraft: () => Promise.resolve(draft),
    history,
  } as unknown as StudioBridge;
  Object.defineProperty(window, "releaseNotes", { configurable: true, value: bridge });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  fireEvent.click(await screen.findByRole("tab", { name: "Activity" }));
  const panel = await screen.findByRole("region", { name: "Activity" });
  fireEvent.click(within(panel).getByRole("button", { name: "Load activity" }));
  fireEvent.change(within(panel).getByLabelText("View"), { target: { value: "system" } });
  fireEvent.click(within(panel).getByRole("button", { name: "Load activity" }));
  await within(panel).findByText("Progress update");
  const button = await within(panel).findByRole("button", { name: "Earlier activity" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(history.mock.calls.filter((call) => call[3] === "next")).toHaveLength(1);
  oldAll.resolve({ items: [{ domainEvent: { message: "stale" } }], cursor: "stale" });
  older.resolve({ items: [{ systemEvent: { message: "older" } }] });
  await waitFor(() => {
    expect(within(panel).getAllByText("Progress update")).toHaveLength(2);
  });
  expect(within(panel).queryByText("Draft update")).toBeNull();
});

it("retries an unavailable history page without losing its cursor or changing views", async () => {
  const draft = {
    id: "draft",
    version: { number: "1" },
    title: "Release",
    audience: "Users",
    comparison: {
      selectionId: "s",
      base: "a",
      target: "b",
      commits: [],
      changes: [],
      evidence: [],
    },
    generationStatus: "",
    document: { sections: [] },
  };
  let olderAttempts = 0;
  const history = vi.fn<StudioBridge["history"]>((_id, category, _size, cursor) => {
    if (category === "system" && cursor === "next") {
      olderAttempts++;
      return olderAttempts === 1
        ? Promise.reject(new Error("private provider details"))
        : Promise.resolve({ items: [{ systemEvent: { message: "older" } }] });
    }
    return Promise.resolve({ items: [{ systemEvent: { message: "first" } }], cursor: "next" });
  });
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () => Promise.resolve({ drafts: [draft.id], generations: {} }),
      readDraft: () => Promise.resolve(draft),
      history,
    },
  });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  fireEvent.click(await screen.findByRole("tab", { name: "Activity" }));
  const panel = await screen.findByRole("region", { name: "Activity" });
  fireEvent.change(within(panel).getByLabelText("View"), { target: { value: "system" } });
  fireEvent.click(within(panel).getByRole("button", { name: "Load activity" }));
  fireEvent.click(await within(panel).findByRole("button", { name: "Earlier activity" }));
  expect((await within(panel).findByRole("status")).textContent).toContain("unavailable");
  expect(within(panel).queryByText("private provider details")).toBeNull();
  fireEvent.click(within(panel).getByRole("button", { name: "Earlier activity" }));
  await waitFor(() => {
    expect(within(panel).getAllByText("Progress update")).toHaveLength(2);
  });
  expect(history.mock.calls.filter((call) => call[3] === "next")).toHaveLength(2);
});

it("recovers from an initial history read failure without losing the selected draft", async () => {
  const draft = {
    id: "draft",
    version: { number: "1" },
    title: "Release",
    audience: "Users",
    comparison: {
      selectionId: "s",
      base: "a",
      target: "b",
      commits: [],
      changes: [],
      evidence: [],
    },
    generationStatus: "",
    document: { sections: [] },
  };
  const history = vi
    .fn<StudioBridge["history"]>()
    .mockRejectedValueOnce(new Error("private history detail"))
    .mockResolvedValueOnce({ items: [{ domainEvent: { message: "ready" } }] });
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () => Promise.resolve({ drafts: [draft.id], generations: {} }),
      readDraft: () => Promise.resolve(draft),
      history,
    },
  });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  fireEvent.click(await screen.findByRole("tab", { name: "Activity" }));
  const panel = await screen.findByRole("region", { name: "Activity" });
  fireEvent.change(within(panel).getByLabelText("View"), { target: { value: "domain" } });
  fireEvent.click(within(panel).getByRole("button", { name: "Load activity" }));
  expect((await within(panel).findByRole("status")).textContent).toContain("unavailable");
  expect(within(panel).queryByText("private history detail")).toBeNull();
  fireEvent.click(within(panel).getByRole("button", { name: "Load activity" }));
  expect(await within(panel).findByText("Draft update")).toBeTruthy();
  expect(history).toHaveBeenCalledTimes(2);
});

it("ignores an old history view's delayed failure after changing categories", async () => {
  const draft = {
    id: "draft",
    version: { number: "1" },
    title: "Release",
    audience: "Users",
    comparison: {
      selectionId: "s",
      base: "a",
      target: "b",
      commits: [],
      changes: [],
      evidence: [],
    },
    generationStatus: "",
    document: { sections: [] },
  };
  const old = Promise.withResolvers<{ items: unknown[] }>();
  const history = vi.fn<StudioBridge["history"]>((_id, category) =>
    category === "all" ? old.promise : Promise.resolve({ items: [{ systemEvent: {} }] }),
  );
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () => Promise.resolve({ drafts: [draft.id], generations: {} }),
      readDraft: () => Promise.resolve(draft),
      history,
    },
  });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  fireEvent.click(await screen.findByRole("tab", { name: "Activity" }));
  const panel = await screen.findByRole("region", { name: "Activity" });
  fireEvent.click(within(panel).getByRole("button", { name: "Load activity" }));
  await waitFor(() => {
    expect(history).toHaveBeenCalledWith("draft", "all", 20, undefined);
  });
  fireEvent.change(within(panel).getByLabelText("View"), { target: { value: "system" } });
  fireEvent.click(within(panel).getByRole("button", { name: "Load activity" }));
  expect(await within(panel).findByText("Progress update")).toBeTruthy();
  old.reject(new Error("private old history detail"));
  await act(async () => {
    await Promise.resolve();
  });
  expect(within(panel).queryByRole("status")).toBeNull();
  expect(within(panel).getByText("Progress update")).toBeTruthy();
});

it("keeps the current draft when native comparison selection is cancelled", async () => {
  const draft = {
    id: "draft",
    version: { number: "1" },
    title: "Existing release",
    audience: "Users",
    comparison: {
      selectionId: "s",
      base: "a",
      target: "b",
      commits: [],
      changes: [],
      evidence: [],
    },
    generationStatus: "",
    document: { sections: [] },
  };
  const chooseComparison = vi.fn(() => Promise.resolve(null));
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () => Promise.resolve({ drafts: [draft.id], generations: {} }),
      readDraft: () => Promise.resolve(draft),
      chooseComparison,
    },
  });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  await screen.findByRole("heading", { name: "Existing release" });
  fireEvent.click(screen.getByRole("button", { name: "Choose repository" }));
  await waitFor(() => {
    expect(chooseComparison).toHaveBeenCalledOnce();
  });
  expect(screen.getByRole("heading", { name: "Existing release" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "Existing release" })).toBeTruthy();
});

it("keeps recorded evidence available after a patch read fails and is retried", async () => {
  const draft = {
    id: "draft",
    version: { number: "1" },
    title: "Release",
    audience: "Users",
    comparison: {
      selectionId: "selection",
      base: "base",
      target: "target",
      commits: [],
      changes: [],
      evidence: [{ commit: "a".repeat(40), parent: "b".repeat(40), path: "notes.md", status: "M" }],
    },
    generationStatus: "",
    document: { sections: [] },
  };
  let unavailable = true;
  const evidencePatch = vi.fn<StudioBridge["evidencePatch"]>(() =>
    unavailable
      ? Promise.reject(new Error("private Git diagnostics"))
      : Promise.resolve({ complete: true, patch: "+Visible committed change" }),
  );
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () => Promise.resolve({ drafts: [draft.id], generations: {} }),
      readDraft: () => Promise.resolve(draft),
      evidencePatch,
    },
  });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  fireEvent.click(await screen.findByRole("tab", { name: "Sources" }));
  const select = await screen.findByLabelText("Choose a change to inspect");
  fireEvent.change(select, { target: { value: "0" } });
  expect(await screen.findByText("This committed patch is unavailable.")).toBeTruthy();
  expect(screen.queryByText("private Git diagnostics")).toBeNull();
  unavailable = false;
  fireEvent.change(select, { target: { value: "0" } });
  expect((await screen.findByLabelText("Change details")).textContent).toContain(
    "+Visible committed change",
  );
  expect(evidencePatch).toHaveBeenCalledTimes(2);
});

it("shows only the latest selected change when an earlier patch finishes later", async () => {
  const draft = {
    id: "draft",
    version: { number: "1" },
    title: "Release",
    audience: "Users",
    comparison: {
      selectionId: "selection",
      base: "base",
      target: "target",
      commits: [],
      changes: [],
      evidence: ["first.ts", "second.ts"].map((path) => ({
        commit: "a".repeat(40),
        parent: "b".repeat(40),
        path,
        status: "M",
      })),
    },
    generationStatus: "",
    document: { sections: [] },
  };
  const pending = new Map<number, (result: { complete: boolean; patch: string }) => void>();
  const evidencePatch = vi.fn<StudioBridge["evidencePatch"]>(
    (_selection, index) =>
      new Promise((resolve) => {
        pending.set(index, resolve);
      }),
  );
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () => Promise.resolve({ drafts: [draft.id], generations: {} }),
      readDraft: () => Promise.resolve(draft),
      evidencePatch,
    },
  });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  fireEvent.click(await screen.findByRole("tab", { name: "Sources" }));
  const select = screen.getByLabelText("Choose a change to inspect");
  fireEvent.change(select, { target: { value: "0" } });
  fireEvent.change(select, { target: { value: "1" } });
  await act(async () => {
    pending.get(1)?.({ complete: true, patch: "+Second change" });
    await Promise.resolve();
  });
  expect(screen.getByLabelText("Change details").textContent).toContain("+Second change");
  await act(async () => {
    pending.get(0)?.({ complete: true, patch: "+First change" });
    await Promise.resolve();
  });
  expect(screen.getByLabelText("Change details").textContent).toContain("+Second change");
  expect(screen.queryByText("+First change")).toBeNull();
});

it("reports an unavailable live session and loads its drafts on a fresh renderer mount", async () => {
  const draft = {
    id: "draft",
    version: { number: "1" },
    title: "Release",
    audience: "Users",
    comparison: {
      selectionId: "s",
      base: "a",
      target: "b",
      commits: [],
      changes: [],
      evidence: [],
    },
    generationStatus: "",
    document: { sections: [] },
  };
  let unavailable = true;
  const notice = vi.fn();
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      session: () =>
        unavailable
          ? Promise.reject(new Error("private storage detail"))
          : Promise.resolve({ drafts: [draft.id], generations: {} }),
      readDraft: () => Promise.resolve(draft),
    },
  });
  render(<StudioPanel modelReady notice={notice} />);
  await waitFor(() => {
    expect(notice).toHaveBeenCalledWith(
      "Your open drafts could not be loaded. Try refreshing the app.",
    );
  });
  expect(screen.queryByText("private storage detail")).toBeNull();
  cleanup();
  unavailable = false;
  render(<StudioPanel modelReady notice={notice} />);
  expect(await screen.findByRole("heading", { name: "Release" })).toBeTruthy();
});

it("renders model, system, and domain history with occurrence times and content types", async () => {
  const draft = {
    id: "draft",
    version: { number: "1" },
    title: "Release",
    audience: "Users",
    comparison: {
      selectionId: "s",
      base: "a",
      target: "b",
      commits: [],
      changes: [],
      evidence: [],
    },
    generationStatus: "",
    document: { sections: [] },
  };
  const items: Record<string, unknown>[] = [
    {
      occurredAt: "2026-10-09T12:00:00Z",
      conversationRecord: {
        id: { value: "record-1" },
        conversation: { value: "conversation-1" },
        operation: { value: "operation-1" },
        occurredAt: "2026-10-09T12:00:00Z",
        content: {
          "@type": "type.googleapis.com/spine.ts.agent.GenerationResponse",
          rawOutput: JSON.stringify({
            sections: [
              {
                heading: "Changes",
                entries: [{ text: "Header errors are clearer.", evidence: [] }],
              },
            ],
          }),
          outcome: "AI_OUTCOME_ADMITTED",
        },
      },
    },
    {
      occurredAt: "2026-10-09T12:01:00Z",
      systemEvent: {
        id: { value: "system-event-1" },
        message: {
          "@type": "type.googleapis.com/spine.ts.agent.AgentInvocationTerminated",
          reason: "MODEL_USE_DENIED",
        },
        context: { timestamp: "2026-10-09T12:01:00Z" },
      },
    },
    {
      occurredAt: "2026-10-09T12:02:00Z",
      domainEvent: {
        id: { value: "domain-event-1" },
        message: {
          "@type": "type.googleapis.com/spine.examples.releasenotes.ReleaseNotesProposed",
          document: {
            sections: [
              {
                heading: "Changes",
                entries: [{ text: "Header errors are clearer.", evidence: [] }],
              },
            ],
          },
        },
        context: { timestamp: "2026-10-09T12:02:00Z" },
      },
    },
    {
      occurredAt: "2026-10-09T12:03:00Z",
      domainEvent: {
        message: {
          "@type": "type.googleapis.com/spine.examples.releasenotes.UnknownOutcome",
        },
        context: { timestamp: "2026-10-09T12:03:00Z" },
      },
    },
  ];
  const bridge = {
    session: () => Promise.resolve({ drafts: [draft.id], generations: {} }),
    readDraft: () => Promise.resolve(draft),
    history: (_id: string, category: string) =>
      Promise.resolve({
        items:
          category === "all"
            ? items
            : category === "system"
              ? [items[1]?.systemEvent]
              : category === "domain"
                ? [items[2]?.domainEvent]
                : [items[0]?.conversationRecord],
      }),
  } as unknown as StudioBridge;
  Object.defineProperty(window, "releaseNotes", { configurable: true, value: bridge });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  await screen.findByRole("heading", { name: "Release" });
  fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
  const panel = screen.getByRole("region", { name: "Activity" });
  fireEvent.click(within(panel).getByRole("button", { name: "Load activity" }));
  await within(panel).findByText("Writing response");
  expect(within(panel).getByText("Writing stopped")).toBeTruthy();
  expect(within(panel).getByText("Notes proposed")).toBeTruthy();
  expect(within(panel).getByText("Proposed 1 section with 1 entry.")).toBeTruthy();
  expect(within(panel).getByText("Draft update")).toBeTruthy();
  expect(
    within(panel).getAllByText(
      (_, element) =>
        element?.tagName === "TIME" &&
        element.textContent.includes(new Date("2026-10-09T12:00:00Z").toLocaleString()),
    ).length,
  ).toBeGreaterThan(0);
  expect(within(panel).queryByText(/GenerationResponse|@type|SHA-256/)).toBeNull();
  expect(within(panel).queryByText(/"sections"|rawOutput/)).toBeNull();
  fireEvent.change(within(panel).getByLabelText("View"), { target: { value: "system" } });
  fireEvent.click(within(panel).getByRole("button", { name: "Load activity" }));
  await within(panel).findByText("Writing stopped");
  expect(
    within(panel).getByText(new Date("2026-10-09T12:01:00Z").toLocaleString(), { exact: false }),
  ).toBeTruthy();
  fireEvent.change(within(panel).getByLabelText("View"), { target: { value: "domain" } });
  fireEvent.click(within(panel).getByRole("button", { name: "Load activity" }));
  await within(panel).findByText("Notes proposed");
});

it.each(["resolve", "reject"] as const)(
  "ignores a %s session load after renderer unmount",
  async (outcome) => {
    const pending = Promise.withResolvers<{
      drafts: string[];
      generations: Record<string, string>;
    }>();
    const notice = vi.fn();
    const readDraft = vi.fn(() =>
      Promise.resolve({
        id: "old-draft",
        version: { number: "1" },
        title: "Old release",
        audience: "Users",
        comparison: {
          selectionId: "s",
          base: "a",
          target: "b",
          commits: [],
          changes: [],
          evidence: [],
        },
        generationStatus: "",
        document: { sections: [] },
      }),
    );
    Object.defineProperty(window, "releaseNotes", {
      configurable: true,
      value: {
        session: () => pending.promise,
        readDraft,
      },
    });
    const mounted = render(<StudioPanel modelReady notice={notice} />);
    mounted.unmount();
    if (outcome === "resolve") pending.resolve({ drafts: ["old-draft"], generations: {} });
    else pending.reject(new Error("private session detail"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(notice).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Old release");
  },
);

it("does not show an old draft's delayed history after switching drafts", async () => {
  const first = {
    id: "A",
    version: { number: "1" },
    title: "First",
    audience: "Users",
    comparison: {
      selectionId: "s",
      base: "a",
      target: "b",
      commits: [],
      changes: [],
      evidence: [],
    },
    generationStatus: "",
    document: { sections: [] },
  };
  const second = { ...first, id: "B", title: "Second" };
  const delayed = Promise.withResolvers<{ items: readonly unknown[] }>();
  const bridge = {
    session: () => Promise.resolve({ drafts: [first.id, second.id], generations: {} }),
    readDraft: (id: string) => Promise.resolve(id === first.id ? first : second),
    history: (id: string) =>
      id === first.id
        ? delayed.promise
        : Promise.resolve({ items: [{ systemEvent: { message: "new" } }] }),
  } as unknown as StudioBridge;
  Object.defineProperty(window, "releaseNotes", { configurable: true, value: bridge });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  await screen.findByRole("option", { name: "First" });
  fireEvent.change(screen.getByLabelText("Session drafts"), { target: { value: first.id } });
  await screen.findByRole("heading", { name: "First" });
  fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
  fireEvent.click(screen.getByRole("button", { name: "Load activity" }));
  fireEvent.change(screen.getByLabelText("Session drafts"), { target: { value: second.id } });
  await screen.findByRole("heading", { name: "Second" });
  fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
  fireEvent.click(screen.getByRole("button", { name: "Load activity" }));
  await screen.findByText("Progress update");
  await act(async () => {
    delayed.resolve({ items: [{ domainEvent: { message: "old" } }] });
    await delayed.promise;
  });
  expect(screen.queryByText("Draft update")).toBeNull();
  expect(screen.getByText("Progress update")).toBeTruthy();
});

it("reports a cancelled native export without claiming that a file was saved", async () => {
  const draft = {
    id: "draft",
    version: { number: "3" },
    title: "Release",
    audience: "Users",
    comparison: {
      selectionId: "selection",
      base: "a",
      target: "b",
      commits: [],
      changes: [],
      evidence: [],
    },
    generationStatus: "approved",
    document: { sections: [] },
    approvalDigest: "digest",
  };
  const bridge = {
    session: () => Promise.resolve({ drafts: [draft.id], generations: {} }),
    readDraft: () => Promise.resolve(draft),
    exportApproved: () => Promise.resolve({ saved: false }),
  } as unknown as StudioBridge;
  Object.defineProperty(window, "releaseNotes", { configurable: true, value: bridge });
  const notice = vi.fn();
  render(<StudioPanel modelReady notice={notice} />);
  fireEvent.click(await screen.findByRole("tab", { name: "Preview" }));
  fireEvent.click(await screen.findByRole("button", { name: "Export release notes" }));
  await waitFor(() => {
    expect(notice).toHaveBeenCalledWith("Export cancelled; no file was written.");
  });
  expect(notice.mock.lastCall?.[0]).toBe("Export cancelled; no file was written.");
});

it("approves reviewed bytes and refreshes the Version after a saved export", async () => {
  const draft = {
    id: "draft",
    version: { number: "3" },
    title: "Release",
    audience: "Users",
    comparison: {
      selectionId: "s",
      base: "a",
      target: "b",
      commits: [],
      changes: [],
      evidence: [],
    },
    generationStatus: "staged",
    document: { sections: [{ heading: "Changes", entries: [{ text: "Fix", evidence: [] }] }] },
  };
  const bytes = new TextEncoder().encode("# Release\n");
  const approved = {
    ...draft,
    version: { number: "4" },
    generationStatus: "approved",
    approvalDigest: "digest",
  };
  const exported = { ...approved, version: { number: "5" } };
  const approve = vi.fn<StudioBridge["approve"]>(() => Promise.resolve(approved));
  const exportApproved = vi.fn<StudioBridge["exportApproved"]>(() =>
    Promise.resolve({ saved: true }),
  );
  let reads = 0;
  const bridge = {
    session: () => Promise.resolve({ drafts: [draft.id], generations: {} }),
    readDraft: () => Promise.resolve(++reads === 1 ? draft : exported),
    preview: () => Promise.resolve({ version: draft.version, markdown: bytes, digest: "digest" }),
    approve,
    exportApproved,
  } as unknown as StudioBridge;
  Object.defineProperty(window, "releaseNotes", { configurable: true, value: bridge });
  const notice = vi.fn();
  render(<StudioPanel modelReady notice={notice} />);
  fireEvent.click(await screen.findByRole("tab", { name: "Preview" }));
  fireEvent.click(await screen.findByRole("button", { name: "Refresh preview" }));
  fireEvent.click(await screen.findByRole("button", { name: "Approve release notes" }));
  await waitFor(() => {
    expect(approve).toHaveBeenCalledWith(draft.id, draft.version, bytes);
  });
  const exportButton = screen.getByRole("button", { name: "Export release notes" });
  await waitFor(() => {
    expect(exportButton).toHaveProperty("disabled", false);
  });
  fireEvent.click(exportButton);
  await waitFor(() => {
    expect(exportApproved).toHaveBeenCalledWith(draft.id, approved.version);
  });
  await waitFor(() => {
    expect(reads).toBe(2);
  });
  expect(notice).toHaveBeenCalledWith("Approved Markdown exported.");
});

it("keeps generation gated without a plan while showing complete evidence and older history", async () => {
  const comparison = {
    selectionId: "selection",
    base: "base",
    target: "target",
    commits: [],
    changes: [],
    evidence: [{ commit: "target", parent: "base", path: "notes.md", status: "M" }],
  };
  const draft = {
    id: "draft",
    version: { number: "1" },
    title: "Release",
    audience: "Users",
    comparison,
    generationStatus: "",
    document: { sections: [] },
  };
  const history = vi.fn<StudioBridge["history"]>((_id, _category, _pageSize, cursor) =>
    Promise.resolve(
      cursor ? { items: [{ kind: "older" }] } : { items: [{ kind: "newer" }], cursor: "older" },
    ),
  );
  const bridge = {
    session: () => Promise.resolve({ drafts: [], generations: {} }),
    chooseComparison: () => Promise.resolve(comparison),
    openDraft: () => Promise.resolve(draft),
    evidencePatch: () =>
      Promise.resolve({ complete: false, reason: "This change cannot be shown here." }),
    history,
  } as unknown as StudioBridge;
  Object.defineProperty(window, "releaseNotes", { configurable: true, value: bridge });
  render(<StudioPanel modelReady={false} notice={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Choose repository" }));
  fireEvent.change(await screen.findByLabelText("Release title"), { target: { value: "Release" } });
  fireEvent.change(screen.getByLabelText("Audience"), { target: { value: "Users" } });
  fireEvent.click(screen.getByRole("button", { name: "Open release draft" }));
  expect(await screen.findByRole("button", { name: "Write a draft" })).toHaveProperty(
    "disabled",
    true,
  );
  fireEvent.change(screen.getByLabelText("Choose a change to inspect"), { target: { value: "0" } });
  expect(await screen.findByText("This change cannot be shown here.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Load activity" }));
  fireEvent.click(await screen.findByRole("button", { name: "Earlier activity" }));
  await waitFor(() => {
    expect(history).toHaveBeenLastCalledWith("draft", "all", 20, "older");
  });
});

it("keeps an unknown Agent execution locked after a renderer reload", async () => {
  const draft = {
    id: "draft",
    version: { number: "2" },
    title: "Release",
    audience: "Users",
    comparison: {
      selectionId: "selection",
      base: "a",
      target: "b",
      commits: [],
      changes: [],
      evidence: [],
    },
    generationStatus: "requested",
    document: { sections: [] },
  };
  const bridge = {
    session: () =>
      Promise.resolve({ drafts: [draft.id], generations: { [draft.id]: "generation" } }),
    readDraft: () => Promise.resolve(draft),
    phase: () => Promise.resolve({ phase: undefined }),
  } as unknown as StudioBridge;
  Object.defineProperty(window, "releaseNotes", { configurable: true, value: bridge });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  const generate = await screen.findByRole("button", { name: "Write a draft" });
  await waitFor(() => {
    expect(screen.getByText(/Checking status/)).toBeTruthy();
  });
  expect(generate).toHaveProperty("disabled", true);
});
