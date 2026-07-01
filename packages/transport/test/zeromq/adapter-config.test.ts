import path from "node:path";

import { describe, expect, expectTypeOf, it } from "vitest";

import {
  type ZeroMqAdapterConfig,
  type ZeroMqNativeModule,
  createZeroMqAdapterConfig,
} from "../../src/zeromq/adapter-config.js";

describe("ZeroMQ adapter-private configuration", () => {
  it("creates immutable local IPC configuration without socket details", () => {
    const config = createZeroMqAdapterConfig({
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
      createZeroMqAdapterConfig({
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
      createZeroMqAdapterConfig({
        ipcDirectory: "relative/ipc",
      }),
    ).toThrow(/absolute local filesystem path/);
    expect(() =>
      createZeroMqAdapterConfig({
        ipcDirectory: "tcp://127.0.0.1:5555",
      }),
    ).toThrow(/absolute local filesystem path/);
    expect(() =>
      createZeroMqAdapterConfig({
        ipcDirectory: `${path.join(path.sep, "tmp", "spine-ts")}\u0000`,
      }),
    ).toThrow(/control characters/);
    expect(() =>
      createZeroMqAdapterConfig({
        ipcDirectory: path.join(path.sep, "tmp", "spine-ts"),
        adapterIdentity: "worker one",
      }),
    ).toThrow(/adapterIdentity/);
  });

  it("keeps ZeroMQ native module typing adapter-private", () => {
    expectTypeOf<ZeroMqNativeModule>().toHaveProperty("Publisher");
    expectTypeOf<ZeroMqAdapterConfig>().toExtend<{
      readonly transportScope: "local-ipc";
      readonly ipcDirectory: string;
      readonly adapterIdentity: string;
      readonly nativePackageName: "zeromq";
    }>();
  });
});
