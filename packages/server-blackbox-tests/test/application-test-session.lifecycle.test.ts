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

import { Application, BoundedContext, Server } from "@spine-event-engine/server";
import { describe, expect, it, vi } from "vitest";
import { ApplicationTestSession } from "../test-fixtures/application-test-session.js";

describe("Application test session lifecycle", () => {
  it("closes its Application when endpoint startup fails", async () => {
    const start = vi
      .spyOn(Server.prototype, "start")
      .mockRejectedValueOnce(new Error("port unavailable"));
    const close = vi.spyOn(Application.prototype, "close");
    try {
      await expect(
        ApplicationTestSession.open(BoundedContext.singleTenant("Application startup")),
      ).rejects.toThrow("port unavailable");
      expect(close).toHaveBeenCalledOnce();
    } finally {
      start.mockRestore();
      close.mockRestore();
    }
  });
});
