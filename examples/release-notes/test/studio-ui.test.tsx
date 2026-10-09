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
  fireEvent.change(labeled("Section heading", 0), {
    target: { value: "Highlights" },
  });
  rerender(<StudioPanel modelReady notice={notice} />);
  const heading = labeled("Section heading", 0);
  if (!(heading instanceof HTMLInputElement)) throw new Error("Section heading is missing.");
  expect(heading.value).toBe("Highlights");
  fireEvent.change(labeled("Claim", 0), { target: { value: "Updated" } });
  const picker = labeled("Evidence citations", 0);
  if (!(picker instanceof HTMLSelectElement)) throw new Error("Citation picker is missing.");
  const citation = picker.options[0];
  if (!citation) throw new Error("Citation option is missing.");
  citation.selected = true;
  fireEvent.change(picker);
  fireEvent.click(buttonAt("Remove claim", 1));
  fireEvent.click(buttonAt("Add claim", 1));
  fireEvent.change(labeled("Claim", 2), { target: { value: "Another detail" } });
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
  fireEvent.change(await screen.findByLabelText("Generation instruction"), {
    target: { value: "Original instruction" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
  const repeat = await screen.findByRole("button", { name: "Retry unconfirmed generation" });
  fireEvent.change(screen.getByLabelText("Generation instruction"), {
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
    expect(screen.getByText(/execution: completed/)).toBeTruthy();
  });
  fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
  await waitFor(() => {
    expect(generate).toHaveBeenCalledOnce();
  });
  expect(screen.getByText(/execution: completed/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Retry unconfirmed generation" })).toBeNull();
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
    expect(screen.getByText(/execution: completed/)).toBeTruthy();
  });
  fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
  await waitFor(() => {
    expect(newReads).toBeGreaterThan(0);
  });
  expect(screen.getByText(/execution: active/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Retry unconfirmed generation" })).toBeNull();
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
  fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
  await waitFor(() => {
    expect(generate).toHaveBeenCalledOnce();
  });
  expect(screen.queryByRole("button", { name: "Retry unconfirmed generation" })).toBeNull();
  expect(screen.getByRole("button", { name: "Generate draft" })).toHaveProperty("disabled", false);
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
    expect(screen.getByText(/execution: accepted/)).toBeTruthy();
  });
  expect(screen.getByRole("button", { name: "Generate draft" })).toHaveProperty("disabled", true);
  expect(screen.queryByRole("button", { name: "Retry unconfirmed generation" })).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
    await waitFor(() => {
      expect(screen.getByText(new RegExp(`execution: ${phase}`))).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "Retry unconfirmed generation" })).toBeNull();
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
  await waitFor(() => {
    expect(screen.getByText(/execution: rejected/)).toBeTruthy();
  });
  expect(screen.queryByRole("button", { name: "Retry unconfirmed generation" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
  await waitFor(() => {
    expect(generate).toHaveBeenCalledOnce();
  });
  expect(screen.queryByRole("button", { name: "Retry unconfirmed generation" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
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
    expect(screen.getByText(new RegExp(`execution: ${phase}`))).toBeTruthy();
    expect(screen.getByRole("button", { name: "Generate draft" })).toHaveProperty(
      "disabled",
      false,
    );
    expect(screen.queryByRole("button", { name: "Retry unconfirmed generation" })).toBeNull();
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
    expect(screen.getByText(/execution: unknown/)).toBeTruthy();
  });
  expect(screen.getByLabelText("Claim")).toHaveProperty("value", "Preserve");
  expect(screen.getByRole("button", { name: "Generate draft" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "Retry unconfirmed generation" })).toBeTruthy();
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
    expect(screen.getByLabelText("Claim")).toHaveProperty("value", "After");
  });
  expect(screen.getByText(/Generation: staged; execution: completed/)).toBeTruthy();
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
  expect(screen.getByText(/Only committed changes are included/)).toBeTruthy();
  const claim = await screen.findByLabelText("Claim");
  fireEvent.change(claim, { target: { value: "Unsaved claim" } });
  await waitFor(() => {
    expect(screen.getByLabelText("Claim")).toHaveProperty("value", "Unsaved claim");
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
  fireEvent.click(screen.getByRole("button", { name: "Read current draft" }));
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
  const panel = await screen.findByRole("region", { name: "Agent history" });
  fireEvent.click(within(panel).getByRole("button", { name: "Load history" }));
  fireEvent.change(within(panel).getByLabelText("View"), { target: { value: "system" } });
  fireEvent.click(within(panel).getByRole("button", { name: "Load history" }));
  await within(panel).findByText("System Event");
  const button = await within(panel).findByRole("button", { name: "Older entries" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(history.mock.calls.filter((call) => call[3] === "next")).toHaveLength(1);
  oldAll.resolve({ items: [{ domainEvent: { message: "stale" } }], cursor: "stale" });
  older.resolve({ items: [{ systemEvent: { message: "older" } }] });
  await waitFor(() => {
    expect(within(panel).getAllByText("System Event")).toHaveLength(2);
  });
  expect(within(panel).queryByText("Domain Event")).toBeNull();
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
  const panel = await screen.findByRole("region", { name: "Agent history" });
  fireEvent.change(within(panel).getByLabelText("View"), { target: { value: "system" } });
  fireEvent.click(within(panel).getByRole("button", { name: "Load history" }));
  fireEvent.click(await within(panel).findByRole("button", { name: "Older entries" }));
  expect((await within(panel).findByRole("status")).textContent).toContain("unavailable");
  expect(within(panel).queryByText("private provider details")).toBeNull();
  fireEvent.click(within(panel).getByRole("button", { name: "Older entries" }));
  await waitFor(() => {
    expect(within(panel).getAllByText("System Event")).toHaveLength(2);
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
  const panel = await screen.findByRole("region", { name: "Agent history" });
  fireEvent.change(within(panel).getByLabelText("View"), { target: { value: "domain" } });
  fireEvent.click(within(panel).getByRole("button", { name: "Load history" }));
  expect((await within(panel).findByRole("status")).textContent).toContain("unavailable");
  expect(within(panel).queryByText("private history detail")).toBeNull();
  fireEvent.click(within(panel).getByRole("button", { name: "Load history" }));
  expect(await within(panel).findByText("Domain Event")).toBeTruthy();
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
  const panel = await screen.findByRole("region", { name: "Agent history" });
  fireEvent.click(within(panel).getByRole("button", { name: "Load history" }));
  await waitFor(() => {
    expect(history).toHaveBeenCalledWith("draft", "all", 20, undefined);
  });
  fireEvent.change(within(panel).getByLabelText("View"), { target: { value: "system" } });
  fireEvent.click(within(panel).getByRole("button", { name: "Load history" }));
  expect(await within(panel).findByText("System Event")).toBeTruthy();
  old.reject(new Error("private old history detail"));
  await act(async () => {
    await Promise.resolve();
  });
  expect(within(panel).queryByRole("status")).toBeNull();
  expect(within(panel).getByText("System Event")).toBeTruthy();
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
  fireEvent.click(screen.getByRole("button", { name: "Choose repository and comparison" }));
  await waitFor(() => {
    expect(chooseComparison).toHaveBeenCalledOnce();
  });
  expect(screen.getByRole("heading", { name: "Existing release" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "Existing release (draft)" })).toBeTruthy();
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
  const select = await screen.findByLabelText("Inspect committed evidence");
  fireEvent.change(select, { target: { value: "0" } });
  expect((await screen.findByRole("status")).textContent).toBe(
    "This committed patch is unavailable.",
  );
  expect(screen.queryByText("private Git diagnostics")).toBeNull();
  unavailable = false;
  fireEvent.change(select, { target: { value: "0" } });
  expect((await screen.findByLabelText("Committed patch")).textContent).toContain(
    "+Visible committed change",
  );
  expect(evidencePatch).toHaveBeenCalledTimes(2);
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
    expect(notice).toHaveBeenCalledWith("The in-memory session is unavailable.");
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
  const bridge = {
    session: () => Promise.resolve({ drafts: [draft.id], generations: {} }),
    readDraft: () => Promise.resolve(draft),
    history: () =>
      Promise.resolve({
        items: [
          {
            conversationRecord: {
              content: { "@type": "type.spine/ModelReply" },
              occurredAt: "2026-10-09T12:00:00Z",
            },
          },
          {
            systemEvent: { message: { "@type": "type.spine/AgentTerminated" } },
            occurredAt: "2026-10-09T12:01:00Z",
          },
          { domainEvent: { message: { "@type": "type.spine/ReleaseStaged" } } },
          { message: { "@type": "type.spine/Other" } },
        ],
      }),
  } as unknown as StudioBridge;
  Object.defineProperty(window, "releaseNotes", { configurable: true, value: bridge });
  render(<StudioPanel modelReady notice={vi.fn()} />);
  await screen.findByRole("heading", { name: "Release" });
  const panel = screen.getByRole("region", { name: "Agent history" });
  fireEvent.click(within(panel).getByRole("button", { name: "Load history" }));
  await within(panel).findByText("Model or tool exchange");
  expect(within(panel).getByText("System Event")).toBeTruthy();
  expect(within(panel).getByText("Domain Event")).toBeTruthy();
  expect(within(panel).getByText("all Event")).toBeTruthy();
  expect(within(panel).getAllByText(/2026-10-09T12:00:00Z/).length).toBeGreaterThan(0);
  expect(within(panel).getAllByText(/ModelReply/).length).toBeGreaterThan(0);
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
  await screen.findByRole("option", { name: "First (A)" });
  fireEvent.change(screen.getByLabelText("Session drafts"), { target: { value: first.id } });
  await screen.findByRole("heading", { name: "First" });
  fireEvent.click(screen.getByRole("button", { name: "Load history" }));
  fireEvent.change(screen.getByLabelText("Session drafts"), { target: { value: second.id } });
  await screen.findByRole("heading", { name: "Second" });
  fireEvent.click(screen.getByRole("button", { name: "Load history" }));
  await screen.findByText("System Event");
  await act(async () => {
    delayed.resolve({ items: [{ domainEvent: { message: "old" } }] });
    await delayed.promise;
  });
  expect(screen.queryByText("Domain Event")).toBeNull();
  expect(screen.getByText("System Event")).toBeTruthy();
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
  fireEvent.click(await screen.findByRole("button", { name: "Export approved release notes" }));
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
  fireEvent.click(await screen.findByRole("button", { name: "Preview release notes" }));
  fireEvent.click(await screen.findByRole("button", { name: "Approve reviewed notes" }));
  await waitFor(() => {
    expect(approve).toHaveBeenCalledWith(draft.id, draft.version, bytes);
  });
  const exportButton = screen.getByRole("button", { name: "Export approved release notes" });
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
      Promise.resolve({ complete: false, reason: "Patch exceeds the byte limit." }),
    history,
  } as unknown as StudioBridge;
  Object.defineProperty(window, "releaseNotes", { configurable: true, value: bridge });
  render(<StudioPanel modelReady={false} notice={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Choose repository and comparison" }));
  fireEvent.change(await screen.findByLabelText("Release title"), { target: { value: "Release" } });
  fireEvent.change(screen.getByLabelText("Audience"), { target: { value: "Users" } });
  fireEvent.click(screen.getByRole("button", { name: "Open release draft" }));
  expect(await screen.findByRole("button", { name: "Generate draft" })).toHaveProperty(
    "disabled",
    true,
  );
  fireEvent.change(screen.getByLabelText("Inspect committed evidence"), { target: { value: "0" } });
  expect(await screen.findByText("Patch exceeds the byte limit.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Load history" }));
  fireEvent.click(await screen.findByRole("button", { name: "Older entries" }));
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
  const generate = await screen.findByRole("button", { name: "Generate draft" });
  await waitFor(() => {
    expect(screen.getByText(/execution: unknown/)).toBeTruthy();
  });
  expect(generate).toHaveProperty("disabled", true);
});
