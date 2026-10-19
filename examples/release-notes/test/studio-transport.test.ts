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

import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { VersionSchema } from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";
import { StudioTransport } from "../src/trusted/studio-transport.js";

describe("Studio desktop transport", () => {
  it("keeps Version timestamp precision and exact Markdown bytes", () => {
    const input = {
      number: 7,
      timestamp: "2026-10-13T16:28:12.123456789Z",
    };
    const bytes = new Uint8Array([35, 32, 65, 10, 0xc3, 0xa9, 10]);
    const request = StudioTransport.editRequest(
      "58bf50ce-7cde-450a-b77c-ae65e79d6f55",
      input,
      bytes,
    );
    expect(StudioTransport.versionJson(request.version)).toEqual(input);
    expect(request.markdown).toEqual(bytes);
    bytes[0] = 0;
    expect(request.markdown[0]).toBe(35);
    expect(() => StudioTransport.versionJson(new Uint8Array())).toThrow("Invalid draft Version.");
    expect(() => StudioTransport.versionJson(new Uint8Array([8, 7]))).toThrow(
      "Invalid draft Version.",
    );
  });

  it("rejects missing or malformed domain Version before an edit reaches the service", () => {
    expect(() => StudioTransport.versionWire({ number: 7 })).toThrow("Invalid draft Version.");
    expect(() => StudioTransport.versionJson(new Uint8Array([255]))).toThrow();
  });

  it("preserves optional edit time and detaches comparison and Markdown from the trusted draft", () => {
    const draft = {
      id: "58bf50ce-7cde-450a-b77c-ae65e79d6f55",
      version: create(VersionSchema, {
        number: 7,
        timestamp: create(TimestampSchema, { seconds: 1n, nanos: 123456789 }),
      }),
      title: "Release",
      audience: "SDK users",
      comparison: {
        selectionId: "b3824f16-a999-489f-80bb-67bf99367d48",
        projectName: "Repo",
        baseLabel: "before",
        targetLabel: "after",
        base: "a".repeat(40),
        target: "b".repeat(40),
        changes: [{ path: "file.ts", status: "modified" }],
        commits: [{ commit: "a".repeat(40), parents: ["b".repeat(40)], subject: "Fix" }],
        evidence: [
          { path: "file.ts", status: "modified", commit: "a".repeat(40), parent: "b".repeat(40) },
        ],
      },
      generationStatus: "staged" as const,
      markdown: new TextEncoder().encode("# exact  \n"),
    };
    const withoutEdit = StudioTransport.draft(draft);
    expect(withoutEdit.lastEditedAt).toBeUndefined();
    const withEdit = StudioTransport.draft({ ...draft, lastEditedAt: "2026-10-13T16:28:12Z" });
    expect(withEdit.lastEditedAt).toBe("2026-10-13T16:28:12Z");
    expect(StudioTransport.versionJson(withEdit.version)).toEqual({
      number: 7,
      timestamp: "1970-01-01T00:00:01.123456789Z",
    });
    draft.markdown[0] = 0;
    draft.comparison.commits[0]?.parents.push("c".repeat(40));
    expect(withoutEdit.markdown).toEqual(Buffer.from("# exact  \n"));
    expect(withoutEdit.comparison?.commits[0]?.parents).toEqual(["b".repeat(40)]);
  });
});
