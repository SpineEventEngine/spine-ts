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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const application = vi.hoisted(() => ({
  run: vi.fn(() => Promise.resolve({ baseUrl: "http://127.0.0.1:24001" })),
}));
vi.mock("../src/index.js", () => ({
  MessageBoardApplication: class {
    run = application.run;
  },
}));

const originalLocalPort = process.env.MESSAGE_BOARD_LOCAL_PORT;
const originalWebPort = process.env.MESSAGE_BOARD_WEB_PORT;

beforeEach(() => {
  vi.resetModules();
  application.run.mockClear();
});
afterEach(() => {
  if (originalLocalPort === undefined) delete process.env.MESSAGE_BOARD_LOCAL_PORT;
  else process.env.MESSAGE_BOARD_LOCAL_PORT = originalLocalPort;
  if (originalWebPort === undefined) delete process.env.MESSAGE_BOARD_WEB_PORT;
  else process.env.MESSAGE_BOARD_WEB_PORT = originalWebPort;
  vi.restoreAllMocks();
});

describe("local MessageBoard launch configuration", () => {
  it.each(["-1", "01", "1.5", "65536", "9007199254740992"])(
    "rejects invalid application port %s before starting the server",
    async (configuredPort) => {
      process.env.MESSAGE_BOARD_LOCAL_PORT = configuredPort;
      process.env.MESSAGE_BOARD_WEB_PORT = "25173";
      await expect(import("../src/local-application-server.js")).rejects.toThrow(
        "MESSAGE_BOARD_LOCAL_PORT must be a TCP port between 0 and 65535.",
      );
      expect(application.run).not.toHaveBeenCalled();
    },
  );

  it.each(["0", "-1", "01", "1.5", "65536", "9007199254740992"])(
    "rejects invalid UI origin port %s before starting the server",
    async (configuredPort) => {
      process.env.MESSAGE_BOARD_LOCAL_PORT = "0";
      process.env.MESSAGE_BOARD_WEB_PORT = configuredPort;
      await expect(import("../src/local-application-server.js")).rejects.toThrow(
        "MESSAGE_BOARD_WEB_PORT must be a TCP port between 1 and 65535.",
      );
      expect(application.run).not.toHaveBeenCalled();
    },
  );

  it("passes explicit task-local ports to the app and reports its actual endpoint", async () => {
    process.env.MESSAGE_BOARD_LOCAL_PORT = "0";
    process.env.MESSAGE_BOARD_WEB_PORT = "25173";
    const logged = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await import("../src/local-application-server.js");
    expect(application.run).toHaveBeenCalledExactlyOnceWith({
      port: 0,
      webOrigin: "http://127.0.0.1:25173",
    });
    expect(logged).toHaveBeenCalledWith(
      "MessageBoard local server ready at http://127.0.0.1:24001",
    );
  });

  it("uses documented default ports when no override is set", async () => {
    delete process.env.MESSAGE_BOARD_LOCAL_PORT;
    delete process.env.MESSAGE_BOARD_WEB_PORT;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    await import("../src/local-application-server.js");
    expect(application.run).toHaveBeenCalledExactlyOnceWith({
      port: 8090,
      webOrigin: "http://127.0.0.1:5173",
    });
  });
});
