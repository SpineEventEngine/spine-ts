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
import { create, toJson } from "@bufbuild/protobuf";
import { AiOutcome, GenerationResponseSchema } from "@spine-event-engine/proto/agent";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { HistoryDrawer } from "../src/studio-history-view.js";

const release = { id: "draft", title: "October release", createdAt: "2026-10-14T12:00:00Z" };
const response = (text: string) => {
  const content = toJson(
    GenerationResponseSchema,
    create(GenerationResponseSchema, { outcome: AiOutcome.ADMITTED, rawOutput: text }),
  );
  if (!content || typeof content !== "object" || Array.isArray(content))
    throw new Error("Expected serialized generation response");
  return {
    occurredAt: "2026-10-14T12:00:00Z",
    conversationRecord: {
      id: { value: "reply" },
      content: { "@type": "type.spine.io/spine.ts.agent.GenerationResponse", ...content },
    },
  };
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test("a failed initial read can be retried without losing the release section", async () => {
  const history = vi
    .fn()
    .mockRejectedValueOnce(new Error("history unavailable"))
    .mockResolvedValueOnce({ items: [response("Recovered answer")] });
  render(
    <HistoryDrawer
      releases={[release]}
      currentId={release.id}
      bridge={{ history, copyMarkdown: vi.fn().mockResolvedValue(undefined) }}
      onClose={() => undefined}
    />,
  );
  expect((await screen.findByRole("alert")).textContent).toContain("Could not load history");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Recovered answer")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(history).toHaveBeenCalledTimes(2);
});

test("full Markdown keeps links and images inert, copies exact text, and restores focus", async () => {
  const original =
    "# Release\n\n[Read more](https://example.com/path) ![chart](https://example.com/chart.png) <script>alert(1)</script>";
  const launcher = document.createElement("button");
  document.body.append(launcher);
  launcher.focus();
  const onClose = vi.fn();
  const copyMarkdown = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <HistoryDrawer
      releases={[release]}
      currentId={release.id}
      bridge={{ history: vi.fn().mockResolvedValue({ items: [response(original)] }), copyMarkdown }}
      onClose={onClose}
      restoreFocus={launcher}
    />,
  );
  const read = await screen.findByRole("button", { name: "Read full record" });
  read.focus();
  fireEvent.click(read);
  const modal = screen.getByRole("dialog", { name: "Recorded detail" });
  expect(within(modal).getByRole("heading", { name: "Release" })).toBeTruthy();
  expect(modal.querySelector("a, img, script")).toBeNull();
  expect(modal.textContent).toContain("https://example.com/path");
  expect(modal.textContent).toContain("https://example.com/chart.png");
  const closeDetail = within(modal).getByRole("button", { name: "Close detail" });
  const copy = within(modal).getByRole("button", { name: "Copy" });
  expect(document.activeElement).toBe(closeDetail);
  fireEvent.keyDown(closeDetail, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(copy);
  fireEvent.keyDown(copy, { key: "Tab" });
  expect(document.activeElement).toBe(closeDetail);
  fireEvent.click(copy);
  await waitFor(() => {
    expect(copyMarkdown).toHaveBeenCalledWith(original);
  });
  fireEvent.keyDown(modal, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "Recorded detail" })).toBeNull();
  expect(document.activeElement).toBe(read);
  fireEvent.keyDown(screen.getByRole("dialog", { name: "History" }), { key: "Escape" });
  expect(onClose).toHaveBeenCalledOnce();
  view.unmount();
  expect(document.activeElement).toBe(launcher);
  launcher.remove();
});

test("structured model content is readable while Copy preserves its original bytes", async () => {
  const original = '{"title":"October","changes":["A","B"]}';
  const copyMarkdown = vi.fn().mockResolvedValue(undefined);
  render(
    <HistoryDrawer
      releases={[release]}
      currentId={release.id}
      bridge={{ history: vi.fn().mockResolvedValue({ items: [response(original)] }), copyMarkdown }}
      onClose={() => undefined}
    />,
  );
  const read = await screen.findByRole("button", { name: "Read full record" });
  fireEvent.click(read);
  const modal = screen.getByRole("dialog", { name: "Recorded detail" });
  expect(modal.querySelector("pre")?.textContent).toContain('"changes": [\n    "A",\n    "B"');
  fireEvent.click(within(modal).getByText("Recorded fields"));
  expect(modal.textContent).toContain("rawOutput");
  fireEvent.click(within(modal).getByRole("button", { name: "Copy" }));
  await waitFor(() => {
    expect(copyMarkdown).toHaveBeenCalledWith(original);
  });
});

test("a failed history copy reports the error and a retry copies the exact message", async () => {
  const original = "Keep every line\n\nAnd the final space ";
  let rejectFirst!: (reason: Error) => void;
  const pending = new Promise<void>((_resolve, reject) => {
    rejectFirst = reject;
  });
  const copyMarkdown = vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce(undefined);
  render(
    <HistoryDrawer
      releases={[release]}
      currentId={release.id}
      bridge={{ history: vi.fn().mockResolvedValue({ items: [response(original)] }), copyMarkdown }}
      onClose={() => undefined}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Read full record" }));
  const modal = screen.getByRole("dialog", { name: "Recorded detail" });
  const copy = within(modal).getByRole("button", { name: "Copy" });
  fireEvent.click(copy);
  expect((copy as HTMLButtonElement).disabled).toBe(true);
  const close = within(modal).getByRole("button", { name: "Close detail" });
  const fields = within(modal).getByText("Recorded fields");
  fields.focus();
  fireEvent.keyDown(fields, { key: "Tab" });
  expect(document.activeElement).toBe(close);
  fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(fields);
  await act(async () => {
    rejectFirst(new Error("private clipboard failure"));
    await pending.catch(() => undefined);
  });
  const failure = await within(modal).findByRole("alert");
  expect(failure.textContent).toContain("Could not copy");
  expect(failure.textContent).not.toContain("private clipboard failure");
  fireEvent.click(copy);
  expect((await within(modal).findByRole("status")).textContent).toBe("Copied.");
  expect(copyMarkdown).toHaveBeenCalledTimes(2);
  expect(copyMarkdown).toHaveBeenNthCalledWith(1, original);
  expect(copyMarkdown).toHaveBeenNthCalledWith(2, original);
});

test("an empty session stays readable and release creation ages update while open", () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-10-14T12:00:59Z"));
  const bridge = { history: vi.fn().mockResolvedValue({ items: [] }), copyMarkdown: vi.fn() };
  const view = render(<HistoryDrawer releases={[]} bridge={bridge} onClose={() => undefined} />);
  expect(screen.getByText("No releases yet.")).toBeTruthy();
  expect(bridge.history).not.toHaveBeenCalled();
  view.rerender(
    <HistoryDrawer
      releases={[release]}
      currentId={release.id}
      bridge={bridge}
      onClose={() => undefined}
    />,
  );
  expect(screen.getByText("just now")).toBeTruthy();
  act(() => {
    vi.advanceTimersByTime(30_000);
  });
  expect(screen.getByText("1m ago")).toBeTruthy();
});
