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

import assert from "node:assert/strict";
import { expect, it } from "vitest";

import { isStudioIpcCommand, validateStudioIpc } from "../src/trusted/studio-ipc.js";

const id = "12345678-1234-1234-1234-123456789abc";

it("permits only bounded workflow actions without repository or destination paths", () => {
  expect(isStudioIpcCommand("choose-comparison")).toBe(true);
  expect(isStudioIpcCommand("run-shell")).toBe(false);
  expect(validateStudioIpc("choose-comparison", { base: "main~1", target: "main" })).toEqual({
    base: "main~1",
    target: "main",
  });
  expect(() =>
    validateStudioIpc("choose-comparison", {
      base: "main~1",
      target: "main",
      repository: "/tmp/other",
    }),
  ).toThrow();
  expect(() =>
    validateStudioIpc("export", {
      id,
      version: { number: 1 },
      destination: "/tmp/out.md",
    }),
  ).toThrow();
  expect(() => validateStudioIpc("generate", { id, instruction: "x\u0000y" })).toThrow();
  expect(validateStudioIpc("repeat-generation", { generation: id })).toEqual({ generation: id });
  expect(() =>
    validateStudioIpc("repeat-generation", { generation: id, instruction: "changed" }),
  ).toThrow();
  expect(() =>
    validateStudioIpc("history", {
      id,
      category: "all",
      pageSize: 0,
    }),
  ).toThrow();
  expect(validateStudioIpc("history", { id, category: "all", pageSize: 101 })).toEqual({
    id,
    category: "all",
    pageSize: 101,
  });
  expect(() =>
    validateStudioIpc("edit", {
      id,
      version: { number: 1 },
      markdown: "not bytes",
    }),
  ).toThrow();
  expect(isStudioIpcCommand("approve")).toBe(false);
  expect(validateStudioIpc("cancel-generation", { id, generation: id })).toEqual({
    id,
    generation: id,
  });
  expect(isStudioIpcCommand("stop-quit")).toBe(false);
});

it("keeps history view and cursor exact while rejecting malformed paging", () => {
  expect(
    validateStudioIpc("history", { id, category: "domain", pageSize: 20, cursor: "older" }),
  ).toEqual({
    id,
    category: "domain",
    pageSize: 20,
    cursor: "older",
  });
  expect(() => validateStudioIpc("history", { id, category: "unknown", pageSize: 20 })).toThrow();
  expect(() => validateStudioIpc("history", { id, category: "domain", pageSize: 1.5 })).toThrow();
  expect(
    validateStudioIpc("history", {
      id,
      category: "domain",
      pageSize: 20,
      cursor: "x".repeat(4_097),
    }),
  ).toMatchObject({ cursor: "x".repeat(4_097) });
  expect(() =>
    validateStudioIpc("history", { id, category: "domain", pageSize: 20, tenant: "other" }),
  ).toThrow();
});

it("accepts long valid editor and comparison fields without local character ceilings", () => {
  expect(
    validateStudioIpc("choose-comparison", {
      base: "b".repeat(129),
      target: "t".repeat(129),
    }),
  ).toMatchObject({ base: "b".repeat(129) });
  expect(
    validateStudioIpc("open-draft", {
      id,
      selectionId: id,
      title: "t".repeat(201),
      audience: "a".repeat(501),
    }),
  ).toMatchObject({ title: "t".repeat(201) });
  expect(
    validateStudioIpc("generate", {
      id,
      instruction: "i".repeat(2_001),
    }),
  ).toMatchObject({ instruction: "i".repeat(2_001) });
  expect(validateStudioIpc("evidence-patch", { selectionId: id, index: 2_001 })).toMatchObject({
    index: 2_001,
  });
});

it("copies exact editor bytes beyond the former Markdown cap", () => {
  const markdown = new Uint8Array([35, 32, 65, 10]);
  const edited = validateStudioIpc("edit", { id, version: { number: "7" }, markdown });
  markdown[0] = 0;
  expect(edited?.markdown).toEqual(new Uint8Array([35, 32, 65, 10]));
  const large = new Uint8Array(1_000_001);
  const accepted = validateStudioIpc("edit", { id, version: {}, markdown: large });
  assert.deepStrictEqual(accepted?.markdown, large);
  expect(accepted.markdown).not.toBe(large);
});

it("refuses malformed identifiers and evidence positions before privileged actions", () => {
  expect(() => validateStudioIpc("read-draft", { id: "not-a-draft" })).toThrow();
  expect(() =>
    validateStudioIpc("generate", { id: "not-a-draft", instruction: "notes" }),
  ).toThrow();
  expect(() =>
    validateStudioIpc("repeat-generation", { generation: "not-a-generation" }),
  ).toThrow();
  expect(() => validateStudioIpc("evidence-patch", { selectionId: id, index: -1 })).toThrow();
  expect(() => validateStudioIpc("evidence-patch", { selectionId: id, index: 1.5 })).toThrow();
  expect(validateStudioIpc("evidence-patch", { selectionId: id, index: 1 })).toEqual({
    selectionId: id,
    index: 1,
  });
});
