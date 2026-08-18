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

import * as http2 from "node:http2";
import type { AddressInfo } from "node:net";

import { create, type MessageShape } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient, type HandlerContext } from "@connectrpc/connect";
import { connectNodeAdapter, createGrpcTransport } from "@connectrpc/connect-node";
import { AckSchema } from "@spine-event-engine/proto";
import {
  CommandService,
  QueryService,
  QueryResponseSchema,
} from "@spine-event-engine/proto/client";
import { afterEach, describe, expect, it } from "vitest";

import { NodeCoordinator, type ReadyMemberSource } from "../../src/server/node-coordinator.js";

describe("NodeCoordinator", () => {
  const closeables: (() => Promise<void>)[] = [];

  afterEach(async () => {
    await Promise.all(closeables.splice(0).map((closeable) => closeable()));
  });

  it("forwards each generated command call once to ready replicas in round-robin order", async () => {
    const first = await backend("first");
    const second = await backend("second");
    closeables.push(first.close, second.close);
    const members = new TestReadyMembers([first.member, second.member]);
    const coordinator = await NodeCoordinator.open({ members, port: 0 });
    closeables.push(() => coordinator.close());

    const transport = createGrpcTransport({ baseUrl: coordinator.baseUrl });
    const firstAck = await createClient(CommandService, transport).post(
      create(CommandService.method.post.input),
    );
    const secondAck = await createClient(CommandService, transport).post(
      create(CommandService.method.post.input),
    );

    expect(firstAck.status).toBeDefined();
    expect(secondAck.status).toBeDefined();
    expect(first.commands()).toBe(1);
    expect(second.commands()).toBe(1);
  });

  it("returns unavailable without invoking an application replica when membership is empty", async () => {
    const coordinator = await NodeCoordinator.open({ members: new TestReadyMembers([]), port: 0 });
    closeables.push(() => coordinator.close());

    await expect(
      createClient(CommandService, createGrpcTransport({ baseUrl: coordinator.baseUrl })).post(
        create(CommandService.method.post.input),
      ),
    ).rejects.toMatchObject({ code: 14 });
  });

  it("forwards generated queries through the selected ready replica", async () => {
    const replica = await backend("query");
    closeables.push(replica.close);
    const coordinator = await NodeCoordinator.open({
      members: new TestReadyMembers([replica.member]),
      port: 0,
    });
    closeables.push(() => coordinator.close());

    await expect(
      createClient(QueryService, createGrpcTransport({ baseUrl: coordinator.baseUrl })).read(
        create(QueryService.method.read.input),
      ),
    ).resolves.toEqual(create(QueryResponseSchema));
  });

  it("reconciles replacement membership without exposing or polling child topology", async () => {
    const first = await backend("first");
    const replacement = await backend("replacement");
    closeables.push(first.close, replacement.close);
    const members = new TestReadyMembers([first.member]);
    const coordinator = await NodeCoordinator.open({ members, port: 0 });
    closeables.push(() => coordinator.close());
    const client = createClient(
      CommandService,
      createGrpcTransport({ baseUrl: coordinator.baseUrl }),
    );

    await client.post(create(CommandService.method.post.input));
    members.set([replacement.member]);
    await expect
      .poll(async () => {
        await client.post(create(CommandService.method.post.input));
        return replacement.commands();
      })
      .toBe(1);
    expect(first.commands()).toBe(1);
  });

  it("does not retry an admitted command after the selected child fails", async () => {
    const failing = await backend("failing", {
      post: () => Promise.reject(new ConnectError("child lost", Code.Unavailable)),
    });
    const sibling = await backend("sibling");
    closeables.push(failing.close, sibling.close);
    const coordinator = await NodeCoordinator.open({
      members: new TestReadyMembers([failing.member, sibling.member]),
      port: 0,
    });
    closeables.push(() => coordinator.close());

    await expect(
      createClient(CommandService, createGrpcTransport({ baseUrl: coordinator.baseUrl })).post(
        create(CommandService.method.post.input),
      ),
    ).rejects.toMatchObject({ code: Code.Unavailable });
    expect(failing.commands()).toBe(1);
    expect(sibling.commands()).toBe(0);
  });

  it("propagates cancellation and application metadata to the selected child", async () => {
    let aborted = false;
    let startedResolve: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      startedResolve = resolve;
    });
    const replica = await backend("cancel", {
      post: (context) =>
        new Promise((_, reject) => {
          startedResolve?.();
          context.signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(new ConnectError("cancelled", Code.Canceled));
            },
            { once: true },
          );
          context.responseHeader.set("x-child", context.requestHeader.get("x-tenant") ?? "missing");
          context.responseTrailer.set("x-trailer", "child");
        }),
    });
    closeables.push(replica.close);
    const coordinator = await NodeCoordinator.open({
      members: new TestReadyMembers([replica.member]),
      port: 0,
    });
    closeables.push(() => coordinator.close());
    const controller = new AbortController();
    const request = createGrpcTransport({ baseUrl: coordinator.baseUrl }).unary(
      CommandService.method.post,
      controller.signal,
      undefined,
      { "x-tenant": "acme" },
      create(CommandService.method.post.input),
    );
    await started;
    controller.abort();
    await expect(request).rejects.toMatchObject({ code: Code.Canceled });
    await expect.poll(() => aborted).toBe(true);
  });

  it("preserves application metadata and downstream response headers and trailers", async () => {
    const replica = await backend("metadata", {
      post: (context) => {
        context.responseHeader.set("x-child", context.requestHeader.get("x-tenant") ?? "missing");
        context.responseTrailer.set("x-trailer", "child");
        return create(AckSchema, { status: { case: "ok", value: {} } });
      },
    });
    closeables.push(replica.close);
    const coordinator = await NodeCoordinator.open({
      members: new TestReadyMembers([replica.member]),
      port: 0,
    });
    closeables.push(() => coordinator.close());

    const response = await createGrpcTransport({ baseUrl: coordinator.baseUrl }).unary(
      CommandService.method.post,
      undefined,
      undefined,
      { "x-tenant": "acme" },
      create(CommandService.method.post.input),
    );
    expect(response.header.get("x-child")).toBe("acme");
    expect(response.trailer.get("x-trailer")).toBe("child");
  });

  it("forwards the remaining deadline to the selected child", async () => {
    let deadlineObserved = false;
    const replica = await backend("deadline", {
      post: (context) =>
        new Promise((_, reject) => {
          context.signal.addEventListener(
            "abort",
            () => {
              deadlineObserved = true;
              reject(new ConnectError("deadline", Code.DeadlineExceeded));
            },
            { once: true },
          );
        }),
    });
    closeables.push(replica.close);
    const coordinator = await NodeCoordinator.open({
      members: new TestReadyMembers([replica.member]),
      port: 0,
    });
    closeables.push(() => coordinator.close());

    await expect(
      createGrpcTransport({ baseUrl: coordinator.baseUrl, defaultTimeoutMs: 20 }).unary(
        CommandService.method.post,
        undefined,
        undefined,
        undefined,
        create(CommandService.method.post.input),
      ),
    ).rejects.toMatchObject({ code: Code.DeadlineExceeded });
    await expect.poll(() => deadlineObserved).toBe(true);
  });

  it("enforces configured inbound and outbound message bounds at the Coordinator", async () => {
    const replica = await backend("bounds");
    closeables.push(replica.close);
    const request = create(CommandService.method.post.input, { id: { value: "request" } });
    const inbound = await NodeCoordinator.open({
      members: new TestReadyMembers([replica.member]),
      port: 0,
      readMaxBytes: 1,
    });
    closeables.push(() => inbound.close());
    await expect(
      createClient(CommandService, createGrpcTransport({ baseUrl: inbound.baseUrl })).post(request),
    ).rejects.toBeInstanceOf(ConnectError);

    const outbound = await NodeCoordinator.open({
      members: new TestReadyMembers([replica.member]),
      port: 0,
      writeMaxBytes: 1,
    });
    closeables.push(() => outbound.close());
    await expect(
      createClient(CommandService, createGrpcTransport({ baseUrl: outbound.baseUrl })).post(
        request,
      ),
    ).rejects.toBeInstanceOf(ConnectError);
  });
});

class TestReadyMembers implements ReadyMemberSource {
  readonly #listeners = new Set<() => void>();

  #members: readonly ReadyMember[];

  constructor(members: readonly ReadyMember[]) {
    this.#members = members;
  }

  readyMembers(): readonly ReadyMember[] {
    return this.#members;
  }

  onReadyMembersChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  set(members: readonly ReadyMember[]): void {
    this.#members = members;
    for (const listener of this.#listeners) listener();
  }
}

interface ReadyMember {
  readonly endpoint: string;
  readonly incarnation: string;
  readonly pid: number;
  readonly slot: number;
}

async function backend(
  name: string,
  options: {
    readonly post?: (context: HandlerContext) => Promise<never> | MessageShape<typeof AckSchema>;
  } = {},
): Promise<{
  readonly member: ReadyMember;
  readonly close: () => Promise<void>;
  readonly commands: () => number;
}> {
  const value = { commands: 0 };
  const server = http2.createServer(
    connectNodeAdapter({
      routes: (router) => {
        router.service(CommandService, {
          post: (_command, context) => {
            value.commands++;
            if (options.post !== undefined) return options.post(context);
            return create(AckSchema, { status: { case: "ok", value: {} } });
          },
        });
        router.service(QueryService, {
          read: (): MessageShape<typeof QueryResponseSchema> => create(QueryResponseSchema),
        });
      },
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const close = () =>
    new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  return {
    member: {
      slot: value.commands,
      incarnation: name,
      pid: 1,
      endpoint: `http://127.0.0.1:${address.port.toString()}`,
    },
    commands: () => value.commands,
    close,
  };
}
