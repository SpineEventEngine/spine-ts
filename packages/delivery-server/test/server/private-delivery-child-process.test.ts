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

import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DeliveryConfig } from "../../src/server/config.js";

const options = {
  credential: "Bearer slot",
  configuration: DeliveryConfig.resolve({ port: 0 }),
};

async function startChildProcess() {
  const events = new EventEmitter();
  const send = vi.fn();
  const disconnect = vi.fn();
  const ipc = Object.assign(Object.create(process) as NodeJS.Process, {
    on: events.on.bind(events),
    send,
    disconnect,
  });
  Object.defineProperty(ipc, "exitCode", { value: 0, writable: true });
  Object.defineProperty(ipc, "connected", { value: true, writable: true });

  const listener = {
    start: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    baseUrl: "http://127.0.0.1:4321",
  };
  const construct = vi.fn();
  vi.resetModules();
  vi.doMock("../../src/server/private-delivery-child.js", () => ({
    PrivateDeliveryChild: class {
      constructor(config: typeof options) {
        construct(config);
      }

      readonly start = listener.start;

      readonly close = listener.close;

      readonly baseUrl = listener.baseUrl;
    },
  }));

  vi.stubGlobal("process", ipc);
  await import("../../src/server/private-delivery-child-process.js");
  return { ipc, events, send, disconnect, listener, construct };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("../../src/server/private-delivery-child.js");
});

describe("private Delivery child process lifecycle", () => {
  it("reports readiness once and finishes listener shutdown before disconnecting", async () => {
    const { events, send, disconnect, listener, construct } = await startChildProcess();
    events.emit("message", { kind: "start", options });
    events.emit("message", { kind: "start", options });
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledOnce();
    });
    expect(send).toHaveBeenCalledWith({ kind: "ready", baseUrl: listener.baseUrl });
    expect(construct.mock.calls).toEqual([[options]]);

    const closing = Promise.withResolvers<undefined>();
    listener.close.mockReturnValue(closing.promise);
    events.emit("message", { kind: "close" });
    events.emit("message", { kind: "close" });
    expect(listener.close).toHaveBeenCalledOnce();
    expect(disconnect).not.toHaveBeenCalled();
    closing.resolve(undefined);
    await vi.waitFor(() => {
      expect(disconnect).toHaveBeenCalledOnce();
    });
  });

  it("discards a delayed start after the parent disconnects before startup", async () => {
    const { ipc, events, send, disconnect, construct } = await startChildProcess();
    Object.defineProperty(ipc, "connected", { value: false });
    events.emit("disconnect");
    events.emit("message", { kind: "start", options });
    await Promise.resolve();
    expect(construct).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
    expect(ipc.exitCode).toBe(0);
  });

  it("reports a failed listener start and closes before exiting with an error", async () => {
    const { ipc, events, send, disconnect, listener } = await startChildProcess();
    listener.start.mockRejectedValue(new Error("listener failed"));
    events.emit("message", { kind: "start", options });
    await vi.waitFor(() => {
      expect(ipc.exitCode).toBe(1);
    });
    expect(send.mock.calls).toEqual([[{ kind: "failed", message: "Error: listener failed" }]]);
    expect(listener.close).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
