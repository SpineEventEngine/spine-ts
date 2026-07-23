import { beforeEach, describe, expect, it, vi } from "vitest";

const owned = vi.hoisted(() => ({ aborts: 0, calls: [] as unknown[] }));

vi.mock("@connectrpc/connect-node", () => ({
  Http2SessionManager: class {
    abort(): void {
      owned.aborts += 1;
    }
  },
  createGrpcTransport: (options: unknown) => {
    owned.calls.push(options);
    return {
      unary: () => Promise.reject(new Error("not used")),
      stream: () => Promise.reject(new Error("not used")),
    };
  },
}));

import { DeliveryClient } from "../src/index.js";

describe("DeliveryClient owned HTTP/2 transport", () => {
  beforeEach(() => {
    owned.aborts = 0;
    owned.calls = [];
  });

  it("does not create a session for invalid options or URL", () => {
    expect(() => DeliveryClient.connectTo("http://127.0.0.1:8080", { pageSize: 0 })).toThrow();
    expect(() => DeliveryClient.connectTo("not-a-url")).toThrow();
    expect(owned.calls).toEqual([]);
  });

  it("selects gRPC with bounded bytes and aborts its session exactly once", () => {
    const client = DeliveryClient.connectTo("http://127.0.0.1:8080");

    expect(owned.calls).toEqual([
      expect.objectContaining({
        baseUrl: "http://127.0.0.1:8080",
        readMaxBytes: 4 * 1024 * 1024,
        writeMaxBytes: 4 * 1024 * 1024,
      }),
    ]);
    client.close();
    client.close();

    expect(owned.aborts).toBe(1);
  });
});
