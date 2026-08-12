import { describe, expect, it } from "vitest";

import { COPYRIGHT_HEADER, checkCopyright } from "./check-copyright.mjs";

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
});
