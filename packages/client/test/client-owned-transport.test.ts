/* eslint-disable @typescript-eslint/require-await */

import { create, type Message } from "@bufbuild/protobuf";
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import type { Transport } from "@connectrpc/connect";
import { packAny } from "@spine-ts/core";
import { AckSchema, CommandIdSchema, ResponseSchema, StatusSchema, type Command } from "@spine-ts/proto";
import { SubscriptionIdSchema, SubscriptionSchema } from "@spine-ts/proto/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectionStateSchema } from "../test-fixtures/projection-column-fixtures.js";

const session = vi.hoisted<{ aborts: number; timeline: string[]; transport: unknown }>(() => ({
  aborts: 0,
  timeline: [],
  transport: undefined,
}));

vi.mock("@connectrpc/connect-node", () => ({
  Http2SessionManager: class {
    abort(): void {
      session.aborts += 1;
      session.timeline.push("session-abort");
    }
  },
  createGrpcTransport: () => session.transport,
}));

import { Client } from "../src/index.js";

describe("Client owned transport", () => {
  beforeEach(() => {
    session.aborts = 0;
    session.timeline = [];
    session.transport = {
      unary: () => Promise.reject(new Error("not used")),
      stream: () => Promise.reject(new Error("not used")),
    };
  });

  it("aborts its owned HTTP/2 session once across concurrent closes", async () => {
    const client = Client.connectTo("http://127.0.0.1:8080");

    const closes = [client.close(), client.close(), client.close()];
    expect(closes[1]).toBe(closes[0]);
    expect(closes[2]).toBe(closes[0]);
    await Promise.all(closes);

    expect(session.aborts).toBe(1);
  });

  it("waits for an already-running event cancellation before aborting the session", async () => {
    let finishCancel!: () => void;
    const remoteCancel = new Promise<void>((resolve) => { finishCancel = resolve; });
    session.transport = ownedObservationTransport(remoteCancel);
    const client = Client.connectTo("http://127.0.0.1:8080");
    const result = await client.asGuest().post(
      ProjectionStateSchema,
      create(ProjectionStateSchema),
      { observe: [ProjectionStateSchema] },
    );
    if (result.kind !== "ok") throw new Error("expected an acknowledgement");

    const cancelling = result.events.cancel();
    let cancelSettled = false;
    void cancelling.then(() => { cancelSettled = true; });
    const closing = client.close();
    let closeSettled = false;
    void closing.then(() => { closeSettled = true; });
    await Promise.resolve();

    expect(cancelSettled).toBe(false);
    expect(closeSettled).toBe(false);
    expect(session.aborts).toBe(0);
    expect(session.timeline).toEqual(["cancel-start"]);

    finishCancel();
    await Promise.all([cancelling, closing]);
    expect(cancelSettled).toBe(true);
    expect(closeSettled).toBe(true);
    expect(session.aborts).toBe(1);
    expect(session.timeline).toEqual(["cancel-start", "cancel-finish", "session-abort"]);
  });

  it("aborts the owned session before reporting cancellation failure", async () => {
    const failure = new Error("owned cancel failed");
    const remoteCancel = Promise.reject(failure);
    void remoteCancel.catch(() => undefined);
    session.transport = ownedObservationTransport(remoteCancel);
    const client = Client.connectTo("http://127.0.0.1:8080");
    await client.asGuest().post(
      ProjectionStateSchema,
      create(ProjectionStateSchema),
      { observe: [ProjectionStateSchema] },
    );

    await expect(client.close()).rejects.toBe(failure);
    expect(session.aborts).toBe(1);
  });

  it("aborts the owned session before reporting a settled automatic cancellation failure", async () => {
    const failure = new Error("automatic owned cancel failed");
    const remoteCancel = Promise.reject(failure);
    void remoteCancel.catch(() => undefined);
    session.transport = ownedObservationTransport(remoteCancel);
    const controller = new AbortController();
    const client = Client.connectTo("http://127.0.0.1:8080");
    const result = await client.asGuest().post(
      ProjectionStateSchema,
      create(ProjectionStateSchema),
      { observe: [ProjectionStateSchema], signal: controller.signal },
    );
    if (result.kind !== "ok") throw new Error("expected an acknowledgement");

    controller.abort(new Error("caller stopped observing"));
    await vi.waitFor(() => {
      expect(session.timeline).toContain("cancel-failure");
    });
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });

    await expect(client.close()).rejects.toBe(failure);
    expect(session.timeline).toEqual(["cancel-start", "cancel-failure", "session-abort"]);
  });
});

function ownedObservationTransport(remoteCancel: Promise<void>): Transport {
  return {
    async unary(method, _signal, _timeoutMs, _header, input) {
      if (method.name === "Subscribe") {
        return response(method, create(SubscriptionSchema, {
          id: create(SubscriptionIdSchema, { value: "s-owned" }),
        }));
      }
      if (method.name === "Cancel") {
        session.timeline.push("cancel-start");
        try {
          await remoteCancel;
          session.timeline.push("cancel-finish");
        } catch (error) {
          session.timeline.push("cancel-failure");
          throw error;
        }
        return response(method, create(ResponseSchema));
      }
      const command = input as Command;
      if (command.id === undefined) throw new Error("command ID required");
      return response(method, create(AckSchema, {
        messageId: packAny(CommandIdSchema, command.id),
        status: create(StatusSchema, { status: { case: "ok", value: create(EmptySchema) } }),
      }));
    },
    async stream(method) {
      const messages: AsyncIterable<never> = {
        [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => undefined) }),
      };
      return {
        stream: true,
        method,
        header: new Headers(),
        trailer: new Headers(),
        service: method.parent,
        message: messages,
      } as never;
    },
  };
}

function response(method: { readonly parent: unknown }, message: Message) {
  return {
    stream: false,
    method,
    header: new Headers(),
    trailer: new Headers(),
    service: method.parent,
    message,
  } as never;
}
