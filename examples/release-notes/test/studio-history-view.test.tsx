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
import {
  AiOutcome,
  AnthropicAssistantContentSchema,
  GenerationResponseSchema,
  OpenAiAssistantContentSchema,
  ToolResponseSchema,
} from "@spine-event-engine/proto/agent";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { HistoryDrawer } from "../src/studio-history-view.js";
import { historyAge, historyRecord } from "../src/studio-history-record.js";

const release = (id: string, title: string) => ({ id, title, createdAt: "2025-01-31T12:00:00Z" });
const jsonObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected Protobuf JSON object");
  return value as Record<string, unknown>;
};
const record = (id: string, text: string) => ({
  occurredAt: "2025-01-31T12:00:00Z",
  conversationRecord: {
    id: { value: id },
    content: {
      "@type": "type.spine.io/spine.ts.agent.GenerationResponse",
      ...jsonObject(
        toJson(
          GenerationResponseSchema,
          create(GenerationResponseSchema, { rawOutput: text, outcome: AiOutcome.ADMITTED }),
        ),
      ),
    },
  },
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const measureHistoryRows = (): void => {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains("rs-history-list")
      ? this.querySelectorAll("article").length * 100
      : 0;
  });
};

test("uses calendar-aware release creation ages at month and year boundaries", () => {
  const now = new Date("2026-03-31T12:00:00Z");
  expect(historyAge("2026-03-31T11:59:31Z", now)).toBe("just now");
  expect(historyAge("2026-03-31T10:00:00Z", now)).toBe("2h ago");
  expect(historyAge("2026-02-28T12:00:00Z", now)).toBe("1mo ago");
  expect(historyAge("2026-02-28T12:00:00Z", new Date("2026-03-28T12:00:00Z"))).toBe("1mo ago");
  expect(historyAge("2025-12-31T12:00:00Z", now)).toBe("3mo ago");
  expect(historyAge("2025-01-31T12:00:00Z", now)).toBe("1y 2mo ago");
});

test("shows recorded assistant text without treating Anthropic thinking as a reply", () => {
  const response = create(GenerationResponseSchema, {
    outcome: AiOutcome.ADMITTED,
    anthropicContent: create(AnthropicAssistantContentSchema, {
      blocks: [
        { content: { case: "thinking", value: { text: "private analysis", signature: "opaque" } } },
        { content: { case: "text", value: "Published summary" } },
      ],
    }),
  });
  const entry = {
    conversationRecord: {
      id: { value: "response" },
      content: {
        "@type": "type.spine.io/spine.ts.agent.GenerationResponse",
        ...jsonObject(toJson(GenerationResponseSchema, response)),
      },
    },
  };
  const visible = historyRecord(entry);
  expect(visible.exact).toBe("Published summary");
  expect(visible.detail).toContain("private analysis");
  expect(visible.detail).toContain("opaque");
});

test("shows serialized OpenAI message parts and tool result text", () => {
  const response = create(GenerationResponseSchema, {
    outcome: AiOutcome.ADMITTED,
    openaiContent: create(OpenAiAssistantContentSchema, {
      items: [
        {
          itemId: "visible",
          content: {
            case: "message",
            value: {
              parts: [
                { content: { case: "outputText", value: "Ready" } },
                { content: { case: "refusal", value: "Unavailable" } },
              ],
            },
          },
        },
        {
          itemId: "reasoning",
          content: { case: "reasoning", value: { encryptedContent: "opaque" } },
        },
      ],
    }),
  });
  const assistant = historyRecord({
    conversationRecord: {
      id: { value: "response" },
      content: {
        "@type": "type.spine.io/spine.ts.agent.GenerationResponse",
        ...jsonObject(toJson(GenerationResponseSchema, response)),
      },
    },
  });
  expect(assistant.exact).toBe("Ready\n\nUnavailable");
  expect(assistant.detail).toContain("opaque");
  const tool = create(ToolResponseSchema, {
    outcome: AiOutcome.ADMITTED,
    text: ["First tool line", "Second tool line"],
    structuredJson: '{"count":2}',
  });
  const result = historyRecord({
    conversationRecord: {
      id: { value: "tool" },
      content: {
        "@type": "type.spine.io/spine.ts.agent.ToolResponse",
        ...jsonObject(toJson(ToolResponseSchema, tool)),
      },
    },
  });
  expect(result.preview).toBe("First tool line");
  expect(result.exact).toContain("Second tool line");
  expect(result.exact).toContain("count");
  expect(result.detail).toContain("structuredJson");
});

test("refresh follows cursors until it joins already loaded history", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const history = vi
    .fn()
    .mockResolvedValueOnce({ items: [record("old", "Old")] })
    .mockResolvedValueOnce({
      items: [record("new2", "Newest"), record("new1", "Newer")],
      cursor: "gap",
    })
    .mockResolvedValueOnce({ items: [record("old", "Old")] });
  const bridge = { history, copyMarkdown: vi.fn().mockResolvedValue(undefined) };
  const view = render(
    <HistoryDrawer
      releases={[release("a", "A")]}
      currentId="a"
      generatingId="a"
      bridge={bridge}
      onClose={() => undefined}
    />,
  );
  await screen.findByText("Old");
  await act(async () => {
    vi.advanceTimersByTime(2_000);
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(history).toHaveBeenNthCalledWith(3, "a", "all", 40, "gap");
  });
  const region = screen.getByRole("region", { name: "A history" });
  expect(
    within(region)
      .getAllByText(/Old|Newer|Newest/)
      .map((item) => item.textContent),
  ).toEqual(["Old", "Newer", "Newest"]);
  view.unmount();
  vi.useRealTimers();
});

test("reads once more after generation ends during an in-flight refresh", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const pending = Promise.withResolvers<{ items: unknown[] }>();
  const history = vi
    .fn()
    .mockResolvedValueOnce({ items: [record("old", "Old")] })
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValue({ items: [record("final", "Final answer"), record("old", "Old")] });
  const bridge = { history, copyMarkdown: vi.fn().mockResolvedValue(undefined) };
  const props = { releases: [release("a", "A")], currentId: "a", bridge, onClose: () => undefined };
  const view = render(<HistoryDrawer {...props} generatingId="a" />);
  await screen.findByText("Old");
  await act(async () => {
    vi.advanceTimersByTime(2_000);
    await Promise.resolve();
  });
  view.rerender(<HistoryDrawer {...props} />);
  await act(async () => {
    pending.resolve({ items: [record("old", "Old")] });
    await pending.promise;
  });
  expect(await screen.findByText("Final answer")).toBeTruthy();
});

test("loads each release separately, pages older records and ignores late refresh", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const late = Promise.withResolvers<{ items: unknown[]; cursor?: string }>();
  const history = vi.fn(async (id: string, _category: string, _size: number, cursor?: string) => {
    if (id === "a" && cursor === "older") return { items: [record("a-old", "Older")] };
    if (id === "a" && history.mock.calls.filter((call) => call[0] === "a" && !call[3]).length > 1)
      return late.promise;
    return {
      items: [record(`${id}-new`, `From ${id}`)],
      ...(id === "a" ? { cursor: "older" } : {}),
    };
  });
  const bridge = { history, copyMarkdown: vi.fn().mockResolvedValue(undefined) };
  const view = render(
    <HistoryDrawer
      releases={[release("a", "A"), release("b", "B")]}
      currentId="a"
      bridge={bridge}
      generatingId="a"
      onClose={() => undefined}
    />,
  );
  expect(await screen.findByText("From a")).toBeTruthy();
  expect(history).toHaveBeenCalledWith("a", "all", expect.any(Number), undefined);
  fireEvent.click(screen.getByRole("button", { name: "Load older" }));
  expect(await screen.findByText("Older")).toBeTruthy();
  await act(async () => {
    vi.advanceTimersByTime(2_000);
    await Promise.resolve();
  });
  fireEvent.click(
    within(screen.getByRole("region", { name: "B history" })).getByRole("button", { name: /B/ }),
  );
  expect(await screen.findByText("From b")).toBeTruthy();
  await act(async () => {
    late.resolve({ items: [record("a-new", "From a")], cursor: "older" });
    await late.promise;
  });
  fireEvent.click(
    within(screen.getByRole("region", { name: "A history" })).getByRole("button", { name: /A/ }),
  );
  expect(
    within(screen.getByRole("region", { name: "A history" })).getAllByText("From a"),
  ).toHaveLength(1);
  view.unmount();
  vi.useRealTimers();
});

test("reopening a release restores the reader's scroll position", async () => {
  const bridge = {
    history: vi
      .fn()
      .mockResolvedValue({ items: [record("first", "First"), record("second", "Second")] }),
    copyMarkdown: vi.fn().mockResolvedValue(undefined),
  };
  const view = render(
    <HistoryDrawer
      releases={[release("a", "A")]}
      currentId="a"
      bridge={bridge}
      onClose={() => undefined}
    />,
  );
  await screen.findByText("First");
  const list = view.container.querySelector<HTMLElement>(".rs-history-list");
  if (!list) throw new Error("Expected history list");
  list.scrollTop = 85;
  const heading = within(screen.getByRole("region", { name: "A history" })).getByRole("button", {
    name: /A/,
  });
  fireEvent.click(heading);
  fireEvent.click(heading);
  const reopened = view.container.querySelector<HTMLElement>(".rs-history-list");
  expect(reopened?.scrollTop).toBe(85);
});

test("collapsing during the first read still anchors the newest record on reopen", async () => {
  measureHistoryRows();
  const pending = Promise.withResolvers<{ items: unknown[] }>();
  const bridge = {
    history: vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue({ items: [record("a", "Latest")] }),
    copyMarkdown: vi.fn().mockResolvedValue(undefined),
  };
  const view = render(
    <HistoryDrawer
      releases={[release("a", "A")]}
      currentId="a"
      bridge={bridge}
      onClose={() => undefined}
    />,
  );
  const heading = within(screen.getByRole("region", { name: "A history" })).getByRole("button", {
    name: /A/,
  });
  fireEvent.click(heading);
  await act(async () => {
    pending.resolve({ items: [record("a", "Latest")] });
    await pending.promise;
  });
  fireEvent.click(heading);
  await screen.findByText("Latest");
  const list = view.container.querySelector<HTMLElement>(".rs-history-list");
  expect(list?.scrollTop).toBe(list?.scrollHeight);
});

test("collapsing during older paging restores the reader with the prepended rows", async () => {
  measureHistoryRows();
  const pending = Promise.withResolvers<{ items: unknown[] }>();
  const bridge = {
    history: vi
      .fn()
      .mockResolvedValueOnce({ items: [record("new", "Newest")], cursor: "older" })
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue({ items: [record("new", "Newest")], cursor: "older" }),
    copyMarkdown: vi.fn().mockResolvedValue(undefined),
  };
  const view = render(
    <HistoryDrawer
      releases={[release("a", "A")]}
      currentId="a"
      bridge={bridge}
      onClose={() => undefined}
    />,
  );
  await screen.findByText("Newest");
  const heading = within(screen.getByRole("region", { name: "A history" })).getByRole("button", {
    name: /A/,
  });
  const list = view.container.querySelector<HTMLElement>(".rs-history-list");
  if (!list) throw new Error("Expected history list");
  list.scrollTop = 45;
  fireEvent.click(screen.getByRole("button", { name: "Load older" }));
  fireEvent.click(heading);
  await act(async () => {
    pending.resolve({ items: [record("old", "Older")] });
    await pending.promise;
  });
  fireEvent.click(heading);
  await screen.findByText("Older");
  const reopened = view.container.querySelector<HTMLElement>(".rs-history-list");
  expect(reopened?.scrollTop).toBe(145);
});

test("failed older paging does not move a reader when a later refresh appends records", async () => {
  const history = vi
    .fn()
    .mockResolvedValueOnce({
      items: [record("third", "Third"), record("second", "Second"), record("first", "First")],
      cursor: "older",
    })
    .mockRejectedValueOnce(new Error("read failed"))
    .mockResolvedValueOnce({
      items: [
        record("fourth", "Fourth"),
        record("third", "Third"),
        record("second", "Second"),
        record("first", "First"),
      ],
      cursor: "older",
    });
  const bridge = { history, copyMarkdown: vi.fn().mockResolvedValue(undefined) };
  const props = { releases: [release("a", "A")], currentId: "a", bridge, onClose: () => undefined };
  const view = render(<HistoryDrawer {...props} generatingId="a" />);
  await screen.findByText("First");
  const list = view.container.querySelector<HTMLElement>(".rs-history-list");
  if (!list) throw new Error("Expected history list");
  Object.defineProperties(list, {
    scrollHeight: { get: () => list.querySelectorAll("article").length * 100 },
    clientHeight: { get: () => 100 },
  });
  list.scrollTop = 0;
  fireEvent.click(screen.getByRole("button", { name: "Load older" }));
  await screen.findByRole("alert");
  view.rerender(<HistoryDrawer {...props} />);
  await screen.findByText("Fourth");
  expect(list.scrollTop).toBe(0);
  expect(screen.getByRole("button", { name: "1 new record" })).toBeTruthy();
});

test("new records follow a reader at the bottom of the history list", async () => {
  const history = vi
    .fn()
    .mockResolvedValueOnce({ items: [record("first", "First")] })
    .mockResolvedValueOnce({ items: [record("second", "Second"), record("first", "First")] });
  const bridge = { history, copyMarkdown: vi.fn().mockResolvedValue(undefined) };
  const props = { releases: [release("a", "A")], currentId: "a", bridge, onClose: () => undefined };
  const view = render(<HistoryDrawer {...props} generatingId="a" />);
  await screen.findByText("First");
  const list = view.container.querySelector<HTMLElement>(".rs-history-list");
  if (!list) throw new Error("Expected history list");
  Object.defineProperties(list, {
    scrollHeight: { get: () => list.querySelectorAll("article").length * 100 },
    clientHeight: { get: () => 100 },
  });
  list.scrollTop = 0;
  view.rerender(<HistoryDrawer {...props} />);
  await screen.findByText("Second");
  expect(list.scrollTop).toBe(list.scrollHeight);
  expect(screen.queryByRole("button", { name: /new record/ })).toBeNull();
});

test("opens exact long content in an accessible modal and copies it", async () => {
  const long = "Complete recorded answer ".repeat(80);
  const bridge = {
    history: vi.fn().mockResolvedValue({ items: [record("message", long)] }),
    copyMarkdown: vi.fn().mockResolvedValue(undefined),
  };
  render(
    <HistoryDrawer
      releases={[release("a", "A")]}
      currentId="a"
      bridge={bridge}
      onClose={() => undefined}
    />,
  );
  await screen.findByText(
    (_, element) => element?.className === "rs-history-preview" && element.textContent === long,
  );
  fireEvent.click(screen.getByRole("button", { name: "Read full record" }));
  const dialog = screen.getByRole("dialog", { name: "Recorded detail" });
  expect(dialog.textContent).toContain(long);
  fireEvent.click(within(dialog).getByRole("button", { name: "Copy" }));
  await waitFor(() => {
    expect(bridge.copyMarkdown).toHaveBeenCalledWith(expect.stringContaining(long));
  });
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "Recorded detail" })).toBeNull();
});
