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

import { create, toBinary } from "@bufbuild/protobuf";
import { Code, ConnectError, type Transport } from "@connectrpc/connect";
import { AckSchema, ErrorSchema } from "@spine-event-engine/proto";
import { ActorContextSchema } from "@spine-event-engine/proto";
import { TypeUrls } from "@spine-event-engine/core";
import { ReaderForwarding } from "@spine-event-engine/core/spi/reader-forwarding";
import { TaskCreatedSchema } from "../../../examples/todo/generated/spine/examples/todo/task_events_pb.js";
import {
  CommandService,
  EntityUpdatesSchema,
  EventUpdatesSchema,
  QueryService,
  SubscriptionSchema,
  SubscriptionService,
  SubscriptionUpdateSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import { describe, expect, it } from "vitest";
import { NativeSubscriptionCreator, SubscriptionUpdateRelay } from "../src/index.js";

describe("SubscriptionUpdateRelay", () => {
  it("binds Subscribe and Cancel proofs to their distinct native request bytes", async () => {
    const calls: { method: string; bytes: Uint8Array; headers?: Headers }[] = [];
    const topic = create(TopicSchema, {
      id: { value: "task-created-topic" },
      target: {
        type: TypeUrls.derive(TaskCreatedSchema),
        criterion: { case: "includeAll", value: true },
      },
      context: create(ActorContextSchema, { actor: { value: "reader-1" } }),
    });
    const transport = {
      unary: (
        method: { name: string; input: typeof TopicSchema },
        _signal: AbortSignal,
        _timeout: unknown,
        headers: Headers,
        input: unknown,
      ) => {
        calls.push({ method: method.name, bytes: toBinary(method.input, input as never), headers });
        return Promise.resolve({
          message: create(SubscriptionSchema, { id: { value: "s-1" }, topic }),
          header: new Headers(),
          trailer: new Headers(),
        });
      },
    } as unknown as Transport;
    const creator = new NativeSubscriptionCreator(transport, {
      issuer: { issue: () => Promise.resolve("signed") },
      maxBytes: 4_194_304,
    });
    const wire = {
      kind: "public-subscription" as const,
      bytes: toBinary(
        SubscriptionSchema,
        create(SubscriptionSchema, {
          id: { value: "s-1" },
          topic,
        }),
      ),
      reader: { principal: { id: "reader-1" } },
    };
    await creator.subscribe(wire, new AbortController().signal);
    await creator.cancel({ wire }, new AbortController().signal);
    expect(calls.map((call) => call.method)).toEqual(["Subscribe", "Cancel"]);
    for (const call of calls) {
      if (call.headers === undefined) throw new Error("Expected forwarding headers.");
      await expect(
        ReaderForwarding.open(
          call.headers,
          "spine.client.SubscriptionService",
          call.method,
          call.bytes,
          { verify: (_bytes, proof) => proof === "signed" },
          {},
          4_194_304,
        ),
      ).resolves.toMatchObject({ principal: { id: "reader-1" } });
    }
    const first = calls[0];
    if (first?.headers === undefined) throw new Error("Expected first forwarded request.");
    await expect(
      ReaderForwarding.open(
        first.headers,
        "spine.client.SubscriptionService",
        "Cancel",
        first.bytes,
        { verify: () => true },
        {},
        4_194_304,
      ),
    ).rejects.toThrow("Invalid forwarding proof");
  });
  it("copies updates and delivers them in FIFO order", async () => {
    const relay = new SubscriptionUpdateRelay({ maxMessages: 2, maxBytes: 100 });
    const first = toBinary(
      SubscriptionUpdateSchema,
      create(SubscriptionUpdateSchema, {
        update: { case: "eventUpdates", value: create(EventUpdatesSchema) },
      }),
    );
    const second = toBinary(
      SubscriptionUpdateSchema,
      create(SubscriptionUpdateSchema, {
        update: { case: "entityUpdates", value: create(EntityUpdatesSchema) },
      }),
    );
    await relay.push({ kind: "subscription-update", bytes: first });
    await relay.push({ kind: "subscription-update", bytes: second });
    first.fill(9);
    const firstResult = await relay[Symbol.asyncIterator]().next();
    const secondResult = await relay[Symbol.asyncIterator]().next();
    if (firstResult.done || secondResult.done) throw new Error("expected queued updates");
    expect(firstResult.value.update.case).toBe("eventUpdates");
    expect(secondResult.value.update.case).toBe("entityUpdates");
  });

  it("delivers an update directly to a waiting consumer", async () => {
    const relay = new SubscriptionUpdateRelay();
    const iterator = relay[Symbol.asyncIterator]();
    const waiting = iterator.next();

    await relay.push({
      kind: "subscription-update",
      bytes: toBinary(
        SubscriptionUpdateSchema,
        create(SubscriptionUpdateSchema, {
          update: { case: "eventUpdates", value: create(EventUpdatesSchema) },
        }),
      ),
    });

    await expect(waiting).resolves.toMatchObject({
      done: false,
      value: { update: { case: "eventUpdates" } },
    });
  });

  it("rejects further backend updates after graceful relay closure", async () => {
    const relay = new SubscriptionUpdateRelay();
    relay.close();

    await expect(
      relay.push({ kind: "subscription-update", bytes: new Uint8Array() }),
    ).rejects.toMatchObject({ code: 1 });
  });

  it("makes relay push and iterator cancellation take effect before their promises settle", async () => {
    const relay = new SubscriptionUpdateRelay();
    const push = relay.push({
      kind: "subscription-update",
      bytes: toBinary(SubscriptionUpdateSchema, create(SubscriptionUpdateSchema)),
    });
    relay.close();
    await expect(push).resolves.toBeUndefined();
    await expect(relay[Symbol.asyncIterator]().next()).resolves.toMatchObject({ done: false });

    const iterator = relay[Symbol.asyncIterator]();
    const closing = iterator.return?.();
    const afterClose = iterator.next();
    await expect(afterClose).rejects.toMatchObject({ code: 1 });
    await expect(closing).resolves.toMatchObject({ done: true });
  });

  it("rejects count overflow before byte overflow with a deterministic error", async () => {
    const relay = new SubscriptionUpdateRelay({ maxMessages: 1, maxBytes: 1 });
    await relay.push({ kind: "subscription-update", bytes: new Uint8Array() });
    await expect(
      relay.push({ kind: "subscription-update", bytes: new Uint8Array([1, 2]) }),
    ).rejects.toMatchObject({
      code: 8,
      rawMessage: "subscription relay message limit 1 exceeded by 2",
    });
  });

  it("maps byte overflow after the message count remains within its limit", async () => {
    const relay = new SubscriptionUpdateRelay({ maxMessages: 2, maxBytes: 1 });
    const update = toBinary(
      SubscriptionUpdateSchema,
      create(SubscriptionUpdateSchema, {
        update: { case: "eventUpdates", value: create(EventUpdatesSchema) },
      }),
    );
    await expect(relay.push({ kind: "subscription-update", bytes: update })).rejects.toMatchObject({
      code: 8,
      rawMessage: "subscription relay byte limit 1 exceeded by 2",
    });
  });

  it("rejects a pending consumer when the relay fails", async () => {
    const relay = new SubscriptionUpdateRelay();
    const next = relay[Symbol.asyncIterator]().next();
    const error = new Error("backend failed");
    relay.fail(error);
    await expect(next).rejects.toBe(error);
  });

  it("rejects a waiting consumer when malformed update bytes arrive", async () => {
    const relay = new SubscriptionUpdateRelay();
    const pending = relay[Symbol.asyncIterator]().next();
    await expect(
      relay.push({ kind: "subscription-update", bytes: new Uint8Array([255]) }),
    ).rejects.toThrow();
    await expect(pending).rejects.toThrow();
  });

  it("purges queued updates when malformed update bytes arrive", async () => {
    const relay = new SubscriptionUpdateRelay();
    await relay.push({
      kind: "subscription-update",
      bytes: toBinary(SubscriptionUpdateSchema, create(SubscriptionUpdateSchema)),
    });
    await expect(
      relay.push({ kind: "subscription-update", bytes: new Uint8Array([255]) }),
    ).rejects.toThrow();
    await expect(relay[Symbol.asyncIterator]().next()).rejects.toThrow();
  });
});

describe("NativeSubscriptionCreator", () => {
  it("attaches an operation-bound proof for an authenticated unary reader", async () => {
    let headers: Headers | undefined;
    const transport = {
      unary: (_method: unknown, _signal: unknown, _timeout: unknown, requestHeaders: Headers) => {
        headers = requestHeaders;
        return Promise.resolve({
          stream: false,
          header: new Headers(),
          trailer: new Headers(),
          message: create(QueryService.method.read.output),
        });
      },
    } as unknown as Transport;
    const value = toBinary(QueryService.method.read.input, create(QueryService.method.read.input));
    const native = new NativeSubscriptionCreator(transport, {
      issuer: { issue: () => "signed" },
      maxBytes: 4 * 1024 * 1024,
    });
    await native.forward({
      service: "spine.client.QueryService",
      method: "Read",
      value,
      reader: { principal: { id: "reader/one" }, authorityFacts: { roles: ["reader"] } },
    });
    const opened = await ReaderForwarding.open(
      headers ?? new Headers(),
      "spine.client.QueryService",
      "Read",
      value,
      { verify: (_bytes, proof) => proof === "signed" },
      {},
      4 * 1024 * 1024,
    );
    expect(opened).toEqual({
      principal: { id: "reader/one" },
      authorityFacts: { roles: ["reader"] },
    });
  });
  it.each(["activate", "cancel", "dispose"] as const)(
    "retains application metadata on failed subscription %s",
    async (operation) => {
      const failure = new ConnectError("backend unavailable", Code.Unavailable, {
        "content-type": "application/grpc+proto",
        "grpc-message": "backend unavailable",
        "x-application-trace": "operation-trace",
      });
      const creator = new NativeSubscriptionCreator({
        unary: () => Promise.reject(failure),
        stream: () => Promise.reject(failure),
      });
      const bytes = toBinary(
        SubscriptionSchema,
        create(SubscriptionSchema, {
          id: { value: "one" },
          topic: create(TopicSchema),
        }),
      );
      const wire = { kind: "public-subscription" as const, bytes };
      const backend = { kind: "backend-subscription-envelope" as const, bytes };
      const signal = new AbortController().signal;
      const work =
        operation === "activate"
          ? creator.activate({ wire: backend, updates: () => Promise.resolve() }, signal)
          : operation === "cancel"
            ? creator.cancel({ wire }, signal)
            : creator.dispose(backend, signal);
      await expect(work).rejects.toBe(failure);
      expect(failure.metadata.get("content-type")).toBeNull();
      expect(failure.metadata.get("grpc-message")).toBeNull();
      expect(failure.metadata.get("x-application-trace")).toBe("operation-trace");
    },
  );

  it("keeps subscription application metadata while dropping backend protocol headers", async () => {
    const failure = new ConnectError("missing tenant", Code.NotFound, {
      "content-type": "application/grpc+proto",
      "grpc-status": "5",
      "x-application-trace": "subscription-trace",
    });
    const creator = new NativeSubscriptionCreator({
      unary: () => Promise.reject(failure),
    } as unknown as Transport);
    const wire = {
      kind: "public-subscription" as const,
      bytes: toBinary(
        SubscriptionSchema,
        create(SubscriptionSchema, { topic: create(TopicSchema) }),
      ),
    };
    await expect(creator.subscribe(wire, new AbortController().signal)).rejects.toBe(failure);
    expect(failure.metadata.get("content-type")).toBeNull();
    expect(failure.metadata.get("grpc-status")).toBeNull();
    expect(failure.metadata.get("x-application-trace")).toBe("subscription-trace");
  });

  it("preserves application error metadata while dropping backend protocol headers", async () => {
    const failure = new ConnectError("missing tenant", Code.NotFound, {
      "content-type": "application/grpc+proto",
      "grpc-status": "5",
      "x-application-trace": "trace-1",
    });
    const transport = { unary: () => Promise.reject(failure) } as unknown as Transport;
    const creator = new NativeSubscriptionCreator(transport);
    const actual = await creator
      .forward({
        service: "spine.client.CommandService",
        method: "Post",
        value: toBinary(CommandService.method.post.input, create(CommandService.method.post.input)),
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(actual).toBe(failure);
    expect(failure.metadata.get("content-type")).toBeNull();
    expect(failure.metadata.get("grpc-status")).toBeNull();
    expect(failure.metadata.get("x-application-trace")).toBe("trace-1");
  });

  it("preserves typed Query validation details and the native Spine trailer", async () => {
    const detail = create(ErrorSchema, {
      type: "spine.client.QueryValidationError",
      code: 2,
      message: "query validation failed.",
    });
    const failure = new ConnectError(
      "query validation failed.",
      Code.InvalidArgument,
      {
        "grpc-status": "3",
        "spine-error-bin": Buffer.from(toBinary(ErrorSchema, detail)).toString("base64"),
      },
      [{ desc: ErrorSchema, value: detail }],
    );
    const creator = new NativeSubscriptionCreator({
      unary: () => Promise.reject(failure),
    } as unknown as Transport);
    const actual = await creator
      .forward({
        service: "spine.client.QueryService",
        method: "Read",
        value: toBinary(QueryService.method.read.input, create(QueryService.method.read.input)),
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(actual).toBe(failure);
    expect(failure.findDetails(ErrorSchema)).toEqual([detail]);
    expect(failure.metadata.get("spine-error-bin")).toBeDefined();
    expect(failure.metadata.get("grpc-status")).toBeNull();
  });

  it("uses shared descriptors and preserves supplied abort signals", async () => {
    const calls: { method: string; signal: AbortSignal | undefined }[] = [];
    let mismatchedChild = false;
    const transport = {
      unary: (method: { name: string; parent: unknown }, signal: AbortSignal | undefined) => {
        calls.push({ method: method.name, signal });
        const message =
          method.name === "Subscribe"
            ? create(SubscriptionSchema, { id: { value: "one" }, topic: create(TopicSchema) })
            : method.name === "Post"
              ? create(AckSchema)
              : method.name === "Read"
                ? create(QueryService.method.read.output)
                : create(SubscriptionService.method.cancel.output);
        return Promise.resolve({
          stream: false,
          method,
          service: method.parent,
          header: new Headers(),
          trailer: new Headers(),
          message,
        });
      },
      stream: (method: { name: string; parent: unknown }, signal: AbortSignal | undefined) => {
        calls.push({ method: method.name, signal });
        return Promise.resolve({
          stream: true,
          method,
          service: method.parent,
          header: new Headers(),
          trailer: new Headers(),
          message: (async function* () {
            await Promise.resolve();
            yield create(SubscriptionUpdateSchema, {
              subscription: create(SubscriptionSchema, {
                id: { value: mismatchedChild ? "other" : "one" },
                topic: create(TopicSchema),
              }),
            });
          })(),
        });
      },
    } as unknown as Transport;
    const native = new NativeSubscriptionCreator(transport);
    await native.forward({
      service: "spine.client.CommandService",
      method: "Post",
      value: toBinary(CommandService.method.post.input, create(CommandService.method.post.input)),
    });
    await native.forward({
      service: "spine.client.QueryService",
      method: "Read",
      value: toBinary(QueryService.method.read.input, create(QueryService.method.read.input)),
    });
    const signal = new AbortController().signal;
    const wire = {
      kind: "public-subscription" as const,
      bytes: toBinary(
        SubscriptionSchema,
        create(SubscriptionSchema, { topic: create(TopicSchema) }),
      ),
    };
    const backend = await native.subscribe(wire, signal);
    expect(backend).toEqual({
      kind: "backend-subscription-envelope",
      bytes: toBinary(
        SubscriptionSchema,
        create(SubscriptionSchema, { id: { value: "one" }, topic: create(TopicSchema) }),
      ),
    });
    const updates: Uint8Array[] = [];
    await native.activate(
      {
        wire: backend,
        updates: (update) => {
          updates.push(update.bytes);
          return Promise.resolve();
        },
      },
      signal,
    );
    mismatchedChild = true;
    await expect(
      native.activate(
        {
          wire: backend,
          updates: () => Promise.reject(new Error("invalid child update reached the public sink")),
        },
        signal,
      ),
    ).rejects.toThrow("Backend child update does not match its subscription.");
    await native.cancel({ wire }, signal);
    await native.dispose(backend, signal);
    expect(calls.map((call) => call.method)).toEqual([
      "Post",
      "Read",
      "Subscribe",
      "Activate",
      "Activate",
      "Cancel",
      "Cancel",
    ]);
    expect(calls.slice(2).every((call) => call.signal === signal)).toBe(true);
    expect(updates).toHaveLength(1);
  });
});
