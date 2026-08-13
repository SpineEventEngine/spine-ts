import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function policy() {
  return require("../packages/proto-tools/dist/src/generation/generated-source-policy.js");
}

const trackedGeneratedTypeScript = new Set([
  "examples/message-board/app/src/model-registry.ts",
  "packages/server/test-fixtures/entity-metadata-fixtures.ts",
]);

/* Classifies repository-owned generated TypeScript for copyright enforcement. */
export function isGeneratedTypeScriptPath(path) {
  return /(?:^|\/)generated\/.+\.tsx?$/u.test(path) || trackedGeneratedTypeScript.has(path);
}

/* Delegates generated content policy to the publishable proto-tools implementation. */
export function generatedFileNotice(sourcePaths) {
  return policy().generatedFileNotice(sourcePaths);
}

export function generatedTypeScript(source, sourcePaths) {
  return policy().generatedTypeScript(source, sourcePaths);
}

/* Derives stable Proto provenance from an ordinary generated file name. */
export function sourceProtoForGeneratedFile(path) {
  const normalized = path.replaceAll("\\", "/");
  return normalized
    .replace(/_pb\.ts$/u, ".proto")
    .replace(/_columns\.ts$/u, ".proto")
    .replace(/\.ts$/u, ".proto");
}
