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
import { describe, expect, it } from "vitest";

import { COPYRIGHT_HEADER, checkCopyright, gitComparison, gitFiles } from "./check-copyright.mjs";

const path = "packages/core/src/example.ts";
const body = "export const example = true;\n";
const currentHeader = (year) => COPYRIGHT_HEADER.replace("Copyright 2026", `Copyright ${year}`);
const options = (files, contents, additions = {}) => ({
  files,
  readFile: (file) => contents[file],
  readManifest: () => ({ sources: [], ownedSources: [] }),
  ...additions,
});

describe("copyright checker", () => {
  it("requires the approved header at byte zero for an authored TypeScript source", () => {
    const problems = checkCopyright({
      files: ["packages/core/src/example.ts"],
      readFile: () => "export const example = true;\n",
      readManifest: () => ({ sources: [], ownedSources: [] }),
      year: 2026,
    });

    expect(problems).toEqual(["packages/core/src/example.ts: missing CodeMatters header"]);
  });

  it("accepts the exact approved header and rejects a stale year", () => {
    const fresh = `${COPYRIGHT_HEADER}export const example = true;\n`;
    const stale = fresh.replace("Copyright 2026", "Copyright 2025");
    const options = {
      files: ["packages/core/src/example.ts"],
      readManifest: () => ({ sources: [], ownedSources: [] }),
      year: 2026,
    };

    expect(checkCopyright({ ...options, readFile: () => fresh })).toEqual([]);
    expect(checkCopyright({ ...options, readFile: () => stale })).toEqual([
      "packages/core/src/example.ts: stale-year CodeMatters header",
    ]);
  });

  it("places a TypeScript header after a shebang and Proto before syntax", () => {
    const options = {
      readManifest: () => ({ sources: [], ownedSources: [] }),
      year: 2026,
    };

    expect(
      checkCopyright({
        ...options,
        files: ["scripts/tool.ts", "packages/proto/proto/example.proto"],
        readFile: (path) =>
          path.endsWith(".ts")
            ? `#!/usr/bin/env node\n${COPYRIGHT_HEADER}export {};\n`
            : `${COPYRIGHT_HEADER}syntax = "proto3";\n`,
      }),
    ).toEqual([]);
  });

  it("preserves upstream provenance exclusions and reports forbidden headers", () => {
    const path = "packages/proto/proto/upstream.proto";
    expect(
      checkCopyright({
        files: [path],
        readFile: () => `${COPYRIGHT_HEADER}syntax = "proto3";\n`,
        readManifest: () => ({ sources: [path], ownedSources: [] }),
        year: 2026,
      }),
    ).toEqual([`${path}: forbidden CodeMatters header`]);
  });

  it("requires the current year only for new or content-changed future files", () => {
    const old = `${COPYRIGHT_HEADER}${body}`;
    expect(checkCopyright(options([path], { [path]: old }, { year: 2027, baseContent: () => old }))).toEqual([]);
    expect(
      checkCopyright(options([path], { [path]: old }, { year: 2027, baseContent: () => undefined })),
    ).toEqual([`${path}: stale-year CodeMatters header`]);
    expect(
      checkCopyright(
        options([path], { [path]: `${COPYRIGHT_HEADER}export const example = false;\n` }, { year: 2027, baseContent: () => old }),
      ),
    ).toEqual([`${path}: stale-year CodeMatters header`]);
    expect(
      checkCopyright(
        options([path], { [path]: `${currentHeader(2027)}${body}` }, { year: 2027, baseContent: () => old }),
      ),
    ).toEqual([]);
  });

  it("does not advance the year for a header-only edit or a unique renamed match", () => {
    const old = `${COPYRIGHT_HEADER}${body}`;
    expect(
      checkCopyright(options([path], { [path]: `${currentHeader(2027)}${body}` }, { year: 2027, baseContent: () => old })),
    ).toEqual([]);
    expect(
      checkCopyright(
        options(["packages/core/src/renamed.ts"], { "packages/core/src/renamed.ts": old }, {
          year: 2027,
          baseContent: () => undefined,
          renamedFrom: () => [path],
          baseContentAt: (oldPath) => (oldPath === path ? old : undefined),
        }),
      ),
    ).toEqual([]);
  });

  it("uses the deleted-base fallback for an unstaged untracked rename and fails closed when ambiguous", () => {
    const old = `${COPYRIGHT_HEADER}${body}`;
    const renamed = "packages/core/src/renamed.ts";
    const unique = options([renamed], { [renamed]: old }, {
      year: 2027,
      baseContent: () => undefined,
      renamedFrom: () => [],
      deletedBasePaths: () => [path],
      baseContentAt: () => old,
    });
    expect(checkCopyright(unique)).toEqual([]);
    expect(checkCopyright({ ...unique, deletedBasePaths: () => [path, "packages/core/src/copy.ts"] })).toEqual([
      `${renamed}: ambiguous header-normalized rename match`,
    ]);
  });

  it("sorts diagnostic classes and fails closed when Git enumeration fails", () => {
    const proto = "packages/proto/proto/upstream.proto";
    expect(
      checkCopyright({
        ...options([path, proto], { [path]: `x${COPYRIGHT_HEADER}${body}`, [proto]: "syntax = \"proto3\";\n" }),
        readManifest: () => ({ sources: [proto], ownedSources: [] }),
        year: 2026,
      }),
    ).toEqual([
      `${path}: misplaced CodeMatters header`,
      `${proto}: missing upstream copyright notice`,
    ]);
    expect(() => gitFiles(() => ({ status: 1, stdout: "" }))).toThrow("copyright enumeration failed");
    expect(() => gitComparison(() => ({ status: 1, stdout: "" }))).toThrow("copyright merge-base failed");
  });
});
