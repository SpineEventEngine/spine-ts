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

import { generateKeyPairSync, randomBytes } from "node:crypto";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { Client } from "@spine-event-engine/client-web";
import { ServerTests } from "@spine-event-engine/server/testing";
import { ReadBoardStats } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/board_queries_app_query.js";
import {
  BoardIdSchema,
  MessageIdSchema,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import { PostMessageSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/commands_pb.js";
import { UserIdSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/user_pb.js";
import "@spine-event-engine/example-message-board-model";
import {
  ResolveContextRequestSchema,
  ResolveContextResponseSchema,
} from "@spine-event-engine/proto/auth";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardAdmission } from "../src/signed-admission.js";
import { MessageBoardApplication } from "../src/message-board-domain.js";

describe("Message Board signed admission", () => {
  afterEach(async () => ServerTests.resetEnvironment());
  it("verifies a real issued session and operation-bound forwarding proof", async () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const admission = BoardAdmission.signed({
      MESSAGE_BOARD_SESSION_PRIVATE_KEY_PEM: privateKey
        .export({ format: "pem", type: "pkcs8" })
        .toString(),
      MESSAGE_BOARD_SESSION_KEY_ID: "test-key",
      MESSAGE_BOARD_SESSION_ISSUER: "message-board-test",
      MESSAGE_BOARD_SESSION_AUDIENCE: "message-board-browser",
      MESSAGE_BOARD_READER_PROOF_KEY_BASE64: randomBytes(32).toString("base64"),
    });
    const issued = await admission.sessions.issue({
      id: "ada",
      attributes: {
        boards: "general,restricted,announcements",
        canReadRestricted: "true",
      },
    });
    expect(issued.kind).toBe("issued");
    if (issued.kind !== "issued") return;
    const resolved = await admission.sessions.resolve(issued.credential);
    expect(resolved?.principal.id).toBe("ada");
    expect(resolved?.principal.attributes?.canReadRestricted).toBe("true");
    const bytes = new Uint8Array([1, 2, 3]);
    const proof = await admission.forwardingProof.issue(bytes);
    expect(await admission.readerAdmission.forwarded.verify(bytes, proof, {} as never)).toBe(true);
    expect(
      await admission.readerAdmission.forwarded.verify(
        new Uint8Array([1, 2, 4]),
        proof,
        {} as never,
      ),
    ).toBe(false);
    expect(await admission.readerAdmission.forwarded.verify(bytes, "short", {} as never)).toBe(
      false,
    );
    expect(
      await admission.readerAdmission.forwarded.verify(bytes, "!".repeat(43), {} as never),
    ).toBe(false);
    expect(
      await admission.readerAdmission.forwarded.verify(bytes, "A".repeat(43), {} as never),
    ).toBe(false);
    const direct = await admission.readerAdmission.direct.authenticate({
      service: "spine.client.QueryService",
      method: "Execute",
      value: bytes,
      headers: { authorization: `Bearer ${issued.credential.value}` },
      peer: {} as never,
    });
    expect(direct).toMatchObject({
      principal: { id: "ada" },
      authorityFacts: {
        canReadRestricted: true,
      },
    });
    const directRequest = (headers: Headers | Readonly<Record<string, string>>) => ({
      service: "spine.client.QueryService",
      method: "Execute",
      value: bytes,
      headers,
      peer: {} as never,
    });
    expect(
      await admission.readerAdmission.direct.authenticate(
        directRequest(new Headers({ authorization: `Bearer ${issued.credential.value}` })),
      ),
    ).toMatchObject({ principal: { id: "ada" }, authorityFacts: { canReadRestricted: true } });
    expect(
      await admission.readerAdmission.direct.authenticate(
        directRequest({ authorization: "Basic x" }),
      ),
    ).toBeUndefined();
    expect(
      await admission.readerAdmission.direct.authenticate(
        directRequest({ authorization: "Bearer invalid" }),
      ),
    ).toBeUndefined();
    await admission.sessions.close();
  });

  it("requires protected configuration only in signed mode", () => {
    expect(BoardAdmission.configured({})).toBeUndefined();
    expect(BoardAdmission.configured({ MESSAGE_BOARD_AUTH_MODE: "public" })).toBeUndefined();
    expect(() => BoardAdmission.configured({ MESSAGE_BOARD_AUTH_MODE: "unrecognized" })).toThrow(
      "MESSAGE_BOARD_AUTH_MODE must be public or signed.",
    );
    expect(() => BoardAdmission.configured({ MESSAGE_BOARD_AUTH_MODE: "signed" })).toThrow(
      "Missing required configuration: MESSAGE_BOARD_SESSION_ISSUER.",
    );
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const environment = {
      MESSAGE_BOARD_SESSION_PRIVATE_KEY_PEM: privateKey
        .export({ format: "pem", type: "pkcs8" })
        .toString(),
      MESSAGE_BOARD_SESSION_KEY_ID: "test-key",
      MESSAGE_BOARD_SESSION_ISSUER: "message-board-test",
      MESSAGE_BOARD_SESSION_AUDIENCE: "message-board-browser",
      MESSAGE_BOARD_READER_PROOF_KEY_BASE64: randomBytes(31).toString("base64"),
    };
    expect(() => BoardAdmission.signed(environment)).toThrow(
      "MESSAGE_BOARD_READER_PROOF_KEY_BASE64 must decode to at least 32 bytes.",
    );
  });

  it("forwards a signed reader to restricted lifetime statistics and hides them from ordinary readers", async () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const environment = {
      MESSAGE_BOARD_AUTH_MODE: "signed",
      MESSAGE_BOARD_SESSION_PRIVATE_KEY_PEM: privateKey
        .export({ format: "pem", type: "pkcs8" })
        .toString(),
      MESSAGE_BOARD_SESSION_KEY_ID: "integration-key",
      MESSAGE_BOARD_SESSION_ISSUER: "board-test",
      MESSAGE_BOARD_SESSION_AUDIENCE: "board-web",
      MESSAGE_BOARD_READER_PROOF_KEY_BASE64: randomBytes(32).toString("base64"),
    };
    const admission = BoardAdmission.signed(environment);
    const granted = await admission.sessions.issue({
      id: "ada",
      attributes: {
        boards: "general,restricted,announcements",
        canReadRestricted: "true",
      },
    });
    const ordinary = await admission.sessions.issue({
      id: "reader",
      attributes: {
        boards: "general,announcements",
        canReadRestricted: "false",
      },
    });
    if (granted.kind !== "issued" || ordinary.kind !== "issued")
      throw new Error("Expected issued sessions.");
    const running = await new MessageBoardApplication(environment).start();
    const client = (token: string) =>
      Client.forConnect(running.baseUrl, {
        onRequestMetadata: () => ({
          authorization: `Bearer ${token}`,
          origin: "http://127.0.0.1:5173",
        }),
      });
    const writer = client(granted.credential.value);
    const reader = client(ordinary.credential.value);
    try {
      const contextResponse = await fetch(
        `${running.baseUrl}/spine.auth.AuthenticationService/ResolveContext`,
        {
          method: "POST",
          headers: {
            "content-type": "application/proto",
            authorization: `Bearer ${granted.credential.value}`,
            origin: "http://127.0.0.1:5173",
          },
          body: toBinary(ResolveContextRequestSchema, create(ResolveContextRequestSchema)),
        },
      );
      expect(contextResponse.status).toBe(200);
      expect(
        fromBinary(
          ResolveContextResponseSchema,
          new Uint8Array(await contextResponse.arrayBuffer()),
        ).actor?.value,
      ).toBe("ada");
      await expect(
        writer.onBehalfOf("ada").post(
          PostMessageSchema,
          create(PostMessageSchema, {
            id: create(MessageIdSchema, { value: "private-post" }),
            board: create(BoardIdSchema, { value: "restricted" }),
            author: create(UserIdSchema, { value: "ada" }),
            username: "Ada",
            text: "Private",
            postedAt: { seconds: 1n },
          }),
        ),
      ).resolves.toMatchObject({ kind: "ok" });
      const query = create(ReadBoardStats.querySchema, {
        board: create(BoardIdSchema, { value: "restricted" }),
      });
      await vi.waitFor(async () => {
        const result = await writer.onBehalfOf("ada").query(query);
        expect(result.message[0]?.board?.messageCount).toBe(1n);
      });
      expect((await reader.onBehalfOf("reader").query(query)).message[0]?.board).toBeUndefined();
      await expect(reader.onBehalfOf("ada").query(query)).rejects.toThrow("context-stale");
      const tampered = client(`${granted.credential.value}x`);
      try {
        await expect(tampered.onBehalfOf("ada").query(query)).rejects.toThrow();
      } finally {
        await tampered.close();
      }
    } finally {
      await writer.close();
      await reader.close();
      await running.close();
      await admission.sessions.close();
    }
  });
});
