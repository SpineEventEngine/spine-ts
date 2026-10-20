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
import { DeliveryServer } from "@spine-event-engine/delivery-server";
import { fileLogger } from "./file-logger.mjs";

let server;

process.on("message", (request) => {
  void handle(request).then(
    (result) => process.send?.({ requestId: request.requestId, ok: true, result }),
    (error) => process.send?.({ requestId: request.requestId, ok: false, error: String(error) }),
  );
});

async function handle(request) {
  switch (request.kind) {
    case "start":
      server = await new DeliveryServer({ port: 0, logger: fileLogger(request.logPath) }).start();
      return { pid: process.pid, endpoint: server.baseUrl };
    case "close":
      if (server !== undefined) await server.close();
      return { closed: true };
    default:
      throw new Error(`Unsupported Delivery worker request ${String(request.kind)}.`);
  }
}
