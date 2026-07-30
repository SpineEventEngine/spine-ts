import { ProtoManifest, type ProtoManifest as Manifest } from "../index.js";

type ManifestReader = (packageRoot: string, manifestPath: string) => Manifest;

/** Internal exact-manifest reader; it is intentionally not re-exported by the package root. */
export const readManifestAt: ManifestReader = ProtoManifest.read;
