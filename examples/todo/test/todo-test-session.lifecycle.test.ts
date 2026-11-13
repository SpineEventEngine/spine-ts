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
import { TodoTestSession } from "./todo-test-session.js";

describe("To-Do test session lifecycle", () => {
  it("closes its Application when endpoint startup fails", async () => {
    const start = vi
      .spyOn(Server.prototype, "start")
      .mockRejectedValueOnce(new Error("port unavailable"));
    const close = vi.spyOn(Application.prototype, "close");
    try {
      await expect(
        TodoTestSession.open(BoundedContext.singleTenant("Todo startup")),
      ).rejects.toThrow("port unavailable");
      expect(close).toHaveBeenCalledOnce();
    } finally {
      start.mockRestore();
      close.mockRestore();
    }
  });

  it("closes the endpoint and Application after a client close failure", async () => {
    const session = await TodoTestSession.open(BoundedContext.singleTenant("Todo close"));
    const clientClose = vi
      .spyOn(session.client, "close")
      .mockRejectedValueOnce(new Error("client close failed"));
    const endpointClose = vi.spyOn(session.endpoint, "close");
    const applicationClose = vi.spyOn(session.application, "close");
    try {
      await expect(session.close()).rejects.toThrow("To-Do session cleanup failed");
      expect(endpointClose).toHaveBeenCalledOnce();
      expect(applicationClose).toHaveBeenCalledOnce();
    } finally {
      clientClose.mockRestore();
      endpointClose.mockRestore();
      applicationClose.mockRestore();
    }
  });

  it("keeps the Application open when endpoint cleanup fails", async () => {
    const session = await TodoTestSession.open(
      BoundedContext.singleTenant("Todo endpoint failure"),
    );
    const endpointClose = vi
      .spyOn(session.endpoint, "close")
      .mockRejectedValueOnce(new Error("endpoint still active"));
    const applicationClose = vi.spyOn(session.application, "close");
    try {
      await expect(session.close()).rejects.toThrow("To-Do session cleanup failed");
      expect(applicationClose).not.toHaveBeenCalled();
      await session.close();
      expect(applicationClose).toHaveBeenCalledOnce();
    } finally {
      endpointClose.mockRestore();
      applicationClose.mockRestore();
    }
  });
});
