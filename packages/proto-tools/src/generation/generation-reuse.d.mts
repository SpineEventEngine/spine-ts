/** Shared generation marker and semantic-tree reuse policy. */
export const generationMarkerFile: ".spine-proto-generation.json";

/** Returns the live generation ID only for coherent, bounded, symlink-free output. */
export function reusableGenerationId(
  liveManifestPath: string,
  liveRoot: string,
  stagedManifest: Readonly<Record<string, unknown>>,
  stagedRoot: string,
): string | undefined;
