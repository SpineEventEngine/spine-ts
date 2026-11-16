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

import { createServer } from "node:net";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { expect, it, vi } from "vitest";
import { MessageBoardApplication } from "../src/message-board-domain.js";

it("closes the native Application when the browser port is occupied", async () => {
  const listener = createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const address = listener.address();
  if (address === null || typeof address === "string") throw new Error("Expected TCP port.");
  const closeStorage = vi.spyOn(InMemoryStorageFactory.prototype, "close");
  try {
    await expect(new MessageBoardApplication().start({ port: address.port })).rejects.toThrow();
    expect(closeStorage).toHaveBeenCalledOnce();
  } finally {
    listener.close();
    closeStorage.mockRestore();
  }
});

it("closes the assembled Application when combined browser settings are invalid", async () => {
  const storageFactory = new InMemoryStorageFactory();
  const closeStorage = vi.spyOn(storageFactory, "close");
  await expect(
    new MessageBoardApplication().runCombined({ host: " " }, { storageFactory }),
  ).rejects.toThrow();
  expect(closeStorage).toHaveBeenCalledOnce();
});
