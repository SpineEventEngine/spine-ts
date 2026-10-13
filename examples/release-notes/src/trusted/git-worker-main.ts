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
import { GitWorkerBinding } from "./git-worker-binding.js";
import { GitMcpServer } from "./git-mcp-server.js";
import { GitReleaseComparison } from "./git-release.js";

const encoded = process.env.SPINE_RELEASE_GIT_BINDING;
delete process.env.SPINE_RELEASE_GIT_BINDING;
const binding = GitWorkerBinding.parse(encoded);
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
