import { readManifest, type ProtoManifest } from "./index.js";

type ManifestReader = (packageRoot: string, manifestPath: string) => ProtoManifest;

/** Internal exact-manifest reader; it is intentionally not re-exported by the package root. */
export const readManifestAt = readManifest as ManifestReader;
