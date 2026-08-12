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

import path from "node:path";

import { describe, expect, expectTypeOf, it } from "vitest";

import { type ZeroMqNativeModule, ZeroMqConfig } from "../../src/zeromq/adapter-config.js";

describe("ZeroMQ adapter-private configuration", () => {
  it("creates immutable local IPC configuration without socket details", () => {
    const config = ZeroMqConfig.create({
      ipcDirectory: ` ${path.join(path.sep, "tmp", "spine-ts", "..", "spine-ts-ipc")} `,
      adapterIdentity: " smoke.worker-01 ",
    });

    expect(config).toEqual({
      transportScope: "local-ipc",
      ipcDirectory: path.join(path.sep, "tmp", "spine-ts-ipc"),
      adapterIdentity: "smoke.worker-01",
      nativePackageName: "zeromq",
    });
    expect(config).not.toHaveProperty("socketType");
    expect(config).not.toHaveProperty("endpoint");
    expect(config).not.toHaveProperty("frames");
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("defaults adapter identity for local IPC smoke-test setup", () => {
    expect(
      ZeroMqConfig.create({
        ipcDirectory: path.join(path.sep, "tmp", "spine-ts-ipc"),
      }),
    ).toEqual({
      transportScope: "local-ipc",
      ipcDirectory: path.join(path.sep, "tmp", "spine-ts-ipc"),
      adapterIdentity: "spine-ts-zmq-adapter",
      nativePackageName: "zeromq",
    });
  });

  it("rejects non-local or malformed IPC configuration", () => {
    expect(() =>
      ZeroMqConfig.create({
        ipcDirectory: "relative/ipc",
      }),
    ).toThrow(/absolute local filesystem path/);
    expect(() =>
      ZeroMqConfig.create({
        ipcDirectory: "tcp://127.0.0.1:5555",
      }),
    ).toThrow(/absolute local filesystem path/);
    expect(() =>
      ZeroMqConfig.create({
        ipcDirectory: `${path.join(path.sep, "tmp", "spine-ts")}\u0000`,
      }),
    ).toThrow(/control characters/);
    expect(() =>
      ZeroMqConfig.create({
        ipcDirectory: path.join(path.sep, "tmp", "spine-ts"),
        adapterIdentity: "worker one",
      }),
    ).toThrow(/adapterIdentity/);
  });

  it("keeps ZeroMQ native module typing adapter-private", () => {
    expectTypeOf<ZeroMqNativeModule>().toHaveProperty("Publisher");
    expectTypeOf<ZeroMqConfig>().toExtend<{
      readonly transportScope: "local-ipc";
      readonly ipcDirectory: string;
      readonly adapterIdentity: string;
      readonly nativePackageName: "zeromq";
    }>();
  });
});
