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
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { MarkdownWorkspaceView } from "../src/studio-markdown-view.js";

test("Markdown edits drive the same preview, copy and export actions without activating remote content", async () => {
  const markdown =
    "# Release\n\n| A | B |\n| - | - |\n| one | two |\n\n<img src=x onerror=evil()>\n\n[site](https://example.invalid/private) ![remote](https://example.invalid/pixel.png)";
  const changed = vi.fn();
  const copied = vi.fn();
  const exported = vi.fn();
  const { rerender } = render(
    <MarkdownWorkspaceView
      title="Customer portal"
      subtitle="v2.4.0"
      markdown={markdown}
      saveState="Saved for this session"
      onMarkdownChange={changed}
      onCopy={copied}
      onExport={exported}
      onDashboard={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Markdown" }), {
    target: { value: `${markdown}\n\nCustom **text**` },
  });
  expect(changed).toHaveBeenCalledWith(`${markdown}\n\nCustom **text**`);
  rerender(
    <MarkdownWorkspaceView
      title="Customer portal"
      subtitle="v2.4.0"
      markdown={`${markdown}\n\nCustom **text**`}
      saveState="Saving…"
      onMarkdownChange={changed}
      onCopy={copied}
      onExport={exported}
      onDashboard={vi.fn()}
    />,
  );
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Preview" }), { button: 0, ctrlKey: false });
  fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
  expect((await screen.findByRole("tabpanel", { name: "Preview" })).textContent).toContain(
    "Custom text",
  );
  expect(screen.getByRole("tab", { name: "Preview" }).getAttribute("aria-selected")).toBe("true");
  expect(document.querySelector(".rs-markdown-preview img")).toBeNull();
  expect(document.querySelector(".rs-markdown-preview a")).toBeNull();
  expect(document.querySelector(".rs-markdown-preview [onerror]")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Copy Markdown" }));
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  expect(copied).toHaveBeenCalledTimes(1);
  expect(exported).toHaveBeenCalledTimes(1);
});

test("a megabyte of newline-heavy Markdown keeps a bounded gutter wide enough for final lines", () => {
  const markdown = ("a".repeat(100) + "\n").repeat(10_000);
  render(
    <MarkdownWorkspaceView
      title="Large document"
      subtitle="v1"
      markdown={markdown}
      saveState="Saved for this session"
      onMarkdownChange={vi.fn()}
      onCopy={vi.fn()}
      onExport={vi.fn()}
      onDashboard={vi.fn()}
    />,
  );
  const editor = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Markdown" });
  expect(editor.value).toBe(markdown);
  expect(editor.rows).toBeLessThanOrEqual(30);
  const gutter = document.querySelector<HTMLElement>(".rs-line-numbers");
  expect(gutter?.style.width).toBe("7ch");
  expect(gutter?.querySelectorAll("span").length).toBeLessThanOrEqual(40);
  editor.scrollTop = 240;
  fireEvent.scroll(editor);
  expect(gutter?.querySelector("span")?.textContent).toBe("11");
  editor.scrollTop = 10_000 * 24;
  fireEvent.scroll(editor);
  expect(gutter?.querySelector("span")?.textContent).toBe("10001");
});
