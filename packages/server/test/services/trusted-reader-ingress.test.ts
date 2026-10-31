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

import { Code, ConnectError } from "@connectrpc/connect";
import { ReaderForwarding } from "@spine-event-engine/core/spi/reader-forwarding";
import { describe, expect, it } from "vitest";
import { TrustedReaderIngress } from "../../src/services/trusted-reader-ingress.js";

describe("trusted native reader ingress", () => {
  const request = new Uint8Array([1, 2]);
  const operation = { service: "spine.client.QueryService", method: "Read", request };

  it("requires a configured peer verifier for internal assertions", async () => {
    const headers = new Headers(
      await ReaderForwarding.seal(
        operation.service,
        operation.method,
        request,
        { principal: { id: "alice" } },
        { issue: () => "proof" },
        1024,
      ),
    );
    await expect(
      TrustedReaderIngress.admit({ ...operation, headers, peer: {}, maxBytes: 1024 }),
    ).rejects.toMatchObject({ code: Code.Unauthenticated });
  });

  it("does not downgrade missing proof when forwarding verification is configured", async () => {
    await expect(
      TrustedReaderIngress.admit({
        ...operation,
        headers: new Headers(),
        peer: {},
        maxBytes: 1024,
        forwarded: { verify: () => true },
      }),
    ).rejects.toMatchObject({ code: Code.Unauthenticated });
    expect(
      await TrustedReaderIngress.admit({
        ...operation,
        headers: new Headers(),
        peer: {},
        maxBytes: 1024,
        forwarded: { verify: () => true },
        direct: { authenticate: () => ({}) },
      }),
    ).toEqual({});
  });

  it("verifies peer and request, then snapshots its trusted reader", async () => {
    const headers = new Headers(
      await ReaderForwarding.seal(
        operation.service,
        operation.method,
        request,
        { principal: { id: "alice" }, authorityFacts: { enabled: true } },
        { issue: () => "proof" },
        1024,
      ),
    );
    const admitted = await TrustedReaderIngress.admit({
      ...operation,
      headers,
      peer: "gateway",
      maxBytes: 1024,
      forwarded: { verify: (_bytes, proof, peer) => peer === "gateway" && proof === "proof" },
    });
    expect(admitted).toEqual({ principal: { id: "alice" }, authorityFacts: { enabled: true } });
    await expect(
      TrustedReaderIngress.admit({
        ...operation,
        method: "Execute",
        headers,
        peer: "gateway",
        maxBytes: 1024,
        forwarded: { verify: () => true },
      }),
    ).rejects.toMatchObject({ code: Code.Unauthenticated });
  });

  it("uses a replaceable direct authenticator and leaves deliberately public ingress anonymous", async () => {
    const headers = new Headers({ authorization: "Bearer direct" });
    expect(
      await TrustedReaderIngress.admit({
        ...operation,
        headers,
        peer: {},
        maxBytes: 1024,
        direct: { authenticate: () => ({ principal: { id: "direct" } }) },
      }),
    ).toEqual({ principal: { id: "direct" } });
    expect(
      await TrustedReaderIngress.admit({
        ...operation,
        headers: new Headers(),
        peer: {},
        maxBytes: 1024,
      }),
    ).toEqual({});
    await expect(
      TrustedReaderIngress.admit({
        ...operation,
        headers,
        peer: {},
        maxBytes: 1024,
        direct: { authenticate: () => undefined },
      }),
    ).rejects.toMatchObject({
      code: Code.Unauthenticated,
    });
  });

  it("does not admit authority facts without an authenticated principal", async () => {
    await expect(
      TrustedReaderIngress.admit({
        ...operation,
        headers: new Headers(),
        peer: {},
        maxBytes: 1024,
        direct: { authenticate: () => ({ authorityFacts: { privileged: true } }) },
      }),
    ).rejects.toMatchObject({ code: Code.Internal });
  });

  it("never exposes a direct authenticator's private failure", async () => {
    const error = await TrustedReaderIngress.admit({
      ...operation,
      headers: new Headers(),
      peer: {},
      maxBytes: 1024,
      direct: {
        authenticate: () => {
          throw new Error("secret");
        },
      },
    }).then(
      () => undefined,
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).message).not.toContain("secret");
    expect((error as ConnectError).code).toBe(Code.Internal);
  });

  it("keeps explicit cancellation distinct from bad credentials", async () => {
    await expect(
      TrustedReaderIngress.admit({
        ...operation,
        headers: new Headers(),
        peer: {},
        maxBytes: 1024,
        direct: {
          authenticate: () => {
            throw new ConnectError("private cancellation", Code.Canceled);
          },
        },
      }),
    ).rejects.toMatchObject({ code: Code.Canceled });
  });
});
