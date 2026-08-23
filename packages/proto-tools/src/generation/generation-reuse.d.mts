/**
 * Shared generation marker and semantic-tree reuse policy.
 */
export const generationMarkerFile: ".spine-proto-generation.json";

/** Derives a stable ID from a generation manifest contract and complete generated output. */
export function generationIdForContents(
  manifest: Readonly<Record<string, unknown>>,
  root: string,
): string;

/**
 * Returns the live generation ID only for coherent, bounded, symlink-free output.
 *
 * @param liveManifestPath Manifest path for the committed live output.
 * @param liveRoot Generated-output root for the committed live tree.
 * @param stagedManifest Manifest prepared for the staged output.
 * @param stagedRoot Generated-output root for the staged tree.
 * @returns The reusable live generation ID, if the live and staged outputs match.
 */
export function reusableGenerationId(
  liveManifestPath: string,
  liveRoot: string,
  stagedManifest: Readonly<Record<string, unknown>>,
  stagedRoot: string,
): string | undefined;
