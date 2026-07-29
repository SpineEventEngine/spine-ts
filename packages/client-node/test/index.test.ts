import { create, type Message } from "@bufbuild/protobuf";
import type { Transport } from "@connectrpc/connect";
import { AnyMessages } from "@spine-event-engine/core";
import {
  AckSchema,
  CommandIdSchema,
  StatusSchema,
  type TenantId,
  UserIdSchema,
} from "@spine-event-engine/proto";
import { QueryResponseSchema } from "@spine-event-engine/proto/client";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import * as clientRoot from "../src/index.js";
import type {
  ClientKernel,
  ClientOperationOptions,
  ClientOptions,
  ClientOutcome,
  ClientRequest,
  ClientTransport,
  Subscription,
} from "../src/index.js";

const nodeTransport = vi.hoisted(() => {
  const abort = vi.fn();
  const sessions: { abort: typeof abort }[] = [];
  return {
    abort,
    createGrpcTransport: vi.fn(),
    sessions,
    sessionManager: vi.fn(function SessionManager() {
      const session = { abort };
      sessions.push(session);
      return session;
    }),
  };
});

vi.mock("@connectrpc/connect-node", () => ({
  Http2SessionManager: nodeTransport.sessionManager,
  createGrpcTransport: nodeTransport.createGrpcTransport,
}));

type ClientRoot = typeof import("../src/index.js");

describe("@spine-event-engine/client-node", () => {
  it("uses the browser-safe public client contract with Node transport factories", () => {
    expect(clientRoot.Client).toBeTypeOf("object");
    expect(() => Reflect.construct(clientRoot.Client as never, [])).toThrow();
    expect(clientRoot.ClientProtocolError).toBeTypeOf("function");
    expect(clientRoot.EntityColumn).toBeTypeOf("function");
    expectTypeOf<"query" extends keyof ClientRoot ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<
      "subscribeToState" extends keyof ClientRoot ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      "subscribeToEvents" extends keyof ClientRoot ? true : false
    >().toEqualTypeOf<false>();
  });

  it("re-exports the client-web declaration contract from the Node package", () => {
    expectTypeOf<ClientKernel>().toExtend<{
      asGuest(): ClientRequest;
      close(): Promise<void>;
    }>();
    expectTypeOf<ClientOperationOptions>().toExtend<{ readonly signal?: AbortSignal }>();
    expectTypeOf<ClientOptions["tenant"]>().toEqualTypeOf<string | TenantId | undefined>();
    expectTypeOf<ClientOutcome>().toExtend<{ readonly kind: string }>();
    expectTypeOf<ClientTransport>().toExtend<{ createRequestId(): string }>();
    expectTypeOf<Subscription>().toExtend<{
      activate(): Promise<void>;
      cancel(): Promise<void>;
    }>();
  });

  it("leaves a caller-owned transport open with omitted and provided options", async () => {
    const close = vi.fn();
    const transport = Object.assign(
      unaryTransport(() => create(QueryResponseSchema)),
      { close },
    );

    await clientRoot.Client.usingTransport(transport).close();
    await clientRoot.Client.usingTransport(transport, { tenant: "tenant-a" }).close();

    expect(close).not.toHaveBeenCalled();
  });

  it("owns its Node session and generates a UUID command ID", async () => {
    nodeTransport.abort.mockClear();
    nodeTransport.createGrpcTransport.mockClear();
    nodeTransport.sessionManager.mockClear();
    nodeTransport.sessions.splice(0);
    let commandId: string | undefined;
    nodeTransport.createGrpcTransport.mockReturnValue(
      unaryTransport((method, input) => {
        commandId =
          method.name === "Post" ? (input as { id?: { uuid?: string } }).id?.uuid : undefined;
        return create(AckSchema, {
          messageId: AnyMessages.pack(
            CommandIdSchema,
            create(CommandIdSchema, { uuid: commandId ?? "missing-command-id" }),
          ),
          status: create(StatusSchema, { status: { case: "ok", value: {} } }),
        });
      }),
    );

    const client = clientRoot.Client.connectTo("https://gateway.example", { tenant: "tenant-a" });
    await client.asGuest().post(UserIdSchema, create(UserIdSchema, { value: "command" }));
    await client.close();

    expect(commandId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(nodeTransport.sessionManager).toHaveBeenCalledWith("https://gateway.example");
    expect(nodeTransport.sessionManager).toHaveBeenCalledOnce();
    const sessionManager = nodeTransport.sessions[0];
    expect(sessionManager).toBeDefined();
    expect(nodeTransport.createGrpcTransport).toHaveBeenCalledWith({
      baseUrl: "https://gateway.example",
      sessionManager,
    });
    expect(nodeTransport.createGrpcTransport).toHaveBeenCalledOnce();
    expect(nodeTransport.abort).toHaveBeenCalledOnce();
  });

  it("creates an owned Node session when options are omitted", async () => {
    nodeTransport.abort.mockClear();
    nodeTransport.createGrpcTransport.mockClear();
    nodeTransport.sessionManager.mockClear();
    nodeTransport.sessions.splice(0);
    nodeTransport.createGrpcTransport.mockReturnValue(
      unaryTransport(() => create(QueryResponseSchema)),
    );

    const client = clientRoot.Client.connectTo("https://gateway.example");
    await client.close();

    expect(nodeTransport.sessionManager).toHaveBeenCalledWith("https://gateway.example");
    expect(nodeTransport.sessionManager).toHaveBeenCalledOnce();
    const sessionManager = nodeTransport.sessions[0];
    expect(sessionManager).toBeDefined();
    expect(nodeTransport.createGrpcTransport).toHaveBeenCalledWith({
      baseUrl: "https://gateway.example",
      sessionManager,
    });
    expect(nodeTransport.createGrpcTransport).toHaveBeenCalledOnce();
    expect(nodeTransport.abort).toHaveBeenCalledOnce();
  });
});

function unaryTransport(
  handler: (method: { readonly name: string }, input: Message) => Message,
): Transport {
  return {
    unary(method, _signal, _timeoutMs, _header, input) {
      return Promise.resolve({
        stream: false,
        method,
        header: new Headers(),
        trailer: new Headers(),
        service: method.parent,
        message: handler(method, input as Message),
      } as never);
    },
    stream(method) {
      return Promise.resolve({
        stream: true,
        method,
        header: new Headers(),
        trailer: new Headers(),
        service: method.parent,
        message: emptyUpdates(),
      } as never);
    },
  };
}

async function* emptyUpdates(): AsyncIterable<Message> {
  await Promise.resolve();
  yield* [];
}
