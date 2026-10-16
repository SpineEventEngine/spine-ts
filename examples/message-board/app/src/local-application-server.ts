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

import { MessageBoardApplication } from "./index.js";

/* Starts the in-memory local Message Board server for the single-process tutorial. */

const configuredPort = process.env.MESSAGE_BOARD_LOCAL_PORT ?? "8090";
const port = Number(configuredPort);
if (!/^(0|[1-9][0-9]*)$/u.test(configuredPort) || !Number.isSafeInteger(port) || port > 65535)
  throw new Error("MESSAGE_BOARD_LOCAL_PORT must be a TCP port between 0 and 65535.");
const configuredWebPort = process.env.MESSAGE_BOARD_WEB_PORT ?? "5173";
const webPort = Number(configuredWebPort);
if (!/^[1-9][0-9]*$/u.test(configuredWebPort) || !Number.isSafeInteger(webPort) || webPort > 65535)
  throw new Error("MESSAGE_BOARD_WEB_PORT must be a TCP port between 1 and 65535.");
const server = await new MessageBoardApplication().run({
  port,
  webOrigin: `http://127.0.0.1:${String(webPort)}`,
});
console.log(`MessageBoard local server ready at ${server.baseUrl}`);
