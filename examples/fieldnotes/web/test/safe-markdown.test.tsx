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

import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { safePreviewOptions } from "../src/safe-markdown-policy";
import { SafeMarkdown } from "../src/safe-markdown";

it("uses HTML sanitization and substitutes every Markdown image component", () => {
  expect(safePreviewOptions.skipHtml).toBe(true);
  expect(safePreviewOptions.rehypePlugins).toHaveLength(1);
  render(safePreviewOptions.components.img({ alt: "secret", src: "https://attacker.example/pixel" }));
  expect(screen.getByText(/Image omitted: secret/)).toBeTruthy();
  expect(document.querySelector("img")).toBeNull();
  render(safePreviewOptions.components.img({ src: "https://attacker.example/unnamed" }));
  expect(screen.getByRole("img", { name: "Image omitted" }).textContent).toContain("unnamed image");
});

it("renders a saved note without loading an external Markdown image", () => {
  const rendered = render(<SafeMarkdown markdown="## Remembered place\n\n![secret](https://attacker.example/pixel)" />);
  expect(screen.getByRole("heading", { name: /Remembered place/ })).toBeTruthy();
  expect(rendered.container.textContent).toContain("Image omitted: secret");
  expect(rendered.container.querySelector("img")).toBeNull();
});

it("renders ordinary Markdown while refusing raw HTML and script URLs", () => {
  const markdown = [
    "# Heading", "", "| Name | Value |", "| --- | --- |", "| A | B |", "",
    "- [x] Task", "", "```ts", "const note = true;", "```", "",
    "[safe](https://example.com/place)", "[unsafe](javascript:alert(1))", "",
    "<img src=\"https://attacker.example/html-pixel\">",
  ].join("\n");
  const rendered = render(<SafeMarkdown markdown={markdown} />);
  expect(rendered.container.querySelector("h1")?.textContent).toContain("Heading");
  expect(rendered.container.querySelector("table")?.textContent).toContain("A");
  expect(rendered.container.querySelector('input[type="checkbox"]')).not.toBeNull();
  expect(rendered.container.querySelector("code")?.textContent).toContain("const note");
  expect(rendered.container.querySelector('a[href="https://example.com/place"]')).not.toBeNull();
  expect(rendered.container.querySelector('a[href^="javascript:"]')).toBeNull();
  expect(rendered.container.querySelector("img")).toBeNull();
});
