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

import { existsSync } from "node:fs";
import { globSync } from "node:fs";
import { readFileSync, statSync } from "node:fs";

const excludedPrefixes = [
  "build-protocol/",
  "node_modules/",
  "scripts/check-t0212-removed-routing.mjs",
];
const removedPaths = [
  "packages/transport/src/zeromq",
  "packages/transport/test/zeromq",
  "packages/server/src/runtime/context-transport.ts",
  "packages/server/src/runtime/runtime-routing.ts",
  "packages/server/src/runtime/runtime-transport.ts",
  "packages/server/src/server/context-transport-group.ts",
  "packages/server/test/runtime/context-transport.test.ts",
  "packages/server/test/runtime/runtime-transport.test.ts",
  "packages/server/test/runtime/runtime-routing.test.ts",
  "packages/server/test/server/server-context-transport-child.mjs",
  "packages/server/test/server/server-context-transport-cross-process.test.ts",
  "packages/server/test/server/server-context-transport-lifecycle.test.ts",
];
const removedReferences =
  /(?:ZeroMQ|zeromq|SignalTransport|ContextTransport|RuntimeTransportBinding|TransportTopics|TransportSubscription|TransportRouting|runtime-routing|context-transport|runtime-transport)/u;
const currentPaths = globSync("**/*", {
  nodir: true,
  ignore: ["**/node_modules/**", "**/dist/**", ".git/**"],
});
const failures = [
  ...removedPaths.filter(existsSync).map((path) => `removed path remains: ${path}`),
  ...currentPaths
    .filter((path) => !path.includes("/node_modules/"))
    .filter((path) => statSync(path).isFile())
    .filter((path) => !excludedPrefixes.some((prefix) => path.startsWith(prefix)))
    .filter((path) => readFileSync(path, "utf8").match(removedReferences) !== null)
    .map((path) => `removed routing reference remains: ${path}`),
];

if (failures.length > 0) throw new Error(failures.join("\n"));
