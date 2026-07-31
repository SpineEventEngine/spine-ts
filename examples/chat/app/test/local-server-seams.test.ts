import * as http from "node:http";

import type { HandlerContext } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { describe, expect, it } from "vitest";

import {
  LocalChatCloseTimeout,
  LocalChatGatewayRequests,
  LocalChatHttpListener,
  LocalChatOptions,
  LocalChatSession,
} from "../src/local-server-seams.js";

describe("local Chat server seams", () => {
  it("resolves only the fixed local bearer session", async () => {
    const resolver = LocalChatSession.resolver();
    await expect(
      resolver.resolve({ kind: "bearer", value: "chat-local-fixture" }),
    ).resolves.toMatchObject({
      principal: { id: "ada", attributes: { rooms: "general" } },
    });
    await expect(resolver.resolve({ kind: "bearer", value: "wrong" })).resolves.toBeUndefined();
    await expect(
      resolver.resolve({ kind: "cookie", value: "chat-local-fixture" }),
    ).resolves.toBeUndefined();
  });

  it("extracts only bearer credentials and allowlisted browser request facts", () => {
    const requests = LocalChatGatewayRequests.context();
    const context = (headers = new Headers()) =>
      ({ requestHeader: headers }) as unknown as HandlerContext;
    expect(requests.credential(context(new Headers({ authorization: "Bearer token" })))).toEqual({
      kind: "bearer",
      value: "token",
    });
    expect(requests.credential(context(new Headers({ authorization: "Basic token" })))).toEqual({
      kind: "bearer",
      value: "",
    });
    expect(requests.credential(context())).toEqual({
      kind: "bearer",
      value: "",
    });
    expect(
      requests.transport(context(new Headers({ origin: "http://127.0.0.1:5173", trace: "x" }))),
    ).toMatchObject({
      origin: "http://127.0.0.1:5173",
      service: "browser",
      method: "gateway",
    });
    expect(requests.transport(context())).not.toHaveProperty("origin");
  });

  it("serves exact-origin preflight and releases an ephemeral listener", async () => {
    const handler = connectNodeAdapter({
      routes(router) {
        void router;
      },
    });
    const server = LocalChatHttpListener.server(handler, "http://127.0.0.1:5173");
    const address = await LocalChatHttpListener.listen(server, "127.0.0.1", 0);
    const allowed = await fetch(`http://127.0.0.1:${String(address.port)}`, {
      method: "OPTIONS",
      headers: { origin: "http://127.0.0.1:5173" },
    });
    const denied = await fetch(`http://127.0.0.1:${String(address.port)}`, {
      method: "OPTIONS",
      headers: { origin: "http://localhost:5173" },
    });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5173");
    expect(denied.status).toBe(403);
    expect((await fetch(`http://127.0.0.1:${String(address.port)}`)).status).toBe(404);
    await expect(LocalChatHttpListener.close(server)).resolves.toBeUndefined();
    await expect(LocalChatHttpListener.close(http.createServer())).rejects.toThrow();
  });

  it("resolves completed close work and rejects a bounded wait", async () => {
    await expect(
      LocalChatCloseTimeout.within(Promise.resolve(), 10, "listener"),
    ).resolves.toBeUndefined();
    await expect(new Promise<void>((resolve) => setTimeout(resolve, 5))).resolves.toBeUndefined();
    await expect(
      LocalChatCloseTimeout.within(new Promise(() => undefined), 1, "listener"),
    ).rejects.toThrow("listener close timed out.");
  });

  it("resolves default and explicit local listener options without binding", () => {
    expect(LocalChatOptions.resolve({})).toEqual({
      host: "127.0.0.1",
      port: 8090,
      webOrigin: "http://127.0.0.1:5173",
    });
    expect(
      LocalChatOptions.resolve({ host: "127.0.0.2", port: 0, webOrigin: "http://example.test" }),
    ).toEqual({
      host: "127.0.0.2",
      port: 0,
      webOrigin: "http://example.test",
    });
  });

  it("starts and closes the compiled topology with an explicit ephemeral listener", async () => {
    const { LocalChatServerTopology } = await import("../dist/src/local-server.js");
    const explicit = await LocalChatServerTopology.start({
      host: "127.0.0.1",
      port: 0,
      webOrigin: "http://127.0.0.1:5173",
    });
    const preflight = await fetch(explicit.baseUrl, {
      method: "OPTIONS",
      headers: { origin: "http://127.0.0.1:5173" },
    });
    expect(preflight.status).toBe(204);
    await explicit.close();
  }, 30_000);
});
