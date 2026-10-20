/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the
 * License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
 * express or implied. See the License for the specific language governing permissions and limitations
 * under the License.
 */

import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { setInterval } from "node:timers";

const runId = randomUUID().replaceAll("-", "");
const evidencePath = mkdtempSync(join(tmpdir(), "spine-fault-watchdog-"));
const identity = { runId, database: `sqlrel_fault_${runId}`, evidencePath };
writeFileSync(join(evidencePath, "resource.json"), `${JSON.stringify(identity)}\n`);
process.stdout.write(`FAULT_RESOURCE ${JSON.stringify(identity)}\n`);
process.on("SIGTERM", () => undefined);
process.stdout.write(`resistant fault driver pid=${String(process.pid)}\n`);
process.stderr.write("resistant fault diagnostic\n");
setInterval(() => undefined, 1000);
