/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = resolve(fileURLToPath(new URL("..", import.meta.url)));
const version = "24.21.0";
const hashes = {
  arm64: "bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057",
  x64: "1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097",
};
if (process.platform !== "darwin" || !(process.arch in hashes))
  throw new Error("The Studio worker resource is currently configured for macOS arm64 and x64.");
const name = `node-v${version}-darwin-${process.arch}.tar.gz`;
const destination = join(directory, "resources/node");
const cache = join(directory, "resources/cache", name);
const temporary = await mkdtemp(join(tmpdir(), "studio-node-"));
try {
  await mkdir(join(directory, "resources/cache"), { recursive: true });
  let bytes = await readFile(cache).catch(() => undefined);
  if (!bytes || createHash("sha256").update(bytes).digest("hex") !== hashes[process.arch]) {
    const response = await fetch(`https://nodejs.org/dist/v${version}/SHASUMS256.txt`);
    if (!response.ok) throw new Error("Official Node checksum lookup failed.");
    const shasums = await response.text();
    const published = shasums
      .split("\n")
      .find((line) => line.endsWith(`  ${name}`))
      ?.split(" ")[0];
    if (published !== hashes[process.arch]) throw new Error("Official Node checksum changed.");
    const archiveResponse = await fetch(`https://nodejs.org/dist/v${version}/${name}`);
    if (!archiveResponse.ok) throw new Error("Official Node archive download failed.");
    bytes = new Uint8Array(await archiveResponse.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== published)
      throw new Error("Official Node archive checksum mismatch.");
    await writeFile(cache, bytes);
  }
  const archive = join(temporary, name);
  await writeFile(archive, bytes);
  execFileSync("tar", [
    "-xzf",
    archive,
    "-C",
    temporary,
    `node-v${version}-darwin-${process.arch}/bin/node`,
    `node-v${version}-darwin-${process.arch}/LICENSE`,
  ]);
  const sourceNode = join(temporary, `node-v${version}-darwin-${process.arch}`, "bin/node");
  const sourceLicense = join(temporary, `node-v${version}-darwin-${process.arch}`, "LICENSE");
  const license = join(directory, "resources/node-LICENSE");
  const nodeDigest = createHash("sha256")
    .update(await readFile(sourceNode))
    .digest("hex");
  const licenseDigest = createHash("sha256")
    .update(await readFile(sourceLicense))
    .digest("hex");
  const existingNode = await readFile(destination).catch(() => undefined);
  const existingLicense = await readFile(license).catch(() => undefined);
  if (!existingNode || createHash("sha256").update(existingNode).digest("hex") !== nodeDigest)
    await copyFile(sourceNode, destination);
  if (
    !existingLicense ||
    createHash("sha256").update(existingLicense).digest("hex") !== licenseDigest
  )
    await copyFile(sourceLicense, license);
  await chmod(destination, 0o755);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
