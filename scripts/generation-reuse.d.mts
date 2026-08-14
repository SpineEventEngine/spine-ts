export declare const generationMarkerFile: string;
export declare function reusableGenerationId(
  liveManifestPath: string,
  liveRoot: string,
  stagedManifest: Record<string, unknown>,
  stagedRoot: string,
): string | undefined;
