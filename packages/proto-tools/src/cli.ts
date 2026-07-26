#!/usr/bin/env node
import { resolve } from "node:path";

import { writeManifestAtomically } from "./atomic-manifest.js";
import { createManifest } from "./index.js";

const root = resolve(process.cwd());
const command = process.argv[2] ?? "manifest";
if (command !== "manifest") {
  throw new Error(`spine-proto: unsupported command ${command}`);
}
writeManifestAtomically(
  `${root}/spine-proto-manifest.json`,
  `${JSON.stringify(createManifest(root), null, 2)}\n`,
);
