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

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod/v4";

import { GitMcpServer } from "./git-mcp-server.js";
import { GitReleaseComparison } from "./git-release.js";

const bindingSchema = z
  .object({
    repository: z.string().min(1).max(4096),
    gitExecutable: z.string().min(1).max(4096),
    base: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
    target: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
    repositoryDevice: z.number().int().nonnegative(),
    repositoryInode: z.number().int().nonnegative(),
    catalogDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

const encoded = process.env.SPINE_RELEASE_GIT_BINDING;
delete process.env.SPINE_RELEASE_GIT_BINDING;
if (!encoded || Buffer.byteLength(encoded, "utf8") > 8192) {
  throw new Error("Release Git worker binding is invalid.");
}
const binding = bindingSchema.parse(JSON.parse(encoded) as unknown);
const comparison = await GitReleaseComparison.open(binding);
const pinned = comparison.workerBinding();
if (
  pinned.base !== binding.base ||
  pinned.target !== binding.target ||
  pinned.repositoryDevice !== binding.repositoryDevice ||
  pinned.repositoryInode !== binding.repositoryInode ||
  pinned.catalogDigest !== binding.catalogDigest
) {
  throw new Error("Release Git worker comparison changed.");
}
serveStdio(() => GitMcpServer.create(comparison));
