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
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { StudioFlow, type StudioFlowBridge } from "../src/studio-flow.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
HTMLElement.prototype.hasPointerCapture = () => false;
HTMLElement.prototype.setPointerCapture = () => undefined;
HTMLElement.prototype.releasePointerCapture = () => undefined;
HTMLElement.prototype.scrollIntoView = () => undefined;
afterEach(cleanup);
const comparison = {
  selectionId: "selection",
  projectName: "portal",
  baseLabel: "v1.0.0",
  targetLabel: "main",
  commits: [{}],
  changes: [{}],
};
const release = (markdown = "# Initial", version = 1) => ({
  id: "draft",
  version: { number: version },
  title: "Portal 2.4",
  audience: "Customers",
  comparison,
  generationStatus: "staged",
  markdown: encoder.encode(markdown),
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const bridge = (overrides: Partial<StudioFlowBridge> = {}): StudioFlowBridge => ({
  session: () => Promise.resolve({ drafts: ["draft"], generations: {} }),
  chooseProject: () => Promise.resolve(null),
  compareProject: () => Promise.resolve(comparison),
  openDraft: () => Promise.resolve(release()),
  readDraft: () => Promise.resolve(release()),
  generate: () => Promise.resolve({ generation: "generation" }),
  repeatGeneration: () => Promise.resolve({ generation: "generation" }),
  cancelGeneration: () => Promise.resolve(release()),
  phase: () => Promise.resolve({ receipt: true, phase: "completed" }),
  edit: (_id, _version, bytes) => Promise.resolve(release(decoder.decode(bytes), 2)),
  exportMarkdown: () => Promise.resolve({ saved: true }),
  ...overrides,
});
const renderFlow = (value: StudioFlowBridge, notice = vi.fn()) =>
  render(
    <StudioFlow
      bridge={value}
      models={[{ slug: "demo", displayName: "Demo model" }]}
      model="demo"
      selectModel={() => Promise.resolve()}
      signOut={() => Promise.resolve()}
      onNotice={notice}
    />,
  );
const chooseRevision = async (label: string, value: string) => {
  fireEvent.pointerDown(screen.getByRole("combobox", { name: label }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
    pointerId: 1,
  });
  fireEvent.click(await screen.findByRole("option", { name: value }));
};

const startReleaseStyle = async () => {
  fireEvent.click(screen.getByRole("button", { name: "New release" }));
  fireEvent.click(screen.getByText("Choose a Git project"));
  await screen.findByText("portal");
  await chooseRevision("From", "v1");
  await chooseRevision("To", "main");
  fireEvent.change(screen.getByLabelText("Release"), { target: { value: "Portal 2.4" } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByRole("heading", { name: "Review changes" });
  await screen.findByText("1 commit · 1 file");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByRole("heading", { name: "Writing style" });
};

test("comparison starts after Next and Review remains visible until the user continues", async () => {
  const pending = deferred<typeof comparison>();
  const compare = vi.fn(() => pending.promise);
  renderFlow(
    bridge({
      session: () => Promise.resolve({ drafts: [], generations: {} }),
      chooseProject: () =>
        Promise.resolve({ handle: "handle", name: "portal", refs: ["v1", "main"] }),
      compareProject: compare,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "New release" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose a Git project" }));
  await screen.findByText("portal");
  await chooseRevision("From", "v1");
  await chooseRevision("To", "main");
  fireEvent.change(screen.getByLabelText("Release"), { target: { value: "Portal 2.4" } });
  expect(compare).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByRole("heading", { name: "Review changes" })).toBeTruthy();
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBeNull();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Next" }).disabled).toBe(true);
  await waitFor(() => {
    expect(compare).toHaveBeenCalledWith("handle", "v1", "main");
  });
  pending.resolve(comparison);
  await screen.findByText("1 commit · 1 file");
  expect(screen.getByText("portal · v1 → main")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Review changes" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByRole("heading", { name: "Writing style" });
});

test("a displayed model awaiting registration cannot start writing while style fields remain editable", async () => {
  const openDraft = vi.fn(() => Promise.resolve(release()));
  const value = bridge({
    session: () => Promise.resolve({ drafts: [], generations: {} }),
    chooseProject: () =>
      Promise.resolve({ handle: "handle", name: "portal", refs: ["v1", "main"] }),
    openDraft,
  });
  const config = {
    bridge: value,
    models: [{ slug: "demo", displayName: "Demo model" }],
    model: "demo",
    modelPending: true,
    selectModel: () => Promise.resolve(),
    signOut: () => Promise.resolve(),
    onNotice: vi.fn(),
  };
  const view = render(<StudioFlow {...config} />);
  await startReleaseStyle();
  expect(screen.getByRole("combobox", { name: "Model" }).textContent).toContain("Demo model");
  expect(screen.getByText("Preparing model…")).toBeTruthy();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: /Write/ }).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Notes (optional)"), {
    target: { value: "Lead with search" },
  });
  expect(screen.getByLabelText<HTMLTextAreaElement>("Notes (optional)").value).toBe(
    "Lead with search",
  );
  expect(openDraft).not.toHaveBeenCalled();
  view.rerender(<StudioFlow {...config} modelPending={false} />);
  expect(screen.getByRole<HTMLButtonElement>("button", { name: /Write/ }).disabled).toBe(false);
});

test("a partial session read keeps available releases and reports the unavailable one", async () => {
  const notice = vi.fn();
  renderFlow(
    bridge({
      session: () => Promise.resolve({ drafts: ["draft", "missing"], generations: {} }),
      readDraft: (id) =>
        id === "draft"
          ? Promise.resolve(release())
          : Promise.reject(new Error("private missing record")),
    }),
    notice,
  );
  expect(await screen.findByRole("button", { name: /Portal 2.4/ })).toBeTruthy();
  await waitFor(() => {
    expect(notice).toHaveBeenCalledWith(
      "Some releases could not be read yet. Try opening them again.",
    );
  });
});

test("a session read failure reports a safe message without inventing releases", async () => {
  const notice = vi.fn();
  renderFlow(bridge({ session: () => Promise.reject(new Error("private session error")) }), notice);
  await waitFor(() => {
    expect(notice).toHaveBeenCalledWith("Could not read this session's releases.");
  });
  expect(screen.queryByRole("button", { name: /Portal 2.4/ })).toBeNull();
});

test("project selection failures keep the Changes step recoverable", async () => {
  const notice = vi.fn();
  const choose = vi
    .fn()
    .mockResolvedValueOnce(null)
    .mockRejectedValueOnce(new Error("private chooser detail"))
    .mockResolvedValueOnce({ handle: "handle", name: "portal", refs: ["v1", "main"] });
  renderFlow(
    bridge({
      session: () => Promise.resolve({ drafts: [], generations: {} }),
      chooseProject: choose,
    }),
    notice,
  );
  fireEvent.click(screen.getByRole("button", { name: "New release" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose a Git project" }));
  await waitFor(() => {
    expect(choose).toHaveBeenCalledTimes(1);
  });
  fireEvent.click(screen.getByRole("button", { name: "Choose a Git project" }));
  await waitFor(() => {
    expect(notice).toHaveBeenCalledOnce();
  });
  fireEvent.click(screen.getByRole("button", { name: "Choose a Git project" }));
  await screen.findByText("portal");
});

test("opening a release failure returns to style without starting generation", async () => {
  const notice = vi.fn();
  const generate = vi.fn();
  renderFlow(
    bridge({
      session: () => Promise.resolve({ drafts: [], generations: {} }),
      chooseProject: () =>
        Promise.resolve({ handle: "handle", name: "portal", refs: ["v1", "main"] }),
      openDraft: () => Promise.reject(new Error("private storage detail")),
      generate,
    }),
    notice,
  );
  await startReleaseStyle();
  fireEvent.click(screen.getByRole("button", { name: "Write" }));
  await waitFor(() => {
    expect(notice).toHaveBeenCalledOnce();
  });
  await screen.findByRole("heading", { name: "Writing style" });
  expect(generate).not.toHaveBeenCalled();
});

test("typing during a pending save is committed before leaving the editor", async () => {
  const first = deferred<ReturnType<typeof release>>();
  let current = release();
  const edits: string[] = [];
  const edit = vi.fn((_id: string, _version: object, bytes: Uint8Array) => {
    const text = decoder.decode(bytes);
    edits.push(text);
    if (edits.length === 1) return first.promise;
    current = release(text, 3);
    return Promise.resolve(current);
  });
  const value = bridge({ readDraft: () => Promise.resolve(current), edit });
  renderFlow(value);
  fireEvent.click(await screen.findByRole("button", { name: /Portal 2.4/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "Markdown" }), {
    target: { value: "# First" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
  await waitFor(() => {
    expect(edit).toHaveBeenCalledTimes(1);
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Markdown" }), {
    target: { value: "# Later 🐈  \n" },
  });
  current = release("# First", 2);
  first.resolve(current);
  await waitFor(() => {
    expect(edits).toEqual(["# First", "# Later 🐈  \n"]);
  });
  await screen.findByRole("heading", { name: "Your releases" });
});

test("Export flushes exact Markdown before using the acknowledged Version", async () => {
  let current = release();
  const exported = vi.fn(() => Promise.resolve({ saved: true }));
  const notice = vi.fn();
  const value = bridge({
    readDraft: () => Promise.resolve(current),
    edit: (_id, _version, bytes) => {
      current = release(decoder.decode(bytes), 2);
      return Promise.resolve(current);
    },
    exportMarkdown: exported,
  });
  renderFlow(value, notice);
  fireEvent.click(await screen.findByRole("button", { name: /Portal 2.4/ }));
  const markdown = "# Café 🐈\n\n```\n  exact  \n```\n";
  fireEvent.change(screen.getByRole("textbox", { name: "Markdown" }), {
    target: { value: markdown },
  });
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  await waitFor(
    () => {
      expect(exported).toHaveBeenCalledWith("draft", { number: 2 });
    },
    {
      onTimeout: () => {
        throw new Error(JSON.stringify(notice.mock.calls));
      },
    },
  );
  expect(decoder.decode(current.markdown)).toBe(markdown);
});

test("Changes enables Next for a valid range without waiting for Git", async () => {
  const compare = vi.fn(() => Promise.resolve(comparison));
  renderFlow(
    bridge({
      session: () => Promise.resolve({ drafts: [], generations: {} }),
      chooseProject: () =>
        Promise.resolve({ handle: "handle", name: "portal", refs: ["v1", "main"] }),
      compareProject: compare,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "New release" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose a Git project" }));
  await screen.findByText("portal");
  await chooseRevision("From", "v1");
  await chooseRevision("To", "main");
  fireEvent.change(screen.getByLabelText("Release"), { target: { value: "Portal 2.4" } });
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Next" }).disabled).toBe(false);
  expect(compare).not.toHaveBeenCalled();
});

test("project chooser stays disabled while pending without a top status", async () => {
  const chooser = deferred<{ handle: string; name: string; refs: readonly string[] } | null>();
  renderFlow(
    bridge({
      session: () => Promise.resolve({ drafts: [], generations: {} }),
      chooseProject: () => chooser.promise,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "New release" }));
  fireEvent.click(screen.getByText("Choose a Git project"));
  expect(screen.queryByText("Opening Git project…")).toBeNull();
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Choose a Git project" }).disabled,
  ).toBe(true);
  chooser.resolve(null);
  await waitFor(() => {
    expect(screen.queryByRole("status")).toBeNull();
  });
});

test("leaving a pending picker restores controls without letting its late result clear a new picker", async () => {
  const first = deferred<{ handle: string; name: string; refs: readonly string[] } | null>();
  const second = deferred<{ handle: string; name: string; refs: readonly string[] } | null>();
  const chooseProject = vi
    .fn()
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(() => second.promise);
  renderFlow(
    bridge({ session: () => Promise.resolve({ drafts: [], generations: {} }), chooseProject }),
  );
  fireEvent.click(screen.getByRole("button", { name: "New release" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose a Git project" }));
  expect(screen.queryByText("Opening Git project…")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Sign out" }).disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "New release" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose a Git project" }));
  expect(chooseProject).toHaveBeenCalledTimes(2);
  first.resolve({ handle: "old", name: "old project", refs: ["v1"] });
  await waitFor(() => {
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Choose a Git project" }).disabled,
    ).toBe(true);
  });
  expect(screen.queryByText("old project")).toBeNull();
  second.resolve({ handle: "new", name: "new project", refs: ["main"] });
  await screen.findByText("new project");
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Choose a Git project" }).disabled,
  ).toBe(false);
});

test("a picker failure after leaving Changes does not interrupt the next wizard", async () => {
  const first = deferred<{ handle: string; name: string; refs: readonly string[] } | null>();
  const notice = vi.fn();
  renderFlow(
    bridge({
      session: () => Promise.resolve({ drafts: [], generations: {} }),
      chooseProject: vi
        .fn()
        .mockImplementationOnce(() => first.promise)
        .mockResolvedValueOnce(null),
    }),
    notice,
  );
  fireEvent.click(screen.getByRole("button", { name: "New release" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose a Git project" }));
  expect(screen.queryByText("Opening Git project…")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
  fireEvent.click(screen.getByRole("button", { name: "New release" }));
  first.reject(new Error("private old picker failure"));
  fireEvent.click(screen.getByRole("button", { name: "Choose a Git project" }));
  await waitFor(() => {
    expect(screen.queryByText("Opening Git project…")).toBeNull();
  });
  expect(notice).not.toHaveBeenCalled();
});

test("Dashboard cannot release sign-out busy state while sign-out is pending", async () => {
  const pending = deferred<undefined>();
  const signOut = vi.fn(() => pending.promise);
  render(
    <StudioFlow
      bridge={bridge({ session: () => Promise.resolve({ drafts: [], generations: {} }) })}
      models={[{ slug: "demo", displayName: "Demo model" }]}
      model="demo"
      selectModel={() => Promise.resolve()}
      signOut={signOut}
      onNotice={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "New release" }));
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await waitFor(() => {
    expect(signOut).toHaveBeenCalledTimes(1);
  });
  expect(screen.getByRole("status")).toHaveProperty("textContent", "Signing out…");
  fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
  expect(screen.getByRole("heading", { name: "Choose changes" })).toBeTruthy();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Sign out" }).disabled).toBe(true);
  pending.resolve(undefined);
  await screen.findByRole("heading", { name: "Your releases" });
});

test("completed Review persists through Style and back without another comparison", async () => {
  const compare = vi.fn(() => Promise.resolve(comparison));
  const openDraft = vi.fn(() =>
    Promise.resolve({ ...release("", 1), generationStatus: "pending" }),
  );
  renderFlow(
    bridge({
      session: () => Promise.resolve({ drafts: [], generations: {} }),
      chooseProject: () =>
        Promise.resolve({ handle: "handle", name: "portal", refs: ["v1", "main"] }),
      compareProject: compare,
      openDraft,
    }),
  );
  await startReleaseStyle();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("heading", { name: "Review changes" })).toBeTruthy();
  expect(screen.getByText("1 commit · 1 file")).toBeTruthy();
  expect(compare).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: "Write" }));
  await waitFor(() => {
    expect(openDraft).toHaveBeenCalledWith(
      expect.any(String),
      "selection",
      "Portal 2.4",
      "Customers",
    );
  });
});

test("editing a completed selection compares the new range only after Next", async () => {
  const compare = vi.fn(() => Promise.resolve(comparison));
  renderFlow(
    bridge({
      session: () => Promise.resolve({ drafts: [], generations: {} }),
      chooseProject: () =>
        Promise.resolve({ handle: "handle", name: "portal", refs: ["v1", "main", "release"] }),
      compareProject: compare,
    }),
  );
  await startReleaseStyle();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await chooseRevision("To", "release");
  expect(compare).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => {
    expect(compare).toHaveBeenCalledTimes(2);
  });
  expect(compare).toHaveBeenLastCalledWith("handle", "v1", "release");
});

test("Review failure offers retry and keeps the same selection", async () => {
  const first = deferred<typeof comparison>();
  const retry = deferred<typeof comparison>();
  const compare = vi
    .fn()
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(() => retry.promise);
  renderFlow(
    bridge({
      session: () => Promise.resolve({ drafts: [], generations: {} }),
      chooseProject: () =>
        Promise.resolve({ handle: "handle", name: "portal", refs: ["v1", "main"] }),
      compareProject: compare,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "New release" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose a Git project" }));
  await screen.findByText("portal");
  await chooseRevision("From", "v1");
  await chooseRevision("To", "main");
  fireEvent.change(screen.getByLabelText("Release"), { target: { value: "Portal 2.4" } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  first.reject(new Error("private Git path"));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Could not compare those Git revisions. Try again.Retry",
  );
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Next" }).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => {
    expect(compare).toHaveBeenCalledTimes(2);
  });
  expect(screen.getByRole("progressbar")).toBeTruthy();
  retry.resolve(comparison);
  await screen.findByText("1 commit · 1 file");
  expect(compare).toHaveBeenNthCalledWith(2, "handle", "v1", "main");
});

test("Back ignores a pending Review result and changed revisions compare only after Next", async () => {
  const stale = deferred<typeof comparison>();
  const fresh = deferred<typeof comparison>();
  const compare = vi
    .fn()
    .mockImplementationOnce(() => stale.promise)
    .mockImplementationOnce(() => fresh.promise);
  renderFlow(
    bridge({
      session: () => Promise.resolve({ drafts: [], generations: {} }),
      chooseProject: () =>
        Promise.resolve({ handle: "handle", name: "portal", refs: ["v1", "main", "release"] }),
      compareProject: compare,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "New release" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose a Git project" }));
  await screen.findByText("portal");
  await chooseRevision("From", "v1");
  await chooseRevision("To", "main");
  fireEvent.change(screen.getByLabelText("Release"), { target: { value: "Portal 2.4" } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => {
    expect(compare).toHaveBeenCalledTimes(1);
  });
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  stale.resolve(comparison);
  await chooseRevision("To", "release");
  expect(compare).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByRole("progressbar")).toBeTruthy();
  await waitFor(() => {
    expect(compare).toHaveBeenCalledTimes(2);
  });
  fresh.resolve({ ...comparison, changes: [{}, {}] });
  await screen.findByText("1 commit · 2 files");
  expect(screen.queryByText("1 commit · 1 file")).toBeNull();
});

test("a second export after editing uses the post-export Version and exact new bytes", async () => {
  let current = release();
  const exported: number[] = [];
  const value = bridge({
    readDraft: () => Promise.resolve(current),
    edit: (_id, version, bytes) => {
      current = release(decoder.decode(bytes), (version as { number: number }).number + 1);
      return Promise.resolve(current);
    },
    exportMarkdown: (_id, version) => {
      exported.push((version as { number: number }).number);
      current = release(
        decoder.decode(current.markdown),
        (version as { number: number }).number + 1,
      );
      return Promise.resolve({ saved: exported.length > 1 });
    },
  });
  renderFlow(value);
  fireEvent.click(await screen.findByRole("button", { name: /Portal 2.4/ }));
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  await waitFor(() => {
    expect(exported).toEqual([1]);
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Markdown" }), {
    target: { value: "# Changed after canceled export 🐈  \n" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  await waitFor(() => {
    expect(exported).toEqual([1, 3]);
  });
  expect(decoder.decode(current.markdown)).toBe("# Changed after canceled export 🐈  \n");
});

test("edited Markdown reopens from the dashboard and after renderer remount", async () => {
  let current = release();
  const value = bridge({
    readDraft: () => Promise.resolve(current),
    edit: (_id, _version, bytes) => {
      current = { ...release(decoder.decode(bytes), 2), generationStatus: "edited" };
      return Promise.resolve(current);
    },
  });
  const view = renderFlow(value);
  fireEvent.click(await screen.findByRole("button", { name: /Portal 2.4/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "Markdown" }), {
    target: { value: "# Edited 🐈" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
  await screen.findByRole("heading", { name: "Your releases" });
  fireEvent.click(screen.getByRole("button", { name: /Portal 2.4/ }));
  expect(await screen.findByRole("textbox", { name: "Markdown" })).toHaveProperty(
    "value",
    "# Edited 🐈",
  );
  view.unmount();
  renderFlow(value);
  fireEvent.click(await screen.findByRole("button", { name: /Portal 2.4/ }));
  expect(await screen.findByRole("textbox", { name: "Markdown" })).toHaveProperty(
    "value",
    "# Edited 🐈",
  );
});

test("export write failure refreshes the committed Version before a later exact edit", async () => {
  let current = release();
  let readAfterFailure = false;
  const edits: { version: number; text: string }[] = [];
  const notice = vi.fn();
  const value = bridge({
    readDraft: () => {
      if (readAfterFailure) {
        readAfterFailure = false;
        return Promise.reject(new Error("temporary read failure"));
      }
      return Promise.resolve(current);
    },
    exportMarkdown: () => {
      current = release("# Initial", 2);
      readAfterFailure = true;
      return Promise.reject(new Error("native write failed"));
    },
    edit: (_id, version, bytes) => {
      const text = decoder.decode(bytes);
      edits.push({ version: (version as { number: number }).number, text });
      if ((version as { number: number }).number !== 2)
        return Promise.reject(new Error("stale Version"));
      current = { ...release(text, 3), generationStatus: "edited" };
      return Promise.resolve(current);
    },
  });
  renderFlow(value, notice);
  fireEvent.click(await screen.findByRole("button", { name: /Portal 2.4/ }));
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  await waitFor(() => {
    expect(notice).toHaveBeenCalledWith("Could not export Markdown.");
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Markdown" }), {
    target: { value: "# Exact after failed export 🐈  \n" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
  await screen.findByRole("heading", { name: "Your releases" });
  expect(edits).toEqual([{ version: 2, text: "# Exact after failed export 🐈  \n" }]);
});

test("a committed edit with lost response reconciles Version and preserves later typing", async () => {
  let current = release();
  let failNextRead = false;
  const edits: { version: number; text: string }[] = [];
  const exported = vi.fn().mockResolvedValue({ saved: true });
  const value = bridge({
    exportMarkdown: exported,
    readDraft: () => {
      if (failNextRead) {
        failNextRead = false;
        return Promise.reject(new Error("temporary read failure"));
      }
      return Promise.resolve(current);
    },
    edit: (_id, version, bytes) => {
      const text = decoder.decode(bytes);
      edits.push({ version: (version as { number: number }).number, text });
      if (edits.length === 1) {
        current = { ...release(text, 2), generationStatus: "edited" };
        failNextRead = true;
        return Promise.reject(new Error("acknowledgment lost after commit"));
      }
      if ((version as { number: number }).number !== 2)
        return Promise.reject(new Error("stale Version"));
      current = { ...release(text, 3), generationStatus: "edited" };
      return Promise.resolve(current);
    },
  });
  renderFlow(value);
  fireEvent.click(await screen.findByRole("button", { name: /Portal 2.4/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "Markdown" }), {
    target: { value: "# First committed" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
  await screen.findByText("Could not save. Your edits remain here.");
  fireEvent.change(screen.getByRole("textbox", { name: "Markdown" }), {
    target: { value: "# Later exact 🐈  \n" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
  await screen.findByRole("heading", { name: "Your releases" });
  expect(edits).toEqual([
    { version: 1, text: "# First committed" },
    { version: 2, text: "# Later exact 🐈  \n" },
  ]);
  fireEvent.click(screen.getByRole("button", { name: /Portal 2.4/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Export" }));
  await waitFor(() => {
    expect(exported).toHaveBeenCalledWith("draft", { number: 3 });
  });
});

test("writing observes the accepted generation and opens its resulting Markdown", async () => {
  const generated = release("# Generated 🐈", 3);
  const acceptance = deferred<{ generation: string }>();
  const initial = deferred<{
    drafts: readonly string[];
    generations: Readonly<Record<string, string>>;
  }>();
  const reads = vi.fn().mockResolvedValue(generated);
  const value = bridge({
    session: () => initial.promise,
    chooseProject: () =>
      Promise.resolve({ handle: "handle", name: "portal", refs: ["v1", "main"] }),
    compareProject: () => Promise.resolve(comparison),
    openDraft: () => Promise.resolve({ ...release("", 1), generationStatus: "pending" }),
    generate: () => acceptance.promise,
    readDraft: reads,
  });
  renderFlow(value);
  fireEvent.click(screen.getByRole("button", { name: "New release" }));
  fireEvent.click(screen.getByText("Choose a Git project"));
  await screen.findByText("portal");
  await chooseRevision("From", "v1");
  await chooseRevision("To", "main");
  fireEvent.change(screen.getByLabelText("Release"), { target: { value: "Portal 2.4" } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByRole("heading", { name: "Review changes" });
  await screen.findByText("1 commit · 1 file");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByRole("heading", { name: "Writing style" });
  fireEvent.click(screen.getByRole("button", { name: "Write" }));
  await screen.findByRole("heading", { name: "Writing…" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(reads).not.toHaveBeenCalled();
  acceptance.resolve({ generation: "generation" });
  initial.resolve({ drafts: [], generations: {} });
  await waitFor(() => {
    expect(reads).toHaveBeenCalled();
  });
  expect(await screen.findByRole("textbox", { name: "Markdown" })).toHaveProperty(
    "value",
    "# Generated 🐈",
  );
});

test("failed generation stays out of the completed editor and offers another try", async () => {
  const failed = { ...release("", 2), generationStatus: "failed:model-rejected" };
  const value = bridge({
    session: () => Promise.resolve({ drafts: [], generations: {} }),
    chooseProject: () =>
      Promise.resolve({ handle: "handle", name: "portal", refs: ["v1", "main"] }),
    compareProject: () => Promise.resolve(comparison),
    openDraft: () => Promise.resolve({ ...release("", 1), generationStatus: "pending" }),
    readDraft: () => Promise.resolve(failed),
  });
  renderFlow(value);
  fireEvent.click(screen.getByRole("button", { name: "New release" }));
  fireEvent.click(screen.getByText("Choose a Git project"));
  await screen.findByText("portal");
  await chooseRevision("From", "v1");
  await chooseRevision("To", "main");
  fireEvent.change(screen.getByLabelText("Release"), { target: { value: "Portal 2.4" } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByRole("heading", { name: "Review changes" });
  await screen.findByText("1 commit · 1 file");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByRole("heading", { name: "Writing style" });
  fireEvent.click(screen.getByRole("button", { name: "Write" }));
  await screen.findByRole("button", { name: "Try again" });
  expect(screen.queryByRole("textbox", { name: "Markdown" })).toBeNull();
});

test("uncertain generation retains its original reference and can retry", async () => {
  const repeat = vi.fn().mockResolvedValue({ generation: "retained" });
  const value = bridge({
    session: () => Promise.resolve({ drafts: [], generations: { draft: "retained" } }),
    chooseProject: () =>
      Promise.resolve({ handle: "handle", name: "portal", refs: ["v1", "main"] }),
    compareProject: () => Promise.resolve(comparison),
    openDraft: () => Promise.resolve({ ...release("", 1), generationStatus: "pending" }),
    generate: () => Promise.reject(new Error("lost acknowledgment")),
    repeatGeneration: repeat,
    readDraft: () => Promise.resolve({ ...release("", 1), generationStatus: "requested" }),
  });
  renderFlow(value);
  fireEvent.click(screen.getByRole("button", { name: "New release" }));
  fireEvent.click(screen.getByText("Choose a Git project"));
  await screen.findByText("portal");
  await chooseRevision("From", "v1");
  await chooseRevision("To", "main");
  fireEvent.change(screen.getByLabelText("Release"), { target: { value: "Portal 2.4" } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByRole("heading", { name: "Review changes" });
  await screen.findByText("1 commit · 1 file");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByRole("heading", { name: "Writing style" });
  fireEvent.click(screen.getByRole("button", { name: "Write" }));
  await waitFor(() => {
    expect(repeat).toHaveBeenCalledWith("retained");
  });
  expect(screen.getByRole("heading", { name: "Writing…" })).toBeTruthy();
});

test("Cancel made before a lost generation acknowledgment cancels the retained admission", async () => {
  const acceptance = deferred<{ generation: string }>();
  const generate = vi.fn(() => acceptance.promise);
  const repeat = vi.fn().mockResolvedValue({ generation: "retained" });
  const cancel = vi.fn().mockResolvedValue({ ...release("", 2), generationStatus: "canceled" });
  renderFlow(
    bridge({
      session: () => Promise.resolve({ drafts: [], generations: { draft: "retained" } }),
      chooseProject: () =>
        Promise.resolve({ handle: "handle", name: "portal", refs: ["v1", "main"] }),
      compareProject: () => Promise.resolve(comparison),
      openDraft: () => Promise.resolve({ ...release("", 1), generationStatus: "pending" }),
      generate,
      repeatGeneration: repeat,
      cancelGeneration: cancel,
      readDraft: () => Promise.resolve({ ...release("", 1), generationStatus: "pending" }),
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "New release" }));
  fireEvent.click(screen.getByText("Choose a Git project"));
  await screen.findByText("portal");
  await chooseRevision("From", "v1");
  await chooseRevision("To", "main");
  fireEvent.change(screen.getByLabelText("Release"), { target: { value: "Portal 2.4" } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("1 commit · 1 file");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(await screen.findByRole("button", { name: "Write" }));
  await waitFor(() => {
    expect(generate).toHaveBeenCalledOnce();
  });
  fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
  acceptance.reject(new Error("lost acknowledgment"));
  await waitFor(() => {
    expect(cancel).toHaveBeenCalledWith("draft", "retained");
  });
  expect(repeat).not.toHaveBeenCalled();
  await screen.findByRole("heading", { name: "Your releases" });
});

test("a transient session failure keeps uncertain writing recoverable with the same generation", async () => {
  const repeat = vi.fn().mockResolvedValue({ generation: "retained" });
  const generate = vi.fn().mockRejectedValue(new Error("lost acknowledgment"));
  let sessionReads = 0;
  renderFlow(
    bridge({
      session: () => {
        sessionReads++;
        if (sessionReads === 2) return Promise.reject(new Error("transient session failure"));
        return Promise.resolve({ drafts: [], generations: { draft: "retained" } });
      },
      chooseProject: () =>
        Promise.resolve({ handle: "handle", name: "portal", refs: ["v1", "main"] }),
      compareProject: () => Promise.resolve(comparison),
      openDraft: () => Promise.resolve({ ...release("", 1), generationStatus: "pending" }),
      generate,
      repeatGeneration: repeat,
      readDraft: () => Promise.resolve({ ...release("", 1), generationStatus: "requested" }),
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "New release" }));
  fireEvent.click(screen.getByText("Choose a Git project"));
  await screen.findByText("portal");
  await chooseRevision("From", "v1");
  await chooseRevision("To", "main");
  fireEvent.change(screen.getByLabelText("Release"), { target: { value: "Portal 2.4" } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("1 commit · 1 file");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(await screen.findByRole("button", { name: "Write" }));
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  await waitFor(() => {
    expect(repeat).toHaveBeenCalledWith("retained");
  });
  expect(generate).toHaveBeenCalledTimes(1);
});

test("a reloaded renderer resumes the retained generation instead of starting another", async () => {
  const repeat = vi.fn().mockResolvedValue({ generation: "retained" });
  const generate = vi.fn();
  renderFlow(
    bridge({
      session: () => Promise.resolve({ drafts: ["draft"], generations: { draft: "retained" } }),
      readDraft: () => Promise.resolve({ ...release("", 1), generationStatus: "requested" }),
      phase: () => Promise.resolve({ receipt: false }),
      repeatGeneration: repeat,
      generate,
    }),
  );
  const card = await screen.findByRole("button", { name: /Portal 2.4/ });
  fireEvent.click(card);
  await waitFor(() => {
    expect(repeat).toHaveBeenCalledWith("retained");
  });
  expect(generate).not.toHaveBeenCalled();
});

test("a reloaded failed release offers recovery without replaying its old generation", async () => {
  const repeat = vi.fn();
  renderFlow(
    bridge({
      session: () => Promise.resolve({ drafts: ["draft"], generations: { draft: "old" } }),
      readDraft: () =>
        Promise.resolve({ ...release("", 2), generationStatus: "failed:model-rejected" }),
      repeatGeneration: repeat,
    }),
  );
  fireEvent.click(await screen.findByRole("button", { name: /Portal 2.4/ }));
  expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
  expect(repeat).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByRole("heading", { name: "Writing style" });
});

test("a reloaded pending release without a retained generation explains recovery", async () => {
  const repeat = vi.fn();
  renderFlow(
    bridge({
      session: () => Promise.resolve({ drafts: ["draft"], generations: {} }),
      readDraft: () => Promise.resolve({ ...release("", 2), generationStatus: "requested" }),
      repeatGeneration: repeat,
    }),
  );
  fireEvent.click(await screen.findByRole("button", { name: /Portal 2.4/ }));
  expect(await screen.findByText("Writing needs attention. Try again.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => {
    expect(repeat).not.toHaveBeenCalled();
  });
});

test("a resumed generation reports a failed receipt check while retaining its reference", async () => {
  const repeat = vi.fn().mockResolvedValue({ generation: "retained" });
  renderFlow(
    bridge({
      session: () => Promise.resolve({ drafts: ["draft"], generations: { draft: "retained" } }),
      readDraft: () => Promise.resolve({ ...release("", 2), generationStatus: "requested" }),
      phase: () => Promise.reject(new Error("private phase failure")),
      repeatGeneration: repeat,
    }),
  );
  fireEvent.click(await screen.findByRole("button", { name: /Portal 2.4/ }));
  expect(await screen.findByText("Writing needs attention. Try again.")).toBeTruthy();
  expect(repeat).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => {
    expect(repeat).toHaveBeenCalledWith("retained");
  });
});

test("an ignored cancellation opens the completed draft instead of claiming it was canceled", async () => {
  const cancel = vi.fn().mockResolvedValue(release("# Finished", 2));
  renderFlow(
    bridge({
      session: () => Promise.resolve({ drafts: ["draft"], generations: { draft: "retained" } }),
      readDraft: () => Promise.resolve({ ...release("", 1), generationStatus: "requested" }),
      cancelGeneration: cancel,
      phase: () => Promise.resolve({ receipt: true, phase: "running" }),
    }),
  );
  fireEvent.click(await screen.findByRole("button", { name: /Portal 2.4/ }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(await screen.findByRole("textbox", { name: "Markdown" })).toHaveProperty(
    "value",
    "# Finished",
  );
  expect(cancel).toHaveBeenCalledWith("draft", "retained");
});

test("a confirmed cancellation returns to dashboard after a retained retry", async () => {
  const repeat = deferred<{ generation: string }>();
  const cancel = vi.fn().mockResolvedValue({ ...release("", 2), generationStatus: "canceled" });
  renderFlow(
    bridge({
      session: () => Promise.resolve({ drafts: ["draft"], generations: { draft: "retained" } }),
      readDraft: () => Promise.resolve({ ...release("", 1), generationStatus: "requested" }),
      repeatGeneration: () => repeat.promise,
      cancelGeneration: cancel,
      phase: () => Promise.resolve({ receipt: false }),
    }),
  );
  fireEvent.click(await screen.findByRole("button", { name: /Portal 2.4/ }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  repeat.resolve({ generation: "retained" });
  await screen.findByRole("heading", { name: "Your releases" });
  expect(cancel).toHaveBeenCalledWith("draft", "retained");
  expect(screen.queryByRole("textbox", { name: "Markdown" })).toBeNull();
});
