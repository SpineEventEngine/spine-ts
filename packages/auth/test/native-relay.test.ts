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
import type { Transport } from "@connectrpc/connect";
import { AckSchema } from "@spine-event-engine/proto";
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
  it("uses shared descriptors and preserves supplied abort signals", async () => {
    const calls: { method: string; signal: AbortSignal | undefined }[] = [];
    const transport = {
      unary: (method: { name: string; parent: unknown }, signal: AbortSignal | undefined) => {
        calls.push({ method: method.name, signal });
        const message =
          method.name === "Subscribe"
            ? create(SubscriptionSchema, { id: { value: "one" } })
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
            yield create(SubscriptionUpdateSchema);
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
      bytes: toBinary(SubscriptionSchema, create(SubscriptionSchema, { id: { value: "one" } })),
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
    await native.cancel({ wire }, signal);
    await native.dispose(backend, signal);
    expect(calls.map((call) => call.method)).toEqual([
      "Post",
      "Read",
      "Subscribe",
      "Activate",
      "Cancel",
      "Cancel",
    ]);
    expect(calls.slice(2).every((call) => call.signal === signal)).toBe(true);
    expect(updates).toHaveLength(1);
  });
});
