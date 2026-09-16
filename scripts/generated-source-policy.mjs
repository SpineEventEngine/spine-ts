import { createRequire } from "node:module";
import { existsSync } from "node:fs";

const require = createRequire(import.meta.url);
let policyModule;

/**
 * Sets a bootstrapped generated-source policy module for subsequent policy delegation.
 *
 * @param modulePath Compiled policy module path, used only while the bootstrap exists.
 */
export function useGeneratedSourcePolicy(modulePath) {
  policyModule = modulePath;
}

function policy() {
  return require(
    policyModule !== undefined && existsSync(policyModule)
      ? policyModule
      : "../packages/proto-tools/dist/src/generation/generated-source-policy.js",
  );
}

const trackedGeneratedTypeScript = new Set(["examples/message-board/app/src/model-registry.ts"]);

/* Classifies repository-owned generated TypeScript for copyright enforcement. */

/**
 * Checks whether generated TypeScript or the tracked composed registry needs provenance enforcement.
 *
 * @param path Repository-relative TypeScript path to classify.
 * @returns Whether generated-source copyright and provenance policy applies.
 */
export function isGeneratedTypeScriptPath(path) {
  return /(?:^|\/)generated\/.+\.tsx?$/u.test(path) || trackedGeneratedTypeScript.has(path);
}

/* Delegates generated content policy to the publishable proto-tools implementation. */

/**
 * Returns the generated-file provenance banner constructed by proto-tools policy.
 *
 * @param sourcePaths Proto paths that must appear in the provenance banner.
 * @returns Generated-file notice text from the active policy module.
 */
export function generatedFileNotice(sourcePaths) {
  return policy().generatedFileNotice(sourcePaths);
}

/**
 * Normalizes generated TypeScript and inserts provenance through proto-tools policy.
 *
 * @param source Generated TypeScript text to normalize.
 * @param sourcePaths Proto paths recorded in the resulting provenance header.
 * @returns Policy-normalized TypeScript source.
 */
export function generatedTypeScript(source, sourcePaths) {
  return policy().generatedTypeScript(source, sourcePaths);
}

/* Derives stable Proto provenance from an ordinary generated file name. */

/**
 * Maps a generated TypeScript filename to a stable Proto provenance path.
 *
 * @param path Generated TypeScript path, using either slash convention.
 * @returns Corresponding path with generated suffixes replaced by `.proto`.
 */
export function sourceProtoForGeneratedFile(path) {
  const normalized = path.replaceAll("\\", "/");
  return normalized
    .replace(/_pb\.ts$/u, ".proto")
    .replace(/_columns\.ts$/u, ".proto")
    .replace(/\.ts$/u, ".proto");
}
