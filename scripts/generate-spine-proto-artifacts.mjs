import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, relative, resolve, sep } from "node:path";
import { generatedTypeScript } from "./generated-source-policy.mjs";

function files(root, suffix) {
  const output = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && path.endsWith(suffix)) output.push(path);
    }
  }
  return output.sort();
}

function normalizedRelative(root, path) {
  return relative(root, path).split(sep).join("/");
}

/**
 * Writes the generated Spine module and versioned manifest from canonical package inputs.
 */
export function writeSpineProtoArtifacts(repoRoot, generatedRoot, manifestOutput) {
  const packageRoot = join(resolve(repoRoot), "packages/proto");
  const config = JSON.parse(readFileSync(join(packageRoot, "spine-proto.json"), "utf8"));
  const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  const protoRoot = join(packageRoot, config.protoRoot);
  const protoFiles = files(protoRoot, ".proto")
    .map((path) => normalizedRelative(protoRoot, path))
    .sort();
  const generatedFiles = files(generatedRoot, "_pb.ts")
    .map((path) => normalizedRelative(generatedRoot, path))
    .sort();
  const expectedGeneratedFiles = protoFiles.map((path) => path.replace(/\.proto$/, "_pb.ts"));
  const expectedGeneratedSet = new Set(expectedGeneratedFiles);

  if (
    generatedFiles.length !== expectedGeneratedFiles.length ||
    generatedFiles.some((path) => !expectedGeneratedSet.has(path))
  ) {
    throw new Error("generated Protobuf modules must exactly match owned Proto sources");
  }
  const source = generatedTypeScript(
    [
      'import type { Message } from "@bufbuild/protobuf";',
      'import type { GenMessage } from "@bufbuild/protobuf/codegenv2";',
      'import type { ProtoModule } from "../src/model/proto-module.js";',
      ...generatedFiles.map(
        (path, index) =>
          `import * as schemas${String(index)} from ${JSON.stringify(`./${path.replace(/\.ts$/, ".js")}`)};`,
      ),
      "",
      "const schemas = Object.freeze([",
      ...generatedFiles.map((_, index) =>
        [
          `  ...Object.values(schemas${String(index)})`,
          '    .filter((value) => typeof value === "object" && value !== null &&',
          '      (value as { kind?: unknown }).kind === "message")',
          "    .map((value) => value as unknown as GenMessage<Message>),",
        ].join("\n"),
      ),
      "].sort((left, right) => left.typeName < right.typeName ? -1 : left.typeName > right.typeName ? 1 : 0));",
      "",
      "/** All Spine schemas shipped by `@spine-event-engine/proto`. */",
      `export const ${config.moduleExport}: ProtoModule = Object.freeze({`,
      `  name: ${JSON.stringify(packageJson.name)},`,
      "  schemas,",
      "  dependencies: Object.freeze([]),",
      "});",
      "",
    ].join("\n"),
    protoFiles,
  );
  writeFileSync(join(generatedRoot, "proto-module.ts"), source, "utf8");
  const manifest = {
    formatVersion: 2,
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    protoFiles,
    generatedExports: Object.fromEntries(
      protoFiles.map((path) => [
        path,
        `${config.exportRoot}/${path.replace(/\.proto$/, "_pb.js")}`,
      ]),
    ),
    dependencies: [...config.dependencies].sort(),
    moduleExport: config.moduleExport,
  };
  let generationId = randomUUID();
  try {
    const previous = JSON.parse(readFileSync(manifestOutput, "utf8"));
    const { generationId: previousId, ...previousContents } = previous;
    if (
      typeof previousId === "string" &&
      previous.formatVersion === 2 &&
      JSON.stringify(previousContents) === JSON.stringify(manifest)
    )
      generationId = previousId;
  } catch {
    // First publication has no committed generation ID to reuse.
  }
  writeFileSync(
    join(generatedRoot, ".spine-proto-generation.json"),
    `${JSON.stringify({ generationId })}\n`,
    "utf8",
  );
  manifest.generationId = generationId;
  writeFileSync(manifestOutput, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}
