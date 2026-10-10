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

import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { StudioFiles } from "../src/trusted/studio-files.js";

it("writes only the approved bytes atomically and cleans failed temporary writes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "spine-approved-file-"));
  try {
    const destination = join(directory, "release.md");
    const approved = new Uint8Array([35, 32, 82, 101, 108, 101, 97, 115, 101, 10]);
    await StudioFiles.writeApproved(destination, approved);
    expect(await readFile(destination)).toEqual(Buffer.from(approved));
    await expect(
      StudioFiles.writeApproved(join(directory, "missing", "release.md"), approved),
    ).rejects.toThrow();
    expect(await readdir(directory)).toEqual(["release.md"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
