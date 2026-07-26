import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { generateHandlerRegistry } from "../../src/handler/handler-codegen.js";

describe("handler codegen", () => {
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
    expect(stage).toContain("generated-handler-registry.ts");
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
    expect(readdirSync(join(app, "generated/handler")).some((name) => name.endsWith(".tmp"))).toBe(
      false,
    );
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
      expect((error as AggregateError).errors).toEqual([primary, cleanup]);
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
    const externalOutput = join(external, "handler/generated-handler-registry.ts");
    mkdirSync(join(external, "handler"));
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
  const output = join(app, "generated/handler/generated-handler-registry.ts");
  mkdirSync(join(app, "generated/handler"), { recursive: true });
  return output;
}
