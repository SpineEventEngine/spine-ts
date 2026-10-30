import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { RuntimeMetadataGraph } from "../src/generation/runtime-metadata-graph.js";

describe("runtime metadata graph", () => {
  it("deduplicates a diamond and traverses a nonparticipating bridge", () => {
    const app = graphRoot();
    packageAt(app, "app", { left: "1.0.0", right: "1.0.0" });
    packageAt(join(app, "node_modules/left"), "left", { bridge: "1.0.0" });
    packageAt(join(app, "node_modules/right"), "right", { bridge: "1.0.0" });
    packageAt(join(app, "node_modules/bridge"), "bridge", { shared: "1.0.0" });
    packageAt(join(app, "node_modules/shared"), "shared", {}, true);

    expect(RuntimeMetadataGraph.resolve(app).map(({ name }) => name)).toEqual(["shared"]);
  });

  it("includes installed optional participants and ignores absent optional packages", () => {
    const app = graphRoot();
    packageAt(app, "app", {});
    const manifest = join(app, "package.json");
    const value = JSON.parse(readFileSync(manifest, "utf8")) as Record<string, unknown>;
    writeFileSync(
      manifest,
      JSON.stringify({ ...value, optionalDependencies: { model: "1.0.0", absent: "1.0.0" } }),
    );
    packageAt(join(app, "node_modules/model"), "model", {}, true);

    expect(RuntimeMetadataGraph.resolve(app).map(({ name }) => name)).toEqual(["model"]);
  });

  it("records absent optional and resolved bridge edges for freshness", () => {
    const app = graphRoot();
    packageAt(app, "app", { bridge: "1.0.0" });
    const bridge = join(app, "node_modules/bridge");
    packageAt(bridge, "bridge", {});
    const manifest = join(bridge, "package.json");
    const value = JSON.parse(readFileSync(manifest, "utf8")) as Record<string, unknown>;
    writeFileSync(manifest, JSON.stringify({ ...value, optionalDependencies: { model: "1.0.0" } }));

    expect(RuntimeMetadataGraph.resolve(app).edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "bridge",
          requester: realpathSync(app),
          resolved: realpathSync(bridge),
        }),
        expect.objectContaining({ name: "model", requester: realpathSync(bridge), resolved: null }),
      ]),
    );
  });

  it("treats an optional declaration as optional when it also appears in dependencies", () => {
    const app = graphRoot();
    packageAt(app, "app", { model: "1.0.0" });
    const manifest = join(app, "package.json");
    const value = JSON.parse(readFileSync(manifest, "utf8")) as Record<string, unknown>;
    writeFileSync(manifest, JSON.stringify({ ...value, optionalDependencies: { model: "1.0.0" } }));

    expect(RuntimeMetadataGraph.resolve(app).edges).toEqual([
      expect.objectContaining({ name: "model", resolved: null }),
    ]);
  });

  it("selects a CommonJS participant require branch without accepting it for ESM", () => {
    const app = graphRoot();
    packageAt(app, "app", { model: "1.0.0" });
    const model = join(app, "node_modules/model");
    packageAt(model, "model", {}, true);
    const manifest = join(model, "package.json");
    const value = JSON.parse(readFileSync(manifest, "utf8")) as Record<string, unknown>;
    writeFileSync(
      manifest,
      JSON.stringify({
        ...value,
        exports: {
          "./spine": {
            types: "./dist/generated/spine-metadata.d.ts",
            require: "./dist/generated/spine-metadata.cjs",
          },
        },
      }),
    );
    writeFileSync(
      join(model, "dist/generated/spine-metadata.cjs"),
      "exports.spineMetadata = { receivers: [] };\n",
    );

    expect(RuntimeMetadataGraph.resolve(app, [], "require")[0]?.runtimeFile).toBe(
      join(realpathSync(model), "dist/generated/spine-metadata.cjs"),
    );
    expect(() => RuntimeMetadataGraph.resolve(app)).toThrow(/missing published import/u);
  });

  it("selects declarations from the same runtime condition", () => {
    const app = graphRoot();
    packageAt(app, "app", { model: "1.0.0" });
    const model = join(app, "node_modules/model");
    packageAt(model, "model", {}, true);
    writeFileSync(
      join(model, "package.json"),
      JSON.stringify({
        name: "model",
        version: "1.0.0",
        type: "module",
        dependencies: {},
        exports: {
          "./spine": {
            import: { types: "./dist/generated/esm.d.mts", default: "./dist/generated/esm.mjs" },
            require: { types: "./dist/generated/cjs.d.cts", default: "./dist/generated/cjs.cjs" },
          },
        },
      }),
    );
    for (const [name, source] of [
      ["esm.mjs", "export const spineMetadata = { receivers: [] };\n"],
      ["cjs.cjs", "exports.spineMetadata = { receivers: [] };\n"],
      ["esm.d.mts", "export declare const spineMetadata: { receivers: [] };\n"],
      ["cjs.d.cts", "export declare const spineMetadata: { receivers: [] };\n"],
    ])
      writeFileSync(join(model, "dist/generated", name), source);

    expect(RuntimeMetadataGraph.resolve(app, [], "import")[0]?.typesFile).toBe(
      join(realpathSync(model), "dist/generated/esm.d.mts"),
    );
    expect(RuntimeMetadataGraph.resolve(app, [], "require")[0]?.typesFile).toBe(
      join(realpathSync(model), "dist/generated/cjs.d.cts"),
    );
  });

  it.each([
    ["cjs", "cts", "require"],
    ["mjs", "mts", "import"],
  ] as const)(
    "requires a real declaration for shorthand .%s metadata exports",
    (js, dts, format) => {
      const app = graphRoot();
      packageAt(app, "app", { model: "1.0.0" });
      const model = join(app, "node_modules/model");
      packageAt(model, "model", {}, true);
      const manifest = join(model, "package.json");
      const value = JSON.parse(readFileSync(manifest, "utf8")) as Record<string, unknown>;
      writeFileSync(
        manifest,
        JSON.stringify({ ...value, exports: { "./spine": `./dist/generated/model.${js}` } }),
      );
      writeFileSync(
        join(model, `dist/generated/model.${js}`),
        js === "cjs" ? "exports.spineMetadata = {};\n" : "export const spineMetadata = {};\n",
      );
      expect(() => RuntimeMetadataGraph.resolve(app, [], format)).toThrow(
        /missing published types/u,
      );
      writeFileSync(
        join(model, `dist/generated/model.d.${dts}`),
        "export declare const spineMetadata: {};\n",
      );
      expect(RuntimeMetadataGraph.resolve(app, [], format)[0]?.typesFile).toBe(
        join(realpathSync(model), `dist/generated/model.d.${dts}`),
      );
    },
  );

  it("rejects a declared spine export without published JavaScript and types", () => {
    const app = graphRoot();
    packageAt(app, "app", { model: "1.0.0" });
    const model = join(app, "node_modules/model");
    packageAt(model, "model", {}, true);
    rmSync(join(model, "dist/generated/spine-metadata.js"));

    expect(() => RuntimeMetadataGraph.resolve(app)).toThrow(
      "model/spine missing published import file",
    );
  });

  it("rejects a participant missing published declarations", () => {
    const app = graphRoot();
    packageAt(app, "app", { model: "1.0.0" });
    const model = join(app, "node_modules/model");
    packageAt(model, "model", {}, true);
    rmSync(join(model, "dist/generated/spine-metadata.d.ts"));

    expect(() => RuntimeMetadataGraph.resolve(app)).toThrow(
      /model\/spine missing published types/u,
    );
  });

  it("inspects metadata without executing its module", () => {
    const app = graphRoot();
    packageAt(app, "app", { model: "1.0.0" });
    const model = join(app, "node_modules/model");
    packageAt(model, "model", {}, true);
    writeFileSync(
      join(model, "dist/generated/spine-metadata.js"),
      'throw new Error("must not execute");\nexport const spineMetadata = { receivers: [] };\n',
    );

    expect(RuntimeMetadataGraph.resolve(app).map(({ name }) => name)).toEqual(["model"]);
  });

  it("rejects malformed optional dependency declarations", () => {
    const app = graphRoot();
    packageAt(app, "app", {});
    const manifest = join(app, "package.json");
    const value = JSON.parse(readFileSync(manifest, "utf8")) as Record<string, unknown>;
    writeFileSync(manifest, JSON.stringify({ ...value, optionalDependencies: { model: 42 } }));

    expect(() => RuntimeMetadataGraph.resolve(app)).toThrow(
      /invalid optional runtime dependencies/u,
    );
  });

  it("uses the staged metadata for a dependency generated in the same transaction", () => {
    const app = graphRoot();
    packageAt(app, "app", { model: "1.0.0" });
    const model = join(app, "node_modules/model");
    packageAt(model, "model", {}, true);
    rmSync(join(model, "dist"), { recursive: true });
    const stage = join(app, ".generated-model");
    mkdirSync(stage, { recursive: true });
    writeFileSync(
      join(stage, "spine-metadata.ts"),
      "export const spineMetadata = { receivers: [] };\n",
    );

    expect(
      RuntimeMetadataGraph.resolve(app, [{ packageName: "model", staged: stage }]).map(
        ({ name }) => name,
      ),
    ).toEqual(["model"]);
  });

  it("rejects two installations of one package instead of selecting a version", () => {
    const app = graphRoot();
    packageAt(app, "app", { left: "1.0.0", right: "1.0.0" });
    packageAt(join(app, "node_modules/left"), "left", { shared: "1.0.0" });
    packageAt(join(app, "node_modules/right"), "right", { shared: "2.0.0" });
    packageAt(join(app, "node_modules/left/node_modules/shared"), "shared", {}, true);
    packageAt(join(app, "node_modules/right/node_modules/shared"), "shared", {}, true);

    expect(() => RuntimeMetadataGraph.resolve(app)).toThrow("shared resolves to");
  });

  it("traverses distinct versions of a nonparticipating dependency", () => {
    const app = graphRoot();
    packageAt(app, "app", { left: "1.0.0", right: "1.0.0" });
    packageAt(join(app, "node_modules/left"), "left", { bridge: "1.0.0" });
    packageAt(join(app, "node_modules/right"), "right", { bridge: "2.0.0" });
    packageAt(join(app, "node_modules/left/node_modules/bridge"), "bridge", { model: "1.0.0" });
    packageAt(join(app, "node_modules/right/node_modules/bridge"), "bridge", { model: "1.0.0" });
    packageAt(join(app, "node_modules/model"), "model", {}, true);

    expect(RuntimeMetadataGraph.resolve(app).map(({ name }) => name)).toEqual(["model"]);
  });

  it("rejects a package whose metadata reaches its bootstrap through a handler import", () => {
    const app = graphRoot();
    packageAt(app, "app", { handlers: "1.0.0" });
    const handlers = join(app, "node_modules/handlers");
    packageAt(handlers, "handlers", {}, true);
    writeFileSync(
      join(handlers, "dist/generated/spine-metadata.js"),
      [
        'import { TaskAggregate } from "../src/task-aggregate.js";',
        "export const spineMetadata = { receivers: [TaskAggregate] };",
        "",
      ].join("\n"),
    );
    mkdirSync(join(handlers, "dist/src"), { recursive: true });
    writeFileSync(
      join(handlers, "dist/src/task-aggregate.js"),
      'import "../generated/spine-bootstrap.js";\nexport class TaskAggregate {}\n',
    );

    expect(() => RuntimeMetadataGraph.resolve(app)).toThrow(/handlers.*initialization cycle/u);
  });

  it("terminates a local metadata import cycle that does not reach bootstrap", () => {
    const app = graphRoot();
    packageAt(app, "app", { model: "1.0.0" });
    const model = join(app, "node_modules/model");
    packageAt(model, "model", {}, true);
    writeFileSync(
      join(model, "dist/generated/spine-metadata.js"),
      'import "./helper.js";\nexport const spineMetadata = { receivers: [] };\n',
    );
    writeFileSync(join(model, "dist/generated/helper.js"), 'import "./spine-metadata.js";\n');

    expect(RuntimeMetadataGraph.resolve(app).map(({ name }) => name)).toEqual(["model"]);
  });

  it("accepts a conventional string spine export with adjacent declarations", () => {
    const app = graphRoot();
    packageAt(app, "app", { model: "1.0.0" });
    const model = join(app, "node_modules/model");
    packageAt(model, "model", {}, true);
    const manifest = join(model, "package.json");
    const value = JSON.parse(readFileSync(manifest, "utf8")) as Record<string, unknown>;
    writeFileSync(
      manifest,
      JSON.stringify({
        ...value,
        exports: {
          "./spine": "./dist/generated/spine-metadata.js",
        },
      }),
    );

    expect(RuntimeMetadataGraph.resolve(app).map(({ name }) => name)).toEqual(["model"]);
  });

  it("selects the ESM import branch and nested published declarations", () => {
    const app = graphRoot();
    packageAt(app, "app", { model: "1.0.0" });
    const model = join(app, "node_modules/model");
    packageAt(model, "model", {}, true);
    const manifest = join(model, "package.json");
    const value = JSON.parse(readFileSync(manifest, "utf8")) as Record<string, unknown>;
    writeFileSync(
      manifest,
      JSON.stringify({
        ...value,
        exports: {
          "./spine": {
            import: {
              types: "./dist/generated/spine-metadata.d.ts",
              default: "./dist/generated/spine-metadata.js",
            },
            require: "./dist/generated/absent.cjs",
          },
        },
      }),
    );

    const [participant] = RuntimeMetadataGraph.resolve(app);
    expect(participant?.runtimeFile).toBe(
      join(realpathSync(model), "dist/generated/spine-metadata.js"),
    );
    expect(participant?.typesFile).toBe(
      join(realpathSync(model), "dist/generated/spine-metadata.d.ts"),
    );
  });

  it("rejects a require-only spine export rather than choosing an incompatible branch", () => {
    const app = graphRoot();
    packageAt(app, "app", { model: "1.0.0" });
    const model = join(app, "node_modules/model");
    packageAt(model, "model", {}, true);
    const manifest = join(model, "package.json");
    const value = JSON.parse(readFileSync(manifest, "utf8")) as Record<string, unknown>;
    writeFileSync(
      manifest,
      JSON.stringify({
        ...value,
        exports: {
          "./spine": {
            types: "./dist/generated/spine-metadata.d.ts",
            require: "./dist/generated/spine-metadata.js",
          },
        },
      }),
    );

    expect(() => RuntimeMetadataGraph.resolve(app)).toThrow(/model\/spine.*import/u);
  });

  it("rejects a spine export that escapes the installed package", () => {
    const app = graphRoot();
    packageAt(app, "app", { model: "1.0.0" });
    const model = join(app, "node_modules/model");
    packageAt(model, "model", {}, true);
    const manifest = join(model, "package.json");
    const value = JSON.parse(readFileSync(manifest, "utf8")) as Record<string, unknown>;
    writeFileSync(join(app, "outside.js"), "export const spineMetadata = {};\n");
    writeFileSync(
      manifest,
      JSON.stringify({
        ...value,
        exports: {
          "./spine": {
            types: "./dist/generated/spine-metadata.d.ts",
            default: "./../../outside.js",
          },
        },
      }),
    );

    expect(() => RuntimeMetadataGraph.resolve(app)).toThrow(/model\/spine.*package root/u);
  });

  it("rejects published metadata without its declared spineMetadata binding", () => {
    const app = graphRoot();
    packageAt(app, "app", { model: "1.0.0" });
    const model = join(app, "node_modules/model");
    packageAt(model, "model", {}, true);
    writeFileSync(join(model, "dist/generated/spine-metadata.js"), "export const other = {};\n");

    expect(() => RuntimeMetadataGraph.resolve(app)).toThrow(/model\/spine.*spineMetadata/u);
  });

  it("identifies both packages claiming the same Proto schema", () => {
    const app = graphRoot();
    packageAt(app, "app", { accounts: "1.0.0", issues: "1.0.0" });
    for (const name of ["accounts", "issues"]) {
      const root = join(app, "node_modules", name);
      packageAt(root, name, {}, true);
      writeFileSync(
        join(root, "spine-proto-manifest.json"),
        JSON.stringify({
          packageName: name,
          packageVersion: "1.0.0",
          protoFiles: ["domain/shared.proto"],
        }),
      );
    }

    expect(() => RuntimeMetadataGraph.resolve(app)).toThrow(
      /accounts.*issues.*domain\/shared\.proto/u,
    );
  });
});

function graphRoot(): string {
  return mkdtempSync(join(tmpdir(), "spine-runtime-graph-"));
}

function packageAt(
  root: string,
  name: string,
  dependencies: Record<string, string>,
  spine = false,
): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name,
      version: "1.0.0",
      type: "module",
      dependencies,
      exports: spine
        ? {
            "./spine": {
              types: "./dist/generated/spine-metadata.d.ts",
              default: "./dist/generated/spine-metadata.js",
            },
          }
        : {},
    }),
  );
  if (spine) {
    const output = join(root, "dist/generated/spine-metadata.js");
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, "export const spineMetadata = { receivers: [] };\n");
    writeFileSync(
      output.replace(/\.js$/u, ".d.ts"),
      "export declare const spineMetadata: object;\n",
    );
  }
}
