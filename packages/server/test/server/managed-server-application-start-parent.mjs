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

import process from "node:process";
import { ManagedServerApplication, Server } from "../../dist/index.js";

const priorSigint = new Set(process.listeners("SIGINT"));
const priorSigterm = new Set(process.listeners("SIGTERM"));
const managed = await ManagedServerApplication.start({
  processCount: 1,
  port: 50_053,
  moduleUrl: import.meta.url,
  createServer: async ({ host, port }) => Server.atPort(port, { host }).start(),
});

if (process.env.SPINE_MANAGED_SERVER_CHILD !== "true") {
  const addedAtStart = {
    sigint: process.listeners("SIGINT").filter((listener) => !priorSigint.has(listener)).length,
    sigterm: process.listeners("SIGTERM").filter((listener) => !priorSigterm.has(listener)).length,
  };
  await managed.close();
  await managed.close();
  process.send?.({
    type: "start-closed",
    addedAtStart,
    addedAfterClose: {
      sigint: process.listeners("SIGINT").filter((listener) => !priorSigint.has(listener)).length,
      sigterm: process.listeners("SIGTERM").filter((listener) => !priorSigterm.has(listener))
        .length,
    },
  });
}
