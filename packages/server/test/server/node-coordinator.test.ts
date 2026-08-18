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
import { createClient } from "@connectrpc/connect";
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
});

class TestReadyMembers implements ReadyMemberSource {
  readonly #listeners = new Set<() => void>();

  readonly #members: readonly ReadyMember[];

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
}

interface ReadyMember {
  readonly endpoint: string;
  readonly incarnation: string;
  readonly pid: number;
  readonly slot: number;
}

async function backend(name: string): Promise<{
  readonly member: ReadyMember;
  readonly close: () => Promise<void>;
  readonly commands: () => number;
}> {
  const value = { commands: 0 };
  const server = http2.createServer(
    connectNodeAdapter({
      routes: (router) => {
        router.service(CommandService, {
          post: () => {
            value.commands++;
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
