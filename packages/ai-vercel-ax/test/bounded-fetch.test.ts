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

import { describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";

import { createBoundedProviderFetch } from "../src/adapter/bounded-fetch.js";

const url = "https://provider.example/v1/responses";
const encoder = new TextEncoder();

function fixture(chunks: readonly Uint8Array[], status = 200): Response {
  let next = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (next === chunks.length) controller.close();
        else {
          const chunk = chunks[next++];
          if (chunk) controller.enqueue(chunk);
        }
      },
    }),
    {
      status,
      headers: { "content-type": status === 200 ? "text/event-stream" : "application/json" },
    },
  );
}

function harness(response: Response = fixture([encoder.encode("done")])) {
  const network = vi.fn<typeof fetch>().mockResolvedValue(response);
  const reserve = vi.fn(() => Promise.resolve());
  const received: number[] = [];
  let authority = true;
  let now = 100;
  const transport = createBoundedProviderFetch({
    allowedUrls: [url],
    platformFetch: network,
    hasAuthority: () => authority,
    nowEpochMs: () => now,
    reserve,
    onReceived: (_ticket, bytes) => {
      received.push(bytes);
    },
  });
  const admit = (overrides: Partial<Parameters<typeof transport.admit>[0]> = {}) => {
    transport.admit({
      id: "attempt-1",
      maxInputBytes: 20,
      maxOutputBytes: 20,
      deadlineEpochMs: 1_000,
      signal: new AbortController().signal,
      ...overrides,
    });
  };
  return {
    transport,
    admit,
    network,
    reserve,
    received,
    revokeAuthority: () => (authority = false),
    setNow: (value: number) => (now = value),
  };
}

describe("bounded provider fetch", () => {
  it("is inert until admission and permits one dispatch for one ticket", async () => {
    const h = harness();
    await expect(h.transport.fetch(url, { method: "POST", body: "x" })).rejects.toThrow();
    h.admit();
    const response = await h.transport.fetch(url, { method: "POST", body: "x" });
    expect(await response.text()).toBe("done");
    await expect(h.transport.fetch(url, { method: "POST", body: "x" })).rejects.toThrow();
    expect(h.network).toHaveBeenCalledTimes(1);
    expect(h.reserve).toHaveBeenCalledOnce();
  });

  it("admits only one of two simultaneous provider fetches", async () => {
    const h = harness();
    h.admit();
    const first = h.transport.fetch(url, { method: "POST", body: "one" });
    const second = h.transport.fetch(url, { method: "POST", body: "two" });
    const results = await Promise.allSettled([first, second]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(h.reserve).toHaveBeenCalledOnce();
    expect(h.network).toHaveBeenCalledOnce();
  });

  it("rejects a different route, request identity, and oversized UTF-8 body before dispatch", async () => {
    const h = harness();
    h.admit({ maxInputBytes: 2 });
    await expect(
      h.transport.fetch("https://provider.example/v1/other", { method: "POST", body: "x" }),
    ).rejects.toThrow();
    await expect(h.transport.fetch(url, { method: "POST", body: "éé" })).rejects.toThrow();
    expect(h.network).not.toHaveBeenCalled();
    expect(h.reserve).not.toHaveBeenCalled();
    const response = await h.transport.fetch(url, { method: "POST", body: "é" });
    await response.text();
    expect(h.reserve).toHaveBeenCalledWith("attempt-1", 2, 20);
  });

  it("rejects redirects without following them or exposing their body", async () => {
    const h = harness(
      new Response(null, { status: 302, headers: { location: "https://other.example/" } }),
    );
    h.admit();
    await expect(h.transport.fetch(url, { method: "POST", body: "x" })).rejects.toThrow("redirect");
    expect(h.network).toHaveBeenCalledTimes(1);
    expect(h.network.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });

  it("allows exact-limit EOF, empty bodies, and counts split UTF-8 as bytes", async () => {
    const h = harness(fixture([new Uint8Array([0xc3]), new Uint8Array([0xa9])]));
    h.admit({ maxOutputBytes: 2 });
    expect(await (await h.transport.fetch(url, { method: "POST", body: "x" })).text()).toBe("é");
    expect(h.received).toEqual([1, 1]);
    const empty = harness(new Response(null, { status: 204 }));
    empty.admit({ maxOutputBytes: 1 });
    expect((await empty.transport.fetch(url, { method: "POST" })).status).toBe(204);
    expect(empty.received).toEqual([]);
  });

  it.each(["text/event-stream", "application/json"])(
    "drops an oversized %s chunk before parser delivery while reporting its full length",
    async (contentType) => {
      const body = encoder.encode("x".repeat(64 * 1024));
      const response = new Response(
        new ReadableStream({
          start: (c) => {
            c.enqueue(body);
          },
        }),
        {
          status: contentType === "application/json" ? 500 : 200,
          headers: { "content-type": contentType },
        },
      );
      const h = harness(response);
      h.admit({ maxOutputBytes: 8 });
      const guarded = await h.transport.fetch(url, { method: "POST", body: "x" });
      await expect(guarded.text()).rejects.toThrow("limit");
      expect(h.received).toEqual([body.byteLength]);
    },
  );

  it("closes a revoked ticket before dispatch and handles a late platform response", async () => {
    let resolve!: (response: Response) => void;
    const network = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const controller = new AbortController();
    const h = harness();
    const transport = createBoundedProviderFetch({
      allowedUrls: [url],
      platformFetch: network,
      hasAuthority: () => !controller.signal.aborted,
      nowEpochMs: () => 100,
      reserve: h.reserve,
      onReceived: () => undefined,
    });
    transport.admit({
      id: "late",
      maxInputBytes: 10,
      maxOutputBytes: 10,
      deadlineEpochMs: 1_000,
      signal: controller.signal,
    });
    const pending = transport.fetch(url, { method: "POST", body: "x" });
    await vi.waitFor(() => {
      expect(network).toHaveBeenCalledOnce();
    });
    controller.abort();
    await expect(pending).rejects.toThrow();
    const cancel = vi.fn();
    resolve(new Response(new ReadableStream({ cancel })));
    await vi.waitFor(() => {
      expect(cancel).toHaveBeenCalled();
    });
    await expect(transport.fetch(url, { method: "POST", body: "x" })).rejects.toThrow();
  });

  it("settles cancellation while durable reservation ignores the abort signal", async () => {
    const network = vi.fn<typeof fetch>();
    const controller = new AbortController();
    const transport = createBoundedProviderFetch({
      allowedUrls: [url],
      platformFetch: network,
      hasAuthority: () => true,
      nowEpochMs: () => 100,
      reserve: () => new Promise<void>(() => undefined),
      onReceived: () => {
        throw new Error("must not receive");
      },
    });
    transport.admit({
      id: "waiting",
      maxInputBytes: 2,
      maxOutputBytes: 2,
      deadlineEpochMs: 1_000,
      signal: controller.signal,
    });
    const pending = transport.fetch(url, { method: "POST", body: "x" });
    controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
    expect(network).not.toHaveBeenCalled();
  });

  it("settles cancellation while Blob materialization ignores abort and contains a late rejection", async () => {
    let rejectBody!: (error: Error) => void;
    const body = new Blob(["x"]);
    body.arrayBuffer = () =>
      new Promise((_resolve, reject) => {
        rejectBody = reject;
      });
    const h = harness();
    const controller = new AbortController();
    h.admit({ signal: controller.signal });
    const pending = h.transport.fetch(url, { method: "POST", body });
    controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
    rejectBody(new Error("secret late failure"));
    await Promise.resolve();
    expect(h.reserve).not.toHaveBeenCalled();
    expect(h.network).not.toHaveBeenCalled();
  });

  it("settles a materialization deadline with a distinct timeout error", async () => {
    vi.useFakeTimers();
    try {
      const body = new Blob(["x"]);
      body.arrayBuffer = () => new Promise(() => undefined);
      let now = 100;
      const network = vi.fn<typeof fetch>();
      const transport = createBoundedProviderFetch({
        allowedUrls: [url],
        platformFetch: network,
        hasAuthority: () => true,
        nowEpochMs: () => now,
        reserve: () => Promise.resolve(),
        onReceived: () => undefined,
      });
      transport.admit({
        id: "deadline",
        maxInputBytes: 1,
        maxOutputBytes: 1,
        deadlineEpochMs: 110,
        signal: new AbortController().signal,
      });
      const pending = transport.fetch(url, { method: "POST", body });
      const assertion = expect(pending).rejects.toThrow("deadline exceeded");
      now = 110;
      await vi.advanceTimersByTimeAsync(10);
      await assertion;
      expect(network).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("schedules distant deadlines in bounded timer chunks", () => {
    const realSetTimeout = globalThis.setTimeout;
    const delays: number[] = [];
    const schedule = vi.spyOn(globalThis, "setTimeout").mockImplementation((callback, delay) => {
      delays.push(Number(delay));
      return realSetTimeout(callback, 10_000);
    });
    try {
      const h = harness();
      h.admit({ deadlineEpochMs: 2_147_483_748 });
      expect(delays[0]).toBeLessThanOrEqual(2_147_483_647);
      h.transport.revoke();
    } finally {
      schedule.mockRestore();
    }
  });

  it("rechecks the supplied clock before expiring a distant deadline timer", async () => {
    vi.useFakeTimers();
    const scheduled: (() => void)[] = [];
    const original = globalThis.setTimeout;
    const timer = vi.spyOn(globalThis, "setTimeout").mockImplementation((callback) => {
      scheduled.push(callback);
      return original(() => undefined, 10_000);
    });
    try {
      let now = 0;
      const network = vi.fn<typeof fetch>();
      const transport = createBoundedProviderFetch({
        allowedUrls: [url],
        platformFetch: network,
        hasAuthority: () => true,
        nowEpochMs: () => now,
        reserve: () => Promise.resolve(),
        onReceived: () => undefined,
      });
      transport.admit({
        id: "far",
        maxInputBytes: 1,
        maxOutputBytes: 1,
        deadlineEpochMs: 2_147_483_648,
        signal: new AbortController().signal,
      });
      scheduled[0]?.();
      expect(scheduled).toHaveLength(2);
      now = 2_147_483_648;
      scheduled[1]?.();
      await expect(transport.fetch(url, { method: "POST", body: "x" })).rejects.toThrow(
        "deadline exceeded",
      );
      expect(network).not.toHaveBeenCalled();
    } finally {
      timer.mockRestore();
      vi.useRealTimers();
    }
  });

  it("closes a pending body read when the consumer cancels", async () => {
    const cancel = vi.fn();
    const h = harness(
      new Response(new ReadableStream({ pull: () => new Promise<void>(() => undefined), cancel })),
    );
    h.admit();
    const response = await h.transport.fetch(url, { method: "POST", body: "x" });
    const reader = response.body?.getReader();
    const pending = reader?.read();
    await reader?.cancel();
    await expect(pending).resolves.toMatchObject({ done: true });
    expect(cancel).toHaveBeenCalled();
  });

  it("prevents dispatch when authority is lost or deadline has passed", async () => {
    const stale = harness();
    stale.admit();
    stale.revokeAuthority();
    await expect(stale.transport.fetch(url, { method: "POST", body: "x" })).rejects.toThrow();
    expect(stale.reserve).not.toHaveBeenCalled();
    const expired = harness();
    expired.admit();
    expired.setNow(1_000);
    await expect(expired.transport.fetch(url, { method: "POST", body: "x" })).rejects.toThrow(
      "deadline",
    );
    expect(expired.network).not.toHaveBeenCalled();
  });

  it("contains a failed runtime clock callback before admission can dispatch", () => {
    const network = vi.fn<typeof fetch>();
    const transport = createBoundedProviderFetch({
      allowedUrls: [url],
      platformFetch: network,
      hasAuthority: () => true,
      nowEpochMs: () => {
        throw new Error("secret clock detail");
      },
      reserve: () => Promise.resolve(),
      onReceived: () => undefined,
    });
    expect(() => {
      transport.admit({
        id: "clock",
        maxInputBytes: 1,
        maxOutputBytes: 1,
        deadlineEpochMs: 1_000,
        signal: new AbortController().signal,
      });
    }).toThrow("clock unavailable");
    expect(network).not.toHaveBeenCalled();
  });

  it("rejects revoked admission, overlapping tickets, invalid limits and credential-bearing routes", async () => {
    const h = harness();
    expect(() => {
      h.admit({ maxOutputBytes: -1 });
    }).toThrow("invalid");
    expect(() => {
      h.admit({ maxOutputBytes: 0 });
    }).toThrow("invalid");
    h.admit();
    expect(() => {
      h.admit();
    }).toThrow("active");
    await expect(
      h.transport.fetch("https://user:secret@provider.example/v1/responses", { method: "POST" }),
    ).rejects.toThrow("route");
    await expect(h.transport.fetch(new Request(url), { method: "POST" })).rejects.toThrow("route");
    h.transport.revoke();
    expect(() => {
      h.admit();
    }).toThrow("active");
    expect(h.network).not.toHaveBeenCalled();
  });

  it("keeps admitted credit, deadline and identity fixed after the caller mutates a ticket", async () => {
    const h = harness(fixture([encoder.encode("abcdef")]));
    const ticket = {
      id: "original",
      maxInputBytes: 5,
      maxOutputBytes: 1,
      deadlineEpochMs: 1_000,
      signal: new AbortController().signal,
    };
    h.transport.admit(ticket);
    ticket.id = "changed";
    ticket.maxInputBytes = 100;
    ticket.maxOutputBytes = 100;
    ticket.deadlineEpochMs = 1_000_000;
    const response = await h.transport.fetch(url, { method: "POST", body: "x" });
    await expect(response.text()).rejects.toThrow("limit");
    expect(h.reserve).toHaveBeenCalledWith("original", 1, 1);
    expect(h.received).toEqual([6]);
  });

  it("keeps admitted input size and deadline fixed after ticket mutation", async () => {
    const input = harness();
    const inputTicket = {
      id: "input",
      maxInputBytes: 1,
      maxOutputBytes: 1,
      deadlineEpochMs: 1_000,
      signal: new AbortController().signal,
    };
    input.transport.admit(inputTicket);
    inputTicket.maxInputBytes = 100;
    await expect(input.transport.fetch(url, { method: "POST", body: "xx" })).rejects.toThrow(
      "limit",
    );
    expect(input.reserve).not.toHaveBeenCalled();

    const deadline = harness();
    const deadlineTicket = {
      id: "deadline",
      maxInputBytes: 1,
      maxOutputBytes: 1,
      deadlineEpochMs: 1_000,
      signal: new AbortController().signal,
    };
    deadline.transport.admit(deadlineTicket);
    deadlineTicket.deadlineEpochMs = 1_000_000;
    deadline.setNow(1_000);
    await expect(deadline.transport.fetch(url, { method: "POST", body: "x" })).rejects.toThrow(
      "deadline exceeded",
    );
    expect(deadline.network).not.toHaveBeenCalled();
  });

  it("dispatches the approved URL snapshot after an SDK URL object changes", async () => {
    let release!: (bytes: ArrayBuffer) => void;
    const body = new Blob(["x"]);
    body.arrayBuffer = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const mutableUrl = new URL(url);
    const h = harness();
    h.admit();
    const pending = h.transport.fetch(mutableUrl, { method: "POST", body });
    mutableUrl.hostname = "unapproved.example";
    release(encoder.encode("x").buffer);
    await (await pending).text();
    expect(h.network.mock.calls[0]?.[0]).toBe(url);
  });

  it.each([
    ["parameters", new URLSearchParams({ a: "1" }), 3],
    ["array buffer", encoder.encode("ab").buffer, 2],
    ["typed array", encoder.encode("abc").subarray(1), 2],
    ["blob", new Blob(["xy"]), 2],
  ])("counts actual %s request body bytes", async (_name, body, expected) => {
    const h = harness();
    h.admit();
    await (await h.transport.fetch(url, { method: "POST", body })).text();
    expect(h.reserve).toHaveBeenCalledWith("attempt-1", expected, 20);
  });

  it("rejects an unbounded streaming request body and an oversized blob before reservation", async () => {
    const h = harness();
    h.admit({ maxInputBytes: 2 });
    const stream = new ReadableStream({ pull: () => new Promise<void>(() => undefined) });
    await expect(
      h.transport.fetch(url, { method: "POST", body: stream, duplex: "half" } as RequestInit),
    ).rejects.toThrow("unsupported");
    await expect(
      h.transport.fetch(url, { method: "POST", body: new Blob(["abc"]) }),
    ).rejects.toThrow("unsupported");
    expect(h.reserve).not.toHaveBeenCalled();
  });

  it("bounds URL-encoded request bytes before concatenating more parameters", async () => {
    const h = harness();
    h.admit({ maxInputBytes: 4 });
    await expect(
      h.transport.fetch(url, { method: "POST", body: new URLSearchParams({ long: "value" }) }),
    ).rejects.toThrow("limit");
    await expect(
      h.transport.fetch(url, { method: "POST", body: new URLSearchParams({ a: "é" }) }),
    ).rejects.toThrow("limit");
    expect(h.reserve).not.toHaveBeenCalled();
  });

  it("does not expose reservation or fetch exception details and does not refund credit", async () => {
    const secret = "Bearer hidden-provider-credential";
    const network = vi.fn<typeof fetch>().mockRejectedValue(new Error(secret));
    const reserve = vi.fn(() => Promise.resolve());
    const transport = createBoundedProviderFetch({
      allowedUrls: [url],
      platformFetch: network,
      hasAuthority: () => true,
      nowEpochMs: () => 100,
      reserve,
      onReceived: () => undefined,
    });
    transport.admit({
      id: "error",
      maxInputBytes: 5,
      maxOutputBytes: 10,
      deadlineEpochMs: 1_000,
      signal: new AbortController().signal,
    });
    await expect(transport.fetch(url, { method: "POST", body: "x" })).rejects.toThrow(
      "request failed",
    );
    expect(reserve).toHaveBeenCalledOnce();
    expect(network).toHaveBeenCalledOnce();
    await expect(transport.fetch(url, { method: "POST", body: "x" })).rejects.toThrow();
    expect(reserve).toHaveBeenCalledOnce();
  });

  it("does not trust a reservation callback error that imitates transport wording", async () => {
    const network = vi.fn<typeof fetch>();
    const transport = createBoundedProviderFetch({
      allowedUrls: [url],
      platformFetch: network,
      hasAuthority: () => true,
      nowEpochMs: () => 100,
      reserve: () => Promise.reject(new Error("Provider transport secret tenant token")),
      onReceived: () => undefined,
    });
    transport.admit({
      id: "reserve-error",
      maxInputBytes: 1,
      maxOutputBytes: 1,
      deadlineEpochMs: 1_000,
      signal: new AbortController().signal,
    });
    await expect(transport.fetch(url, { method: "POST", body: "x" })).rejects.toThrow(
      "request failed",
    );
    expect(network).not.toHaveBeenCalled();
  });

  it("does not expose a receipt callback error containing limit and a secret", async () => {
    const transport = createBoundedProviderFetch({
      allowedUrls: [url],
      platformFetch: vi.fn<typeof fetch>().mockResolvedValue(fixture([encoder.encode("x")])),
      hasAuthority: () => true,
      nowEpochMs: () => 100,
      reserve: () => Promise.resolve(),
      onReceived: () => {
        throw new Error("write limit for secret tenant token");
      },
    });
    transport.admit({
      id: "receipt-error",
      maxInputBytes: 1,
      maxOutputBytes: 1,
      deadlineEpochMs: 1_000,
      signal: new AbortController().signal,
    });
    const response = await transport.fetch(url, { method: "POST", body: "x" });
    await expect(response.text()).rejects.toThrow("response read failed");
  });

  it("preserves cancellation while the SDK is reading a response", async () => {
    const controller = new AbortController();
    const h = harness(
      new Response(new ReadableStream({ pull: () => new Promise<void>(() => undefined) })),
    );
    h.admit({ signal: controller.signal });
    const response = await h.transport.fetch(url, { method: "POST", body: "x" });
    const pending = response.text();
    const assertion = expect(pending).rejects.toThrow("cancelled");
    controller.abort();
    await assertion;
  });

  it("preserves deadline expiry while the SDK is reading a response", async () => {
    vi.useFakeTimers();
    try {
      let now = 100;
      const transport = createBoundedProviderFetch({
        allowedUrls: [url],
        hasAuthority: () => true,
        nowEpochMs: () => now,
        platformFetch: vi
          .fn<typeof fetch>()
          .mockResolvedValue(
            new Response(new ReadableStream({ pull: () => new Promise<void>(() => undefined) })),
          ),
        reserve: () => Promise.resolve(),
        onReceived: () => undefined,
      });
      transport.admit({
        id: "stream-deadline",
        maxInputBytes: 1,
        maxOutputBytes: 1,
        deadlineEpochMs: 110,
        signal: new AbortController().signal,
      });
      const response = await transport.fetch(url, { method: "POST", body: "x" });
      const assertion = expect(response.text()).rejects.toThrow("deadline exceeded");
      now = 110;
      await vi.advanceTimersByTimeAsync(10);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("sanitizes malformed URLs and request materialization failures", async () => {
    const h = harness();
    h.admit();
    await expect(
      h.transport.fetch("not a URL with hidden-token", { method: "POST" }),
    ).rejects.toThrow("route rejected");
    const body = new Blob(["x"]);
    body.arrayBuffer = () => Promise.reject(new Error("Bearer hidden-provider-credential"));
    await expect(h.transport.fetch(url, { method: "POST", body })).rejects.toThrow("request body");
    expect(h.reserve).not.toHaveBeenCalled();
  });

  it("keeps the guarded body pull-driven and never calls receipt persistence after revocation", async () => {
    let pulls = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pulls++;
            controller.enqueue(encoder.encode("x"));
          },
        },
        { highWaterMark: 0 },
      ),
    );
    const h = harness(response);
    h.admit();
    const guarded = await h.transport.fetch(url, { method: "POST", body: "x" });
    expect(pulls).toBe(0);
    h.transport.revoke();
    await expect(guarded.text()).rejects.toThrow();
    expect(h.received).toEqual([]);
  });

  it("counts decompressed body bytes from a real local HTTP response", async () => {
    const plain = encoder.encode("z".repeat(4_096));
    const compressed = gzipSync(plain);
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-encoding": "gzip", "content-type": "application/json" });
      response.end(compressed);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No fixture port");
      const endpoint = `http://127.0.0.1:${String(address.port)}/v1/responses`;
      const received: number[] = [];
      const transport = createBoundedProviderFetch({
        allowedUrls: [endpoint],
        platformFetch: fetch,
        hasAuthority: () => true,
        nowEpochMs: () => 100,
        reserve: () => Promise.resolve(),
        onReceived: (_id, bytes) => {
          received.push(bytes);
        },
      });
      transport.admit({
        id: "gzip",
        maxInputBytes: 0,
        maxOutputBytes: 1_000,
        deadlineEpochMs: 5_000,
        signal: new AbortController().signal,
      });
      await expect((await transport.fetch(endpoint, { method: "POST" })).text()).rejects.toThrow(
        "limit",
      );
      expect(received.reduce((sum, bytes) => sum + bytes, 0)).toBe(plain.byteLength);
      expect(compressed.byteLength).toBeLessThan(1_000);
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    }
  });
});
