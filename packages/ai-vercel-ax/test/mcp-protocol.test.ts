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

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateJSONRPCMessage } from "@ai-sdk/mcp";
import type { AiMcpProtocolControl } from "@spine-event-engine/ai/spi/adapter";
import { createMcpProtocolFactory } from "../src/adapter/mcp-protocol.js";
import { BoundedMcpHttpTransport } from "../src/adapter/mcp-http-transport.js";
import { BoundedMcpStdioTransport } from "../src/adapter/mcp-stdio-transport.js";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) =>
          server.close(() => {
            resolve();
          }),
        ),
    ),
  );
});

describe("bounded MCP protocol", () => {
  it("preflights stdio call intent and cancellation before writing", async () => {
    const sessionSignal = new AbortController().signal;
    const cancelled = new AbortController();
    cancelled.abort();
    const reserveMessage = vi.fn(() =>
      Promise.resolve({
        id: "cancelled-stdio",
        signal: cancelled.signal,
        deadlineEpochMs: Date.now() + 1_000,
        maxOutputBytes: 100,
      }),
    );
    const finishMessage = vi.fn(() => Promise.resolve());
    const transport = new BoundedMcpStdioTransport(
      process.execPath,
      [fileURLToPath(new URL("./fixtures/mcp-stdio-server.mjs", import.meta.url))],
      undefined,
      {},
      {
        signal: sessionSignal,
        deadlineEpochMs: Date.now() + 1_000,
        nowEpochMs: Date.now,
        hasAuthority: () => true,
        reserveMessage,
        onReceived: vi.fn(),
        finishMessage,
      },
    );
    await transport.start();
    await expect(transport.send({ jsonrpc: "2.0", id: 1, method: "tools/call" })).rejects.toThrow(
      "persisted intent",
    );
    expect(reserveMessage).not.toHaveBeenCalled();
    transport.setCallTicket("persisted-call", 100);
    expect(() => {
      transport.setCallTicket("second", 100);
    }).toThrow("already active");
    await expect(transport.send({ jsonrpc: "2.0", id: 2, method: "tools/call" })).rejects.toThrow(
      "cancelled",
    );
    expect(finishMessage).toHaveBeenCalledWith("cancelled-stdio");
    transport.clearCallTicket();
    await transport.close();
    await transport.close();
    await expect(transport.start()).rejects.toThrow("cancelled");
  });

  it("holds stdio close behind a completed response receipt without late delivery", async () => {
    const signal = new AbortController().signal;
    const events: string[] = [];
    let release!: () => void;
    const journal = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transport = new BoundedMcpStdioTransport(
      process.execPath,
      [fileURLToPath(new URL("./fixtures/mcp-stdio-server.mjs", import.meta.url))],
      undefined,
      {},
      {
        signal,
        deadlineEpochMs: Date.now() + 3_000,
        nowEpochMs: Date.now,
        hasAuthority: () => true,
        reserveMessage: () =>
          Promise.resolve({
            id: "completed",
            signal,
            deadlineEpochMs: Date.now() + 3_000,
            maxOutputBytes: 4_096,
          }),
        onReceived: vi.fn(),
        finishMessage: () => {
          events.push("receipt-start");
          return journal.then(() => {
            events.push("receipt-finished");
          });
        },
      },
    );
    transport.onmessage = () => {
      events.push("delivered");
    };
    transport.onclose = () => {
      events.push("closed");
    };
    await transport.start();
    await transport.send({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await vi.waitFor(() => {
      expect(events).toContain("receipt-start");
    });
    await expect(transport.send({ jsonrpc: "2.0", id: 2, method: "tools/list" })).rejects.toThrow(
      "Concurrent",
    );
    let closeFinished = false;
    const closing = transport.close().finally(() => {
      closeFinished = true;
    });
    await Promise.resolve();
    expect(closeFinished).toBe(false);
    expect(events).not.toContain("closed");
    release();
    await closing;
    expect(events).toEqual(["receipt-start", "receipt-finished", "closed"]);
  }, 3_000);

  it("reports a failed stdio receipt with a safe close error and no delivered response", async () => {
    const signal = new AbortController().signal;
    const delivered = vi.fn();
    const reported = vi.fn();
    const transport = new BoundedMcpStdioTransport(
      process.execPath,
      [fileURLToPath(new URL("./fixtures/mcp-stdio-server.mjs", import.meta.url))],
      undefined,
      {},
      {
        signal,
        deadlineEpochMs: Date.now() + 3_000,
        nowEpochMs: Date.now,
        hasAuthority: () => true,
        reserveMessage: () =>
          Promise.resolve({
            id: "failed-receipt",
            signal,
            deadlineEpochMs: Date.now() + 3_000,
            maxOutputBytes: 4_096,
          }),
        onReceived: vi.fn(),
        finishMessage: () => Promise.reject(new Error("secret journal error")),
      },
    );
    transport.onmessage = delivered;
    transport.onerror = reported;
    await transport.start();
    await transport.send({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await vi.waitFor(() => {
      expect(reported).toHaveBeenCalledOnce();
    });
    await expect(transport.close()).rejects.toThrow("MCP stdio message journal failed");
    expect(delivered).not.toHaveBeenCalled();
    expect(JSON.stringify(reported.mock.calls)).not.toContain("secret journal error");
  }, 3_000);

  it("rejects a second stdio send while the first response is pending", async () => {
    const signal = new AbortController().signal;
    const reserveMessage = vi.fn(() =>
      Promise.resolve({
        id: "first-call",
        signal,
        deadlineEpochMs: Date.now() + 3_000,
        maxOutputBytes: 4_096,
      }),
    );
    const transport = new BoundedMcpStdioTransport(
      process.execPath,
      [fileURLToPath(new URL("./fixtures/mcp-stdio-server.mjs", import.meta.url))],
      undefined,
      { MCP_DELAY_MS: "500" },
      {
        signal,
        deadlineEpochMs: Date.now() + 3_000,
        nowEpochMs: Date.now,
        hasAuthority: () => true,
        reserveMessage,
        onReceived: vi.fn(),
        finishMessage: vi.fn(() => Promise.resolve()),
      },
    );
    await transport.start();
    transport.setCallTicket("saved-call", 4_096);
    await transport.send({ jsonrpc: "2.0", id: 1, method: "tools/call" });
    await expect(transport.send({ jsonrpc: "2.0", id: 2, method: "tools/call" })).rejects.toThrow(
      "Concurrent",
    );
    expect(reserveMessage).toHaveBeenCalledOnce();
    await transport.close();
  }, 3_000);

  it("closes a stdio child that emits an unsolicited response", async () => {
    const signal = new AbortController().signal;
    const reserveMessage = vi.fn();
    const reported = vi.fn();
    const transport = new BoundedMcpStdioTransport(
      process.execPath,
      [fileURLToPath(new URL("./fixtures/mcp-stdio-server.mjs", import.meta.url))],
      undefined,
      { MCP_UNSOLICITED_STDOUT: "1" },
      {
        signal,
        deadlineEpochMs: Date.now() + 3_000,
        nowEpochMs: Date.now,
        hasAuthority: () => true,
        reserveMessage,
        onReceived: vi.fn(),
        finishMessage: vi.fn(() => Promise.resolve()),
      },
    );
    transport.onerror = reported;
    await transport.start();
    await vi.waitFor(() => {
      expect(reported).toHaveBeenCalledOnce();
    });
    expect(reserveMessage).not.toHaveBeenCalled();
    expect(reported.mock.calls[0]?.[0]).toMatchObject({
      message: "Unsolicited MCP stdio output",
    });
    await transport.close();
  }, 3_000);

  it.each([
    ["redirect", 302, "application/json", "{}", "redirect"],
    ["server failure", 503, "application/json", "{}", "HTTP 503"],
    ["unsupported content", 200, "text/plain", "{}", "content type"],
    ["missing content type", 200, undefined, "{}", "content type"],
    ["invalid JSON", 200, "application/json", "{", "JSON"],
  ])(
    "rejects a %s response after its journal barrier",
    async (_name, status, contentType, body, reason) => {
      const signal = new AbortController().signal;
      const events: string[] = [];
      const finishMessage = vi.fn(() => {
        events.push("finished");
        return Promise.resolve();
      });
      const transport = new BoundedMcpHttpTransport(
        "https://fixture.example/mcp",
        {},
        {
          signal,
          deadlineEpochMs: Date.now() + 1_000,
          nowEpochMs: Date.now,
          hasAuthority: () => true,
          reserveMessage: () =>
            Promise.resolve({
              id: "failure",
              signal,
              deadlineEpochMs: Date.now() + 1_000,
              maxOutputBytes: 100,
            }),
          onReceived: () => {
            events.push("received");
          },
          finishMessage,
        },
        () =>
          Promise.resolve(
            new Response(body, {
              status,
              ...(contentType === undefined ? {} : { headers: { "content-type": contentType } }),
            }),
          ),
      );
      transport.onmessage = () => {
        events.push("delivered");
      };
      await transport.start();
      await expect(transport.send({ jsonrpc: "2.0", id: 1, method: "initialize" })).rejects.toThrow(
        reason,
      );
      expect(events.at(-1)).toBe("finished");
      expect(finishMessage).toHaveBeenCalledWith("failure", undefined);
      await transport.close();
    },
  );

  it.each([
    ["LF-terminated", 'data: {"jsonrpc":"2.0","id":1,"result":{}}\n\n'],
    ["CRLF without final newline", 'data: {"jsonrpc":"2.0","id":1,"result":{}}\r'],
  ])("parses %s SSE frames only after finishing the message journal", async (_name, frame) => {
    const signal = new AbortController().signal;
    const events: string[] = [];
    const transport = new BoundedMcpHttpTransport(
      "https://fixture.example/mcp",
      {},
      {
        signal,
        deadlineEpochMs: Date.now() + 1_000,
        nowEpochMs: Date.now,
        hasAuthority: () => true,
        reserveMessage: () =>
          Promise.resolve({
            id: "sse",
            signal,
            deadlineEpochMs: Date.now() + 1_000,
            maxOutputBytes: 200,
          }),
        onReceived: () => {
          events.push("received");
        },
        finishMessage: () => {
          events.push("finished");
          return Promise.resolve();
        },
      },
      () =>
        Promise.resolve(
          new Response(frame, {
            headers: { "content-type": "text/event-stream" },
          }),
        ),
    );
    transport.onmessage = () => {
      events.push("delivered");
    };
    await transport.start();
    await transport.send({ jsonrpc: "2.0", id: 1, method: "initialize" });
    expect(events).toEqual(["received", "finished", "delivered"]);
    await transport.close();
  });

  it("finishes a matching SSE result without waiting for stream EOF", async () => {
    const signal = new AbortController().signal;
    const events: string[] = [];
    const cancelBody = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from('data: {"jsonrpc":"2.0","id":1,"result":{}}\n\n'));
      },
      cancel: cancelBody,
    });
    const transport = new BoundedMcpHttpTransport(
      "https://fixture.example/mcp",
      {},
      {
        signal,
        deadlineEpochMs: Date.now() + 1_000,
        nowEpochMs: Date.now,
        hasAuthority: () => true,
        reserveMessage: () =>
          Promise.resolve({
            id: "open-sse",
            signal,
            deadlineEpochMs: Date.now() + 1_000,
            maxOutputBytes: 200,
          }),
        onReceived: () => {
          events.push("received");
        },
        finishMessage: () => {
          events.push("finished");
          return Promise.resolve();
        },
      },
      () =>
        Promise.resolve(
          new Response(body, {
            headers: { "content-type": "text/event-stream" },
          }),
        ),
    );
    transport.onmessage = () => {
      events.push("delivered");
    };
    await transport.start();
    await expect(
      transport.send({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    ).resolves.toBeUndefined();
    expect(events).toEqual(["received", "finished", "delivered"]);
    expect(cancelBody).toHaveBeenCalledOnce();
    await transport.close();
  }, 1_000);

  it("parses one-byte SSE fragments without rescanning incomplete frames", async () => {
    const signal = new AbortController().signal;
    const frame = Buffer.from(
      `data: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { text: "x".repeat(2_048) } })}\n\n`,
    );
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of frame) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    });
    const transport = new BoundedMcpHttpTransport(
      "https://fixture.example/mcp",
      {},
      {
        signal,
        deadlineEpochMs: Date.now() + 5_000,
        nowEpochMs: Date.now,
        hasAuthority: () => true,
        reserveMessage: () =>
          Promise.resolve({
            id: "fragments",
            signal,
            deadlineEpochMs: Date.now() + 5_000,
            maxOutputBytes: frame.byteLength + 1,
          }),
        onReceived: vi.fn(),
        finishMessage: vi.fn(() => Promise.resolve()),
      },
      () =>
        Promise.resolve(
          new Response(body, {
            headers: { "content-type": "text/event-stream" },
          }),
        ),
    );
    const delivered = vi.fn();
    transport.onmessage = delivered;
    const split = vi.spyOn(String.prototype, "split");
    try {
      await transport.start();
      await transport.send({ jsonrpc: "2.0", id: 1, method: "initialize" });
      expect(delivered).toHaveBeenCalledOnce();
      const frameSplits = split.mock.calls.filter(
        ([separator]) => separator instanceof RegExp && separator.source === "\\r?\\n\\r?\\n",
      );
      expect(frameSplits.length).toBeLessThan(5);
    } finally {
      split.mockRestore();
      await transport.close();
    }
  });

  it("waits past unrelated SSE frames for the matching request response", async () => {
    const signal = new AbortController().signal;
    const delivered: (string | number)[] = [];
    let sendMatch!: () => void;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from('data: {"jsonrpc":"2.0","id":999,"result":{}}\n\n'));
        sendMatch = () => {
          controller.enqueue(Buffer.from('data: {"jsonrpc":"2.0","id":1,"result":{}}\n\n'));
        };
      },
    });
    const transport = new BoundedMcpHttpTransport(
      "https://fixture.example/mcp",
      {},
      {
        signal,
        deadlineEpochMs: Date.now() + 1_000,
        nowEpochMs: Date.now,
        hasAuthority: () => true,
        reserveMessage: () =>
          Promise.resolve({
            id: "matching",
            signal,
            deadlineEpochMs: Date.now() + 1_000,
            maxOutputBytes: 300,
          }),
        onReceived: vi.fn(),
        finishMessage: vi.fn(() => Promise.resolve()),
      },
      () =>
        Promise.resolve(
          new Response(body, {
            headers: { "content-type": "text/event-stream" },
          }),
        ),
    );
    transport.onmessage = (message) => {
      if ("id" in message && message.id !== undefined) delivered.push(message.id);
    };
    await transport.start();
    const pending = transport.send({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await Promise.resolve();
    expect(delivered).toEqual([]);
    sendMatch();
    await pending;
    expect(delivered).toEqual([999, 1]);
    await transport.close();
  });

  it("journals finite notification-only SSE without fabricating a matching response", async () => {
    const signal = new AbortController().signal;
    const onmessage = vi.fn();
    const transport = new BoundedMcpHttpTransport(
      "https://fixture.example/mcp",
      {},
      {
        signal,
        deadlineEpochMs: Date.now() + 1_000,
        nowEpochMs: Date.now,
        hasAuthority: () => true,
        reserveMessage: () =>
          Promise.resolve({
            id: "notification",
            signal,
            deadlineEpochMs: Date.now() + 1_000,
            maxOutputBytes: 200,
          }),
        onReceived: vi.fn(),
        finishMessage: vi.fn(() => Promise.resolve()),
      },
      () =>
        Promise.resolve(
          new Response(
            'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\n\n',
            { headers: { "content-type": "text/event-stream" } },
          ),
        ),
    );
    transport.onmessage = onmessage;
    await transport.start();
    await transport.send({ jsonrpc: "2.0", id: 1, method: "initialize" });
    expect(onmessage).toHaveBeenCalledWith(
      expect.objectContaining({ method: "notifications/progress" }),
    );
    await transport.close();
  });

  it("cancels a platform response that arrives after ticket deadline", async () => {
    const signal = new AbortController().signal;
    let resolveFetch!: (response: Response) => void;
    const platformFetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const cancelBody = vi.fn();
    const transport = new BoundedMcpHttpTransport(
      "https://fixture.example/mcp",
      {},
      {
        signal,
        deadlineEpochMs: Date.now() + 1_000,
        nowEpochMs: Date.now,
        hasAuthority: () => true,
        reserveMessage: () =>
          Promise.resolve({
            id: "late",
            signal,
            deadlineEpochMs: Date.now() + 20,
            maxOutputBytes: 100,
          }),
        onReceived: vi.fn(),
        finishMessage: vi.fn(() => Promise.resolve()),
      },
      platformFetch,
    );
    await transport.start();
    await expect(transport.send({ jsonrpc: "2.0", id: 1, method: "initialize" })).rejects.toThrow();
    const body = new ReadableStream<Uint8Array>({ cancel: cancelBody });
    resolveFetch(new Response(body, { headers: { "content-type": "application/json" } }));
    await vi.waitFor(() => {
      expect(cancelBody).toHaveBeenCalledOnce();
    });
    await transport.close();
  }, 1_000);

  it("does not fetch after a reservation is cancelled and rejects unjournaled tool calls", async () => {
    const connection = new AbortController();
    const ticket = new AbortController();
    ticket.abort();
    const platformFetch = vi.fn(() => Promise.resolve(new Response("{}")));
    const finishMessage = vi.fn(() => Promise.resolve());
    const transport = new BoundedMcpHttpTransport(
      "https://fixture.example/mcp",
      {},
      {
        signal: connection.signal,
        deadlineEpochMs: Date.now() + 1_000,
        nowEpochMs: Date.now,
        hasAuthority: () => true,
        reserveMessage: () =>
          Promise.resolve({
            id: "cancelled",
            signal: ticket.signal,
            deadlineEpochMs: Date.now() + 1_000,
            maxOutputBytes: 100,
          }),
        onReceived: vi.fn(),
        finishMessage,
      },
      platformFetch,
    );
    await transport.start();
    await expect(transport.send({ jsonrpc: "2.0", id: 1, method: "tools/call" })).rejects.toThrow(
      "persisted intent",
    );
    await expect(transport.send({ jsonrpc: "2.0", id: 2, method: "initialize" })).rejects.toThrow(
      "cancellation",
    );
    expect(platformFetch).not.toHaveBeenCalled();
    expect(finishMessage).toHaveBeenCalledWith("cancelled", undefined);
    await transport.close();
  });

  it("rejects an unauthorized or closed HTTP session before reservation", async () => {
    const signal = new AbortController().signal;
    let authorized = false;
    const reserveMessage = vi.fn(() =>
      Promise.resolve({
        id: "forbidden",
        signal,
        deadlineEpochMs: Date.now() + 1_000,
        maxOutputBytes: 100,
      }),
    );
    const transport = new BoundedMcpHttpTransport(
      "https://fixture.example/mcp",
      {},
      {
        signal,
        deadlineEpochMs: Date.now() + 1_000,
        nowEpochMs: Date.now,
        hasAuthority: () => authorized,
        reserveMessage,
        onReceived: vi.fn(),
        finishMessage: vi.fn(() => Promise.resolve()),
      },
      vi.fn(() => Promise.resolve(new Response("{}"))),
    );
    expect(() => transport.start()).toThrow("cancelled");
    authorized = true;
    await transport.start();
    transport.setCallTicket("first", 100);
    expect(() => {
      transport.setCallTicket("second", 100);
    }).toThrow("already active");
    transport.clearCallTicket();
    await transport.close();
    await transport.close();
    await expect(transport.send({ jsonrpc: "2.0", id: 1, method: "initialize" })).rejects.toThrow(
      "cancelled",
    );
    expect(reserveMessage).not.toHaveBeenCalled();
  });

  it("rejects expired HTTP and stdio connection controls before opening resources", async () => {
    const signal = new AbortController().signal;
    const control: AiMcpProtocolControl = {
      signal,
      deadlineEpochMs: 10,
      nowEpochMs: () => 10,
      hasAuthority: () => true,
      reserveMessage: vi.fn(),
      onReceived: vi.fn(),
      finishMessage: vi.fn(),
    };
    const http = new BoundedMcpHttpTransport("https://fixture.example/mcp", {}, control);
    expect(() => http.start()).toThrow("deadline exceeded");
    const stdio = new BoundedMcpStdioTransport(process.execPath, [], undefined, {}, control);
    await expect(stdio.start()).rejects.toThrow("deadline exceeded");
    expect(control.reserveMessage).not.toHaveBeenCalled();
  });

  it("accepts a bounded 202 notification response without delivering JSON", async () => {
    const signal = new AbortController().signal;
    const onmessage = vi.fn();
    const transport = new BoundedMcpHttpTransport(
      "https://fixture.example/mcp",
      {},
      {
        signal,
        deadlineEpochMs: Date.now() + 1_000,
        nowEpochMs: Date.now,
        hasAuthority: () => true,
        reserveMessage: () =>
          Promise.resolve({
            id: "accepted",
            signal,
            deadlineEpochMs: Date.now() + 1_000,
            maxOutputBytes: 100,
          }),
        onReceived: vi.fn(),
        finishMessage: vi.fn(() => Promise.resolve()),
      },
      () => Promise.resolve(new Response(null, { status: 202 })),
    );
    transport.onmessage = onmessage;
    await transport.start();
    await transport.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(onmessage).not.toHaveBeenCalled();
    await transport.close();
  });

  it("retains full credit when the runtime rejects a received HTTP chunk", async () => {
    const signal = new AbortController().signal;
    const finishMessage = vi.fn(() => Promise.resolve());
    const transport = new BoundedMcpHttpTransport(
      "https://fixture.example/mcp",
      {},
      {
        signal,
        deadlineEpochMs: Date.now() + 1_000,
        nowEpochMs: Date.now,
        hasAuthority: () => true,
        reserveMessage: () =>
          Promise.resolve({
            id: "runtime-limit",
            signal,
            deadlineEpochMs: Date.now() + 1_000,
            maxOutputBytes: 10,
          }),
        onReceived: () => {
          throw new Error("shared byte budget exceeded");
        },
        finishMessage,
      },
      () =>
        Promise.resolve(
          new Response("12345", {
            headers: { "content-type": "application/json" },
          }),
        ),
    );
    await transport.start();
    await expect(transport.send({ jsonrpc: "2.0", id: 1, method: "initialize" })).rejects.toThrow(
      "shared byte budget exceeded",
    );
    expect(finishMessage).toHaveBeenCalledWith("runtime-limit", undefined);
    await transport.close();
  });

  it("counts a crossing HTTP chunk but leaves its incomplete receipt unknown", async () => {
    const signal = new AbortController().signal;
    const received = vi.fn();
    const finishMessage = vi.fn(() => Promise.resolve());
    const transport = new BoundedMcpHttpTransport(
      "https://fixture.example/mcp",
      {},
      {
        signal,
        deadlineEpochMs: Date.now() + 1_000,
        nowEpochMs: Date.now,
        hasAuthority: () => true,
        reserveMessage: () =>
          Promise.resolve({
            id: "oversize",
            signal,
            deadlineEpochMs: Date.now() + 1_000,
            maxOutputBytes: 4,
          }),
        onReceived: received,
        finishMessage,
      },
      () =>
        Promise.resolve(
          new Response("12345", {
            headers: { "content-type": "application/json" },
          }),
        ),
    );
    await transport.start();
    await expect(transport.send({ jsonrpc: "2.0", id: 1, method: "initialize" })).rejects.toThrow(
      "byte limit",
    );
    expect(received).toHaveBeenCalledWith("oversize", 5);
    expect(finishMessage).toHaveBeenCalledWith("oversize", undefined);
    await transport.close();
  });

  it("retains full credit for a partially received HTTP stream that fails before completion", async () => {
    const signal = new AbortController().signal;
    const received = vi.fn();
    const finishMessage = vi.fn(() => Promise.resolve());
    let chunks = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunks++ === 0) controller.enqueue(Buffer.from("partial"));
        else controller.error(new Error("incomplete stream"));
      },
    });
    const transport = new BoundedMcpHttpTransport(
      "https://fixture.example/mcp",
      {},
      {
        signal,
        deadlineEpochMs: Date.now() + 1_000,
        nowEpochMs: Date.now,
        hasAuthority: () => true,
        reserveMessage: () =>
          Promise.resolve({
            id: "partial-http",
            signal,
            deadlineEpochMs: Date.now() + 1_000,
            maxOutputBytes: 100,
          }),
        onReceived: received,
        finishMessage,
      },
      () =>
        Promise.resolve(
          new Response(body, {
            headers: { "content-type": "application/json" },
          }),
        ),
    );
    await transport.start();
    await expect(transport.send({ jsonrpc: "2.0", id: 1, method: "initialize" })).rejects.toThrow();
    expect(received).toHaveBeenCalledWith("partial-http", 7);
    expect(finishMessage).toHaveBeenCalledWith("partial-http", undefined);
    expect(finishMessage).toHaveBeenCalledOnce();
    await transport.close();
  });

  it("records zero exact decoded bytes for a complete HTTP notification response", async () => {
    const signal = new AbortController().signal;
    const finishMessage = vi.fn(() => Promise.resolve());
    const transport = new BoundedMcpHttpTransport(
      "https://fixture.example/mcp",
      {},
      {
        signal,
        deadlineEpochMs: Date.now() + 1_000,
        nowEpochMs: Date.now,
        hasAuthority: () => true,
        reserveMessage: () =>
          Promise.resolve({
            id: "empty-http",
            signal,
            deadlineEpochMs: Date.now() + 1_000,
            maxOutputBytes: 100,
          }),
        onReceived: vi.fn(),
        finishMessage,
      },
      () => Promise.resolve(new Response(null, { status: 202 })),
    );
    await transport.start();
    await transport.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(finishMessage).toHaveBeenCalledWith("empty-http", 0);
    await transport.close();
  });

  it.each(["oversize", "redirect"])("cancels a still-open %s HTTP body", async (failure) => {
    const signal = new AbortController().signal;
    const cancelBody = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from("12345"));
      },
      cancel: cancelBody,
    });
    const finishMessage = vi.fn(() => Promise.resolve());
    const transport = new BoundedMcpHttpTransport(
      "https://fixture.example/mcp",
      {},
      {
        signal,
        deadlineEpochMs: Date.now() + 1_000,
        nowEpochMs: Date.now,
        hasAuthority: () => true,
        reserveMessage: () =>
          Promise.resolve({
            id: failure,
            signal,
            deadlineEpochMs: Date.now() + 1_000,
            maxOutputBytes: 4,
          }),
        onReceived: vi.fn(),
        finishMessage,
      },
      () =>
        Promise.resolve(
          new Response(body, {
            status: failure === "redirect" ? 302 : 200,
            headers: { "content-type": "application/json" },
          }),
        ),
    );
    await transport.start();
    await expect(transport.send({ jsonrpc: "2.0", id: 1, method: "initialize" })).rejects.toThrow();
    expect(cancelBody).toHaveBeenCalledOnce();
    expect(finishMessage).toHaveBeenCalledWith(failure, undefined);
    await transport.close();
  });

  it("ends a never-settling platform fetch at the durable ticket deadline", async () => {
    const signal = new AbortController().signal;
    const deadlineEpochMs = Date.now() + 25;
    const finishMessage = vi.fn(() => Promise.resolve());
    const transport = new BoundedMcpHttpTransport(
      "https://fixture.example/mcp",
      {},
      {
        signal,
        deadlineEpochMs: deadlineEpochMs + 1_000,
        nowEpochMs: Date.now,
        hasAuthority: () => true,
        reserveMessage: () =>
          Promise.resolve({ id: "stalled", signal, deadlineEpochMs, maxOutputBytes: 128 }),
        onReceived: vi.fn(),
        finishMessage,
      },
      () => new Promise<Response>(() => undefined),
    );
    await transport.start();
    await expect(transport.send({ jsonrpc: "2.0", id: 1, method: "initialize" })).rejects.toThrow();
    expect(finishMessage).toHaveBeenCalledWith("stalled", undefined);
    await transport.close();
  }, 1_000);

  it("uses the actual MCP client over a bounded custom stdio transport", async () => {
    const controller = new AbortController();
    const control: AiMcpProtocolControl = {
      signal: controller.signal,
      deadlineEpochMs: Date.now() + 5_000,
      nowEpochMs: Date.now,
      hasAuthority: () => true,
      reserveMessage: vi.fn(({ method }) =>
        Promise.resolve({
          id: `stdio-${String(method)}`,
          signal: controller.signal,
          deadlineEpochMs: Date.now() + 5_000,
          maxOutputBytes: 4_096,
        }),
      ),
      onReceived: vi.fn(),
      finishMessage: vi.fn(() => Promise.resolve()),
    };
    const session = await createMcpProtocolFactory().connect({
      server: {
        id: "support",
        revision: "1",
        transport: {
          kind: "stdio",
          executable: process.execPath,
          args: [fileURLToPath(new URL("./fixtures/mcp-stdio-server.mjs", import.meta.url))],
        },
        authorizeConnect: () => true,
        tools: {
          lookup: {
            effect: "read",
            timeoutMs: 1_000,
            maxArgumentBytes: 1_024,
            maxResultBytes: 4_096,
            authorize: () => true,
          },
        },
      },
      scope: {} as never,
      resolved: {
        environment: {
          MCP_SPAM_STDERR: "1",
          MCP_REPORT_PID: "1",
          MCP_FRAGMENT_OUTPUT: "1",
        },
      },
      control,
    });
    expect((await session.discover(["lookup"])).map((tool) => tool.name)).toEqual(["lookup"]);
    const result = await session.call("lookup", '{"ticket":"T-1"}', {
      toolCallId: "call-stdio",
      signal: controller.signal,
      deadlineEpochMs: Date.now() + 5_000,
      maxResultBytes: 4_096,
    });
    expect(result).toMatchObject({ content: [{ kind: "text" }], isError: false });
    const pid = Number(result.content[0]?.kind === "text" ? result.content[0].text : "");
    expect(Number.isSafeInteger(pid)).toBe(true);
    const resultBytes = vi
      .mocked(control.onReceived)
      .mock.calls.filter(([id]) => id === "stdio-tools/call")
      .reduce((sum, [, bytes]) => sum + bytes, 0);
    expect(resultBytes).toBeGreaterThan(0);
    expect(control.finishMessage).toHaveBeenCalledWith("stdio-tools/call", resultBytes);
    expect(control.finishMessage).toHaveBeenCalledWith("stdio-notifications/initialized", 0);
    vi.mocked(control.onReceived).mockImplementation(() => {
      throw new Error("shared byte budget exceeded");
    });
    await expect(
      session.call("lookup", '{"ticket":"T-2"}', {
        toolCallId: "call-stdio-2",
        signal: controller.signal,
        deadlineEpochMs: Date.now() + 5_000,
        maxResultBytes: 4_096,
      }),
    ).rejects.toThrow();
    expect(control.finishMessage).toHaveBeenLastCalledWith("stdio-tools/call", undefined);
    await session.close();
    await vi.waitFor(
      () => {
        expect(() => process.kill(pid, 0)).toThrow();
      },
      { timeout: 1_000 },
    );
  });

  it("waits for and escalates termination of a stdio child ignoring SIGTERM", async () => {
    const controller = new AbortController();
    const control: AiMcpProtocolControl = {
      signal: controller.signal,
      deadlineEpochMs: Date.now() + 5_000,
      nowEpochMs: Date.now,
      hasAuthority: () => true,
      reserveMessage: ({ method }) =>
        Promise.resolve({
          id: `term-${method}`,
          signal: controller.signal,
          deadlineEpochMs: Date.now() + 5_000,
          maxOutputBytes: 4_096,
        }),
      onReceived: vi.fn(),
      finishMessage: vi.fn(() => Promise.resolve()),
    };
    const session = await createMcpProtocolFactory().connect({
      server: {
        id: "support",
        revision: "1",
        transport: {
          kind: "stdio",
          executable: process.execPath,
          args: [fileURLToPath(new URL("./fixtures/mcp-stdio-server.mjs", import.meta.url))],
        },
        authorizeConnect: () => true,
        tools: {
          lookup: {
            effect: "read",
            timeoutMs: 1_000,
            maxArgumentBytes: 1_024,
            maxResultBytes: 4_096,
            authorize: () => true,
          },
        },
      },
      scope: {} as never,
      resolved: { environment: { MCP_REPORT_PID: "1", MCP_IGNORE_SIGTERM: "1" } },
      control,
    });
    await session.discover(["lookup"]);
    const result = await session.call("lookup", '{"ticket":"T-1"}', {
      toolCallId: "ignore-term",
      signal: controller.signal,
      deadlineEpochMs: Date.now() + 5_000,
      maxResultBytes: 4_096,
    });
    const pid = Number(result.content[0]?.kind === "text" ? result.content[0].text : "");
    try {
      await session.close();
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* Child already exited. */
      }
    }
  }, 2_000);

  it("escalates stdio termination while a receipt journal remains pending", async () => {
    const controller = new AbortController();
    let releaseJournal!: () => void;
    const journal = new Promise<void>((resolve) => {
      releaseJournal = resolve;
    });
    let calls = 0;
    const control: AiMcpProtocolControl = {
      signal: controller.signal,
      deadlineEpochMs: Date.now() + 5_000,
      nowEpochMs: Date.now,
      hasAuthority: () => true,
      reserveMessage: vi.fn(({ method }: Parameters<AiMcpProtocolControl["reserveMessage"]>[0]) =>
        Promise.resolve({
          id: `pending-${method}`,
          signal: controller.signal,
          deadlineEpochMs: Date.now() + 5_000,
          maxOutputBytes: 4_096,
        }),
      ),
      onReceived: vi.fn(),
      finishMessage: vi.fn((ticketId) => {
        if (ticketId === "pending-tools/call" && ++calls === 2) return journal;
        return Promise.resolve();
      }),
    };
    const session = await createMcpProtocolFactory().connect({
      server: {
        id: "support",
        revision: "1",
        transport: {
          kind: "stdio",
          executable: process.execPath,
          args: [fileURLToPath(new URL("./fixtures/mcp-stdio-server.mjs", import.meta.url))],
        },
        authorizeConnect: () => true,
        tools: {
          lookup: {
            effect: "read",
            timeoutMs: 1_000,
            maxArgumentBytes: 1_024,
            maxResultBytes: 4_096,
            authorize: () => true,
          },
        },
      },
      scope: {} as never,
      resolved: {
        environment: {
          MCP_REPORT_PID: "1",
          MCP_IGNORE_SIGTERM: "1",
          MCP_DELAY_AFTER_FIRST: "1000",
        },
      },
      control,
    });
    await session.discover(["lookup"]);
    const first = await session.call("lookup", '{"ticket":"T-1"}', {
      toolCallId: "first",
      signal: controller.signal,
      deadlineEpochMs: Date.now() + 5_000,
      maxResultBytes: 4_096,
    });
    const pid = Number(first.content[0]?.kind === "text" ? first.content[0].text : "");
    const second = session
      .call("lookup", '{"ticket":"T-2"}', {
        toolCallId: "second",
        signal: controller.signal,
        deadlineEpochMs: Date.now() + 5_000,
        maxResultBytes: 4_096,
      })
      .catch(() => undefined);
    try {
      await vi.waitFor(() => {
        expect(
          vi
            .mocked(control.reserveMessage)
            .mock.calls.filter(([message]) => message.method === "tools/call"),
        ).toHaveLength(2);
      });
      let closed = false;
      const closing = session.close().finally(() => {
        closed = true;
      });
      await vi.waitFor(
        () => {
          expect(() => process.kill(pid, 0)).toThrow();
        },
        { timeout: 800 },
      );
      expect(closed).toBe(false);
      releaseJournal();
      await closing;
      await second;
    } finally {
      releaseJournal();
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* Child already exited. */
      }
    }
  }, 2_000);

  it("ends a delayed stdio tool call at its local call deadline", async () => {
    const controller = new AbortController();
    const control: AiMcpProtocolControl = {
      signal: controller.signal,
      deadlineEpochMs: Date.now() + 5_000,
      nowEpochMs: Date.now,
      hasAuthority: () => true,
      reserveMessage: ({ method }) =>
        Promise.resolve({
          id: `delayed-${method}`,
          signal: controller.signal,
          deadlineEpochMs: Date.now() + 5_000,
          maxOutputBytes: 4_096,
        }),
      onReceived: vi.fn(),
      finishMessage: vi.fn(() => Promise.resolve()),
    };
    const session = await createMcpProtocolFactory().connect({
      server: {
        id: "support",
        revision: "1",
        transport: {
          kind: "stdio",
          executable: process.execPath,
          args: [fileURLToPath(new URL("./fixtures/mcp-stdio-server.mjs", import.meta.url))],
        },
        authorizeConnect: () => true,
        tools: {
          lookup: {
            effect: "read",
            timeoutMs: 1_000,
            maxArgumentBytes: 1_024,
            maxResultBytes: 4_096,
            authorize: () => true,
          },
        },
      },
      scope: {} as never,
      resolved: { environment: { MCP_DELAY_MS: "300" } },
      control,
    });
    await session.discover(["lookup"]);
    await expect(
      session.call("lookup", '{"ticket":"T-1"}', {
        toolCallId: "delayed-call",
        signal: controller.signal,
        deadlineEpochMs: Date.now() + 20,
        maxResultBytes: 4_096,
      }),
    ).rejects.toThrow();
    await session.close();
  }, 1_000);

  it("rejects an oversized stdio line before JSON parsing without completing its receipt", async () => {
    const controller = new AbortController();
    const received = vi.fn();
    const finishMessage = vi.fn(() => Promise.resolve());
    const control: AiMcpProtocolControl = {
      signal: controller.signal,
      deadlineEpochMs: Date.now() + 5_000,
      nowEpochMs: Date.now,
      hasAuthority: () => true,
      reserveMessage: ({ method }) =>
        Promise.resolve({
          id: `oversized-${method}`,
          signal: controller.signal,
          deadlineEpochMs: Date.now() + 5_000,
          maxOutputBytes: 4_096,
        }),
      onReceived: received,
      finishMessage,
    };
    const session = await createMcpProtocolFactory().connect({
      server: {
        id: "support",
        revision: "1",
        transport: {
          kind: "stdio",
          executable: process.execPath,
          args: [fileURLToPath(new URL("./fixtures/mcp-stdio-server.mjs", import.meta.url))],
        },
        authorizeConnect: () => true,
        tools: {
          lookup: {
            effect: "read",
            timeoutMs: 1_000,
            maxArgumentBytes: 1_024,
            maxResultBytes: 4_096,
            authorize: () => true,
          },
        },
      },
      scope: {} as never,
      resolved: { environment: { MCP_OVERSIZE_OUTPUT: "1" } },
      control,
    });
    await session.discover(["lookup"]);
    await expect(
      session.call("lookup", '{"ticket":"T-1"}', {
        toolCallId: "oversized-call",
        signal: controller.signal,
        deadlineEpochMs: Date.now() + 5_000,
        maxResultBytes: 4_096,
      }),
    ).rejects.toThrow();
    expect(received).toHaveBeenCalledWith("oversized-tools/call", expect.any(Number));
    expect(finishMessage).toHaveBeenCalledWith("oversized-tools/call", undefined);
    await session.close();
  });

  it.each(["MCP_MALFORMED_OUTPUT", "MCP_WRONG_ID", "MCP_EXTRA_OUTPUT", "MCP_TRUNCATE_OUTPUT"])(
    "rejects %s without completing an invalid stdio response",
    async (mode) => {
      const controller = new AbortController();
      const finishMessage = vi.fn<AiMcpProtocolControl["finishMessage"]>(() => Promise.resolve());
      const control: AiMcpProtocolControl = {
        signal: controller.signal,
        deadlineEpochMs: Date.now() + 5_000,
        nowEpochMs: Date.now,
        hasAuthority: () => true,
        reserveMessage: ({ method }) =>
          Promise.resolve({
            id: `bad-${method}`,
            signal: controller.signal,
            deadlineEpochMs: Date.now() + 5_000,
            maxOutputBytes: 4_096,
          }),
        onReceived: vi.fn(),
        finishMessage,
      };
      const session = await createMcpProtocolFactory().connect({
        server: {
          id: "support",
          revision: "1",
          transport: {
            kind: "stdio",
            executable: process.execPath,
            args: [fileURLToPath(new URL("./fixtures/mcp-stdio-server.mjs", import.meta.url))],
          },
          authorizeConnect: () => true,
          tools: {
            lookup: {
              effect: "read",
              timeoutMs: 1_000,
              maxArgumentBytes: 1_024,
              maxResultBytes: 4_096,
              authorize: () => true,
            },
          },
        },
        scope: {} as never,
        resolved: { environment: { [mode]: "1" } },
        control,
      });
      await session.discover(["lookup"]);
      await expect(
        session.call("lookup", '{"ticket":"T-1"}', {
          toolCallId: "bad-call",
          signal: controller.signal,
          deadlineEpochMs: Date.now() + 5_000,
          maxResultBytes: 4_096,
        }),
      ).rejects.toThrow();
      expect(finishMessage.mock.calls.filter(([id]) => id === "bad-tools/call")).toEqual([
        ["bad-tools/call", undefined],
      ]);
      await session.close();
    },
    1_000,
  );

  it("negotiates and discovers one allowed tool through the actual MCP client", async () => {
    const methods: string[] = [];
    let unsafeHeaderSchema = false;
    let unsupportedContent = false;
    let structuredContent = false;
    let structuredValue: unknown = { ticket: "T-3" };
    let toolError = false;
    let schemaOverride: unknown;
    let outputSchemaOverride: unknown;
    let discoveryCredit = 8_192;
    let listingMode:
      "normal" | "repeat-name" | "repeat-cursor" | "many" | "long-description" | "partial-failure" =
      "normal";
    const server = createServer((request, response) => {
      void (async () => {
        const chunks: Uint8Array[] = [];
        for await (const chunk of request) chunks.push(chunk as Uint8Array);
        const message = validateJSONRPCMessage(
          JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
        );
        if (!("method" in message)) throw new Error("fixture expected MCP request");
        const responseId = "id" in message ? message.id : 0;
        methods.push(message.method);
        response.setHeader("content-type", "application/json");
        if (message.method === "initialize") {
          response.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: responseId,
              result: {
                protocolVersion: "2025-06-18",
                capabilities: { tools: {} },
                serverInfo: { name: "fixture", version: "1" },
              },
            }),
          );
        } else if (message.method === "tools/list") {
          response.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: responseId,
              result: {
                tools:
                  listingMode === "partial-failure"
                    ? [
                        { name: "lookup", inputSchema: { type: "object" } },
                        {
                          name: "unsafe",
                          inputSchema: { type: "object", "x-mcp-header": "Authorization" },
                        },
                      ]
                    : listingMode === "many"
                      ? Array.from({ length: 65 }, (_, index) => ({
                          name: `tool-${String(index)}`,
                          inputSchema: { type: "object" },
                        }))
                      : ["repeat-name", "repeat-cursor"].includes(listingMode) &&
                          "params" in message &&
                          message.params?.cursor
                        ? listingMode === "repeat-name"
                          ? [
                              {
                                name: "lookup",
                                description: "Lookup a ticket",
                                inputSchema: { type: "object" },
                              },
                            ]
                          : []
                        : [
                            {
                              name: "lookup",
                              description:
                                listingMode === "long-description"
                                  ? "x".repeat(4_097)
                                  : "Lookup a ticket",
                              inputSchema: schemaOverride ?? {
                                type: "object",
                                properties: {
                                  ticket: unsafeHeaderSchema
                                    ? { type: "string", "x-mcp-header": "Authorization" }
                                    : { type: "string" },
                                },
                                required: ["ticket"],
                                additionalProperties: false,
                              },
                              ...(outputSchemaOverride === undefined
                                ? {}
                                : { outputSchema: outputSchemaOverride }),
                            },
                          ],
                ...(["repeat-name", "repeat-cursor"].includes(listingMode)
                  ? { nextCursor: "same" }
                  : {}),
              },
            }),
          );
        } else if (message.method === "tools/call") {
          response.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: responseId,
              result: {
                content: unsupportedContent
                  ? [{ type: "image", data: "AA==", mimeType: "image/png" }]
                  : [{ type: "text", text: "Ticket found" }],
                ...(structuredContent ? { structuredContent: structuredValue } : {}),
                isError: toolError,
              },
            }),
          );
        } else {
          response.writeHead(202).end();
        }
      })();
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("fixture address unavailable");
    const url = `http://127.0.0.1:${String(address.port)}/mcp`;
    const finishMessage = vi.fn(() => Promise.resolve());
    const control: AiMcpProtocolControl = {
      signal: new AbortController().signal,
      deadlineEpochMs: Date.now() + 5_000,
      nowEpochMs: Date.now,
      hasAuthority: () => true,
      reserveMessage: vi.fn(({ method }) =>
        Promise.resolve({
          id: `ticket-${String(method)}`,
          signal: new AbortController().signal,
          deadlineEpochMs: Date.now() + 5_000,
          maxOutputBytes: discoveryCredit,
        }),
      ),
      onReceived: vi.fn(),
      finishMessage,
    };
    const factory = createMcpProtocolFactory();
    const session = await factory.connect({
      server: {
        id: "support",
        revision: "1",
        transport: { kind: "streamable-http", url },
        authorizeConnect: () => true,
        tools: {
          lookup: {
            effect: "read",
            timeoutMs: 1_000,
            maxArgumentBytes: 1_024,
            maxResultBytes: 4_096,
            authorize: () => true,
          },
        },
      },
      scope: {} as never,
      resolved: { headers: {} },
      control,
    });
    const tools = await session.discover(["lookup"]);
    expect(tools).toEqual([
      {
        name: "lookup",
        description: "Lookup a ticket",
        inputSchemaJson: JSON.stringify({
          additionalProperties: false,
          properties: { ticket: { type: "string" } },
          required: ["ticket"],
          type: "object",
        }),
      },
    ]);
    schemaOverride = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { ticket: { type: "string" } },
      required: ["ticket"],
      additionalProperties: false,
    };
    expect(await session.discover(["lookup"])).toEqual(tools);
    schemaOverride = { ...schemaOverride, $schema: "https://untrusted.example/schema" };
    await expect(session.discover(["lookup"])).rejects.toMatchObject({
      code: "UNSUPPORTED_CAPABILITY",
      message: "MCP tool capability is unsupported.",
    });
    schemaOverride = undefined;
    await session.discover(["lookup"]);
    expect(methods).toContain("initialize");
    expect(methods).toContain("tools/list");
    expect(finishMessage).toHaveBeenCalled();
    expect(() => {
      session.validateArguments("lookup", "{}");
    }).toThrow("accepted schema");
    expect(() => {
      session.validateArguments("lookup", "{");
    }).toThrow("not JSON");
    expect(() => {
      session.validateArguments("lookup", "x".repeat(16_385));
    }).toThrow("local limit");
    expect(() => {
      session.validateArguments("lookup", '{"ticket":7}');
    }).toThrow("accepted schema");
    expect(() => {
      session.validateArguments("lookup", '{"ticket":"T-1","admin":true}');
    }).toThrow("accepted schema");
    expect(() => {
      session.validateArguments("other", "{}");
    }).toThrow("not advertised");
    expect(methods).not.toContain("tools/call");
    session.validateArguments("lookup", '{"ticket":"T-1"}');
    await expect(
      session.call("lookup", '{"ticket":"T-1"}', {
        toolCallId: "call-1",
        signal: new AbortController().signal,
        deadlineEpochMs: Date.now() + 5_000,
        maxResultBytes: 4_096,
      }),
    ).resolves.toEqual({ content: [{ kind: "text", text: "Ticket found" }], isError: false });
    expect(methods.filter((method) => method === "tools/call")).toHaveLength(1);
    expect(control.reserveMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "call",
        method: "tools/call",
        toolCallId: "call-1",
      }),
    );
    unsupportedContent = true;
    await expect(
      session.call("lookup", '{"ticket":"T-2"}', {
        toolCallId: "call-2",
        signal: new AbortController().signal,
        deadlineEpochMs: Date.now() + 5_000,
        maxResultBytes: 4_096,
      }),
    ).rejects.toThrow("binary or resource");
    unsupportedContent = false;
    structuredContent = true;
    await expect(
      session.call("lookup", '{"ticket":"T-3"}', {
        toolCallId: "call-3",
        signal: new AbortController().signal,
        deadlineEpochMs: Date.now() + 5_000,
        maxResultBytes: 4_096,
      }),
    ).resolves.toEqual({
      content: [
        { kind: "text", text: "Ticket found" },
        { kind: "json", json: '{"ticket":"T-3"}' },
      ],
      isError: false,
    });
    structuredContent = false;
    toolError = true;
    await expect(
      session.call("lookup", '{"ticket":"T-4"}', {
        toolCallId: "call-4",
        signal: new AbortController().signal,
        deadlineEpochMs: Date.now() + 5_000,
        maxResultBytes: 4_096,
      }),
    ).resolves.toEqual({ content: [{ kind: "text", text: "Ticket found" }], isError: true });
    toolError = false;
    outputSchemaOverride = {
      type: "object",
      properties: { ticket: { type: "string" } },
      required: ["ticket"],
      additionalProperties: false,
    };
    expect(await session.discover(["lookup"])).toEqual([
      expect.objectContaining({
        outputSchemaJson: JSON.stringify({
          additionalProperties: false,
          properties: { ticket: { type: "string" } },
          required: ["ticket"],
          type: "object",
        }),
      }),
    ]);
    outputSchemaOverride = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { ticket: { type: "string" } },
      required: ["ticket"],
      additionalProperties: false,
    };
    expect(await session.discover(["lookup"])).toEqual([
      expect.objectContaining({
        outputSchemaJson: JSON.stringify({
          additionalProperties: false,
          properties: { ticket: { type: "string" } },
          required: ["ticket"],
          type: "object",
        }),
      }),
    ]);
    outputSchemaOverride = { ...outputSchemaOverride, $schema: "https://untrusted.example/schema" };
    await expect(session.discover(["lookup"])).rejects.toMatchObject({
      code: "UNSUPPORTED_CAPABILITY",
    });
    outputSchemaOverride = {
      type: "object",
      properties: { ticket: { type: "string" } },
      required: ["ticket"],
      additionalProperties: false,
    };
    await session.discover(["lookup"]);
    structuredContent = true;
    structuredValue = { ticket: 17 };
    await expect(
      session.call("lookup", '{"ticket":"T-6"}', {
        toolCallId: "bad-type",
        signal: new AbortController().signal,
        deadlineEpochMs: Date.now() + 5_000,
        maxResultBytes: 4_096,
      }),
    ).rejects.toThrow("output schema");
    structuredValue = {};
    await expect(
      session.call("lookup", '{"ticket":"T-7"}', {
        toolCallId: "missing-field",
        signal: new AbortController().signal,
        deadlineEpochMs: Date.now() + 5_000,
        maxResultBytes: 4_096,
      }),
    ).rejects.toThrow("output schema");
    structuredContent = false;
    await expect(
      session.call("lookup", '{"ticket":"T-8"}', {
        toolCallId: "missing-structure",
        signal: new AbortController().signal,
        deadlineEpochMs: Date.now() + 5_000,
        maxResultBytes: 4_096,
      }),
    ).rejects.toThrow("structured result required");
    structuredContent = true;
    structuredValue = { ticket: "T-9" };
    await expect(
      session.call("lookup", '{"ticket":"T-9"}', {
        toolCallId: "valid-result",
        signal: new AbortController().signal,
        deadlineEpochMs: Date.now() + 5_000,
        maxResultBytes: 4_096,
      }),
    ).resolves.toEqual({
      content: [
        { kind: "text", text: "Ticket found" },
        { kind: "json", json: '{"ticket":"T-9"}' },
      ],
      isError: false,
    });
    structuredContent = false;
    toolError = true;
    await expect(
      session.call("lookup", '{"ticket":"T-10"}', {
        toolCallId: "tool-error",
        signal: new AbortController().signal,
        deadlineEpochMs: Date.now() + 5_000,
        maxResultBytes: 4_096,
      }),
    ).resolves.toEqual({ content: [{ kind: "text", text: "Ticket found" }], isError: true });
    toolError = false;
    outputSchemaOverride = { $ref: "https://untrusted.example/output" };
    await expect(session.discover(["lookup"])).rejects.toMatchObject({
      code: "UNSUPPORTED_CAPABILITY",
    });
    expect(() => {
      session.validateArguments("lookup", '{"ticket":"T-9"}');
    }).toThrow("not advertised");
    outputSchemaOverride = { type: "string" };
    await expect(session.discover(["lookup"])).rejects.toMatchObject({
      code: "UNSUPPORTED_CAPABILITY",
    });
    discoveryCredit = 32_768;
    outputSchemaOverride = { type: "object", description: "x".repeat(16_385) };
    await expect(session.discover(["lookup"])).rejects.toMatchObject({
      code: "UNSUPPORTED_CAPABILITY",
    });
    discoveryCredit = 8_192;
    let nestedOutput: unknown = { type: "string" };
    for (let depth = 0; depth < 14; depth += 1)
      nestedOutput = { type: "object", properties: { next: nestedOutput } };
    outputSchemaOverride = nestedOutput;
    await expect(session.discover(["lookup"])).rejects.toMatchObject({
      code: "UNSUPPORTED_CAPABILITY",
    });
    outputSchemaOverride = undefined;
    await session.discover(["lookup"]);
    await expect(
      session.call("lookup", '{"ticket":"T-5"}', {
        toolCallId: "call-5",
        signal: new AbortController().signal,
        deadlineEpochMs: Date.now() + 5_000,
        maxResultBytes: 1,
      }),
    ).rejects.toThrow("result exceeds byte limit");
    expect(await session.discover([])).toEqual([]);
    expect(() => {
      session.validateArguments("lookup", '{"ticket":"T-1"}');
    }).toThrow("not advertised");
    unsafeHeaderSchema = true;
    await expect(session.discover(["lookup"])).rejects.toMatchObject({
      code: "UNSUPPORTED_CAPABILITY",
    });
    expect(() => {
      session.validateArguments("lookup", '{"ticket":"T-1"}');
    }).toThrow("not advertised");
    unsafeHeaderSchema = false;
    schemaOverride = { type: "object", properties: 7 };
    await expect(session.discover(["lookup"])).rejects.toThrow("parse server response");
    schemaOverride = { $ref: "https://untrusted.example/schema" };
    await expect(session.discover(["lookup"])).rejects.toMatchObject({
      code: "UNSUPPORTED_CAPABILITY",
    });
    schemaOverride = undefined;
    listingMode = "repeat-name";
    await expect(session.discover(["lookup"])).rejects.toMatchObject({
      code: "UNSUPPORTED_CAPABILITY",
    });
    listingMode = "repeat-cursor";
    await expect(session.discover([])).rejects.toMatchObject({ code: "UNSUPPORTED_CAPABILITY" });
    listingMode = "many";
    await expect(session.discover([])).rejects.toMatchObject({ code: "UNSUPPORTED_CAPABILITY" });
    listingMode = "long-description";
    await expect(session.discover(["lookup"])).rejects.toMatchObject({
      code: "UNSUPPORTED_CAPABILITY",
    });
    listingMode = "partial-failure";
    await expect(session.discover(["lookup", "unsafe"])).rejects.toMatchObject({
      code: "UNSUPPORTED_CAPABILITY",
    });
    expect(() => {
      session.validateArguments("lookup", "{}");
    }).toThrow("not advertised");
    listingMode = "normal";
    schemaOverride = {
      type: "object",
      properties: {
        tickets: { type: "array", items: { type: "string" } },
      },
      required: ["tickets"],
      additionalProperties: { type: "string" },
    };
    await session.discover(["lookup"]);
    session.validateArguments("lookup", '{"tickets":["T-1"],"note":"urgent"}');
    expect(() => {
      session.validateArguments("lookup", '{"tickets":[7]}');
    }).toThrow("accepted schema");
    schemaOverride = undefined;
    await session.discover(["lookup"]);
    const callCount = methods.filter((method) => method === "tools/call").length;
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      session.call("lookup", '{"ticket":"T-1"}', {
        toolCallId: "cancelled-call",
        signal: cancelled.signal,
        deadlineEpochMs: Date.now() + 5_000,
        maxResultBytes: 4_096,
      }),
    ).rejects.toThrow("deadline or cancellation");
    expect(methods.filter((method) => method === "tools/call")).toHaveLength(callCount);
    await session.close();
  });
});
