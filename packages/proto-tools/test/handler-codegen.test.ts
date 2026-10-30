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

import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { generateHandlerRegistry } from "../src/generation/handler-codegen.js";

describe("handler codegen", () => {
  it("emits local bootstrap and removes the superseded handler file", () => {
    const app = application();
    const oldOutput = join(app, "generated/handler/generated-handler-registry.ts");
    mkdirSync(join(app, "generated/handler"), { recursive: true });
    writeFileSync(oldOutput, "stale\n");

    generateHandlerRegistry({ appRoot: app });

    expect(readFileSync(join(app, "generated/spine-bootstrap.ts"), "utf8")).toContain(
      "registerSpineMetadata",
    );
    expect(() => readFileSync(oldOutput, "utf8")).toThrow();
  });
  it("preserves live output and removes staging when writing fails", () => {
    const app = application();
    const output = liveOutput(app);
    writeFileSync(output, "live\n");
    let stage = "";

    expect(() => {
      generateHandlerRegistry(
        { appRoot: app },
        {
          write: (path) => {
            stage = path;
            throw new Error("write failed");
          },
          remove: () => undefined,
        },
      );
    }).toThrow("write failed");
    expect(readFileSync(output, "utf8")).toBe("live\n");
    expect(stage).toContain("spine-metadata.ts");
  });

  it("preserves live output and removes a real staging file when publishing fails", () => {
    const app = application();
    const output = liveOutput(app);
    writeFileSync(output, "live\n");
    expect(() => {
      generateHandlerRegistry(
        { appRoot: app },
        {
          rename: () => {
            throw new Error("rename failed");
          },
        },
      );
    }).toThrow("rename failed");
    expect(readFileSync(output, "utf8")).toBe("live\n");
    expect(readdirSync(join(app, "generated")).some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  it("preserves both live outputs when bootstrap publication fails", () => {
    const app = application();
    const metadata = liveOutput(app);
    const bootstrap = join(app, "generated/spine-bootstrap.ts");
    writeFileSync(metadata, "live metadata\n");
    writeFileSync(bootstrap, "live bootstrap\n");

    expect(() => {
      generateHandlerRegistry(
        { appRoot: app },
        {
          rename: (from, to) => {
            if (to === bootstrap) throw new Error("bootstrap publish failed");
            renameSync(from, to);
          },
        },
      );
    }).toThrow("bootstrap publish failed");
    expect(readFileSync(metadata, "utf8")).toBe("live metadata\n");
    expect(readFileSync(bootstrap, "utf8")).toBe("live bootstrap\n");
    expect(readdirSync(join(app, "generated")).some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  it("rejects a symlinked retired output before changing either live file", () => {
    const app = application();
    const metadata = liveOutput(app);
    const bootstrap = join(app, "generated/spine-bootstrap.ts");
    const retired = join(app, "generated/handler/generated-handler-registry.ts");
    const external = join(mkdtempSync(join(tmpdir(), "spine-retired-output-")), "external.ts");
    writeFileSync(metadata, "live metadata\n");
    writeFileSync(bootstrap, "live bootstrap\n");
    writeFileSync(external, "external\n");
    symlinkSync(external, retired);

    expect(() => {
      generateHandlerRegistry({ appRoot: app });
    }).toThrow("Superseded output must not use a symlink path");
    expect(readFileSync(metadata, "utf8")).toBe("live metadata\n");
    expect(readFileSync(bootstrap, "utf8")).toBe("live bootstrap\n");
    expect(readFileSync(external, "utf8")).toBe("external\n");
  });

  it("restores both live files when retired-output removal fails", () => {
    const app = application();
    const metadata = liveOutput(app);
    const bootstrap = join(app, "generated/spine-bootstrap.ts");
    const retired = join(app, "generated/handler/generated-handler-registry.ts");
    writeFileSync(metadata, "live metadata\n");
    writeFileSync(bootstrap, "live bootstrap\n");
    writeFileSync(retired, "retired\n");

    expect(() => {
      generateHandlerRegistry(
        { appRoot: app },
        {
          remove: (path) => {
            if (path === retired) throw new Error("retired removal failed");
            rmSync(path, { force: true });
          },
        },
      );
    }).toThrow("retired removal failed");
    expect(readFileSync(metadata, "utf8")).toBe("live metadata\n");
    expect(readFileSync(bootstrap, "utf8")).toBe("live bootstrap\n");
    expect(readFileSync(retired, "utf8")).toBe("retired\n");
  });

  it("reports primary and cleanup failures in order", () => {
    const app = application();
    const primary = new Error("rename failed");
    const cleanup = new Error("cleanup failed");

    expect(() => {
      generateHandlerRegistry(
        { appRoot: app },
        {
          rename: () => {
            throw primary;
          },
          remove: () => {
            throw cleanup;
          },
        },
      );
    }).toThrow(AggregateError);
    try {
      generateHandlerRegistry(
        { appRoot: app },
        {
          rename: () => {
            throw primary;
          },
          remove: () => {
            throw cleanup;
          },
        },
      );
    } catch (error) {
      expect((error as AggregateError).errors).toEqual([primary, cleanup, cleanup]);
    }
  });

  it("rejects project references and external compiler roots", () => {
    const app = application({ references: [{ path: "../other" }] });
    expect(() => {
      generateHandlerRegistry({ appRoot: app });
    }).toThrow("Project references");

    const external = mkdtempSync(join(tmpdir(), "spine-handler-external-"));
    writeFileSync(join(external, "entity.ts"), "export {};\n");
    const externalApp = application({ include: ["../spine-handler-external-*/entity.ts"] });
    expect(() => {
      generateHandlerRegistry({ appRoot: externalApp });
    }).toThrow("Handler source must stay within");
  });

  it("reports malformed configuration and ignores non-string includes", () => {
    const malformed = application();
    writeFileSync(join(malformed, "tsconfig.json"), "{ invalid");
    expect(() => {
      generateHandlerRegistry({ appRoot: malformed });
    }).toThrow("tsconfig.json");

    const app = application({ include: [42] });
    expect(() => {
      generateHandlerRegistry({ appRoot: app });
    }).toThrow("TS5024");
  });

  it("rejects traversal includes and non-TypeScript compiler roots", () => {
    const traversal = application({ include: ["../outside/**/*.ts"] });
    expect(() => {
      generateHandlerRegistry({ appRoot: traversal });
    }).toThrow("Handler source must stay within");

    const javascript = application({ files: ["src/app.js"], include: undefined });
    writeFileSync(join(javascript, "src/app.js"), "export {};\n");
    expect(() => {
      generateHandlerRegistry({ appRoot: javascript });
    }).toThrow("TypeScript file");
  });

  it("rejects a file app root and a directory tsconfig path", () => {
    const appRootFile = join(
      realpathSync(mkdtempSync(join(tmpdir(), "spine-handler-root-"))),
      "app.ts",
    );
    writeFileSync(appRootFile, "export {};\n");
    expect(() => {
      generateHandlerRegistry({ appRoot: appRootFile });
    }).toThrow("Application root must be a directory");

    const app = application();
    rmSync(join(app, "tsconfig.json"));
    mkdirSync(join(app, "tsconfig.json"));
    expect(() => {
      generateHandlerRegistry({ appRoot: app });
    }).toThrow("Project must be a regular file");
  });

  it("discovers nested directories and rejects a directory compiler root", () => {
    const app = application({ files: ["src"], include: undefined });
    expect(() => {
      generateHandlerRegistry({ appRoot: app });
    }).toThrow("Handler source must be a TypeScript file");

    const nested = application();
    mkdirSync(join(nested, "src/nested"));
    writeFileSync(join(nested, "src/nested/extra.ts"), "export {};\n");
    expect(() => {
      generateHandlerRegistry({ appRoot: nested });
    }).not.toThrow();
  });

  it("rejects declaration roots and handler-analysis diagnostics", () => {
    const declarations = application({ files: ["src/types.d.ts"], include: undefined });
    writeFileSync(join(declarations, "src/types.d.ts"), "declare const value: string;\n");
    expect(() => {
      generateHandlerRegistry({ appRoot: declarations });
    }).toThrow("TypeScript file");

    const invalid = application();
    writeFileSync(
      join(invalid, "src/app.ts"),
      "import { Assign } from '@spine-event-engine/server';\nclass Invalid { @Assign run(): void {} }\n",
    );
    expect(() => {
      generateHandlerRegistry({ appRoot: invalid });
    }).toThrow(/handler|assign/i);
  });

  it("rejects more than one thousand compiler roots before loading them", () => {
    const app = application({ include: ["src/**/*.ts"] });
    for (let index = 0; index < 1000; index += 1) {
      writeFileSync(join(app, "src", `source-${String(index)}.ts`), "export {};\n");
    }

    expect(() => {
      generateHandlerRegistry({ appRoot: app });
    }).toThrow("Handler discovery entry count exceeds 1000");
  });

  it("rejects a matched symlinked source before changing live output", () => {
    const app = application();
    const output = liveOutput(app);
    writeFileSync(output, "live\n");
    const external = mkdtempSync(join(tmpdir(), "spine-handler-external-"));
    const externalSource = join(external, "entity.ts");
    writeFileSync(externalSource, "export {};\n");
    symlinkSync(externalSource, join(app, "src/linked.ts"));

    expect(() => {
      generateHandlerRegistry({ appRoot: app });
    }).toThrow("Handler discovery must not traverse symlink");
    expect(readFileSync(output, "utf8")).toBe("live\n");
  });

  it("rejects a symlinked generated root without changing external live output", () => {
    const app = application();
    const external = mkdtempSync(join(tmpdir(), "spine-handler-external-"));
    const externalOutput = join(external, "spine-metadata.ts");
    writeFileSync(externalOutput, "live\n");
    symlinkSync(external, join(app, "generated"));

    expect(() => {
      generateHandlerRegistry({ appRoot: app });
    }).toThrow("Generated root must not use a symlink path");
    expect(readFileSync(externalOutput, "utf8")).toBe("live\n");
  });
});

function application(config: Record<string, unknown> = {}): string {
  const app = mkdtempSync(join(tmpdir(), "spine-handler-app-"));
  mkdirSync(join(app, "src"));
  writeFileSync(join(app, "src/app.ts"), "export {};\n");
  writeFileSync(
    join(app, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext" },
      include: ["src/**/*.ts"],
      ...config,
    }),
  );
  return realpathSync(app);
}

function liveOutput(app: string): string {
  const output = join(app, "generated/spine-metadata.ts");
  mkdirSync(join(app, "generated/handler"), { recursive: true });
  return output;
}
