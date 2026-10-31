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

import { describe, expect, it } from "vitest";
import { ReaderForwarding } from "../../src/spi/reader-forwarding.js";
import { snapshotTrustedReader, type TrustedReaderContext } from "../../src/spi/trusted-reader.js";

describe("verified reader forwarding", () => {
  const value = new Uint8Array([1, 2, 3]);
  const reader = {
    principal: { id: "reader-1", attributes: { department: "support" } },
    authorityFacts: { permission: "projects.read" },
  };
  const issuer = { issue: (bytes: Uint8Array) => Array.from(bytes).join("-") };
  const verifier = {
    verify: (bytes: Uint8Array, proof: string, peer: string) =>
      peer === "gateway" && proof === Array.from(bytes).join("-"),
  };

  it("rejects malformed null authority facts returned by a port", () => {
    const malformed = {
      principal: { id: "reader-1" },
      authorityFacts: null,
    } as unknown as TrustedReaderContext;
    expect(() => snapshotTrustedReader(malformed)).toThrow(
      "Authority facts must be a JSON object.",
    );
  });

  it("binds verified facts to service, method and canonical bytes", async () => {
    const headers = await ReaderForwarding.seal(
      "QueryService",
      "Read",
      value,
      reader,
      issuer,
      1024,
    );
    expect(
      await ReaderForwarding.open(
        headers,
        "QueryService",
        "Read",
        value,
        verifier,
        "gateway",
        1024,
      ),
    ).toEqual(reader);
    await expect(
      ReaderForwarding.open(headers, "QueryService", "Execute", value, verifier, "gateway", 1024),
    ).rejects.toThrow("forwarding proof");
    await expect(
      ReaderForwarding.open(
        headers,
        "QueryService",
        "Read",
        new Uint8Array([1, 2, 4]),
        verifier,
        "gateway",
        1024,
      ),
    ).rejects.toThrow("forwarding proof");
    await expect(
      ReaderForwarding.open(headers, "QueryService", "Read", value, verifier, "stranger", 1024),
    ).rejects.toThrow("forwarding proof");
  });

  it("rejects asserted identity without a configured peer verifier and limits the envelope", async () => {
    const headers = await ReaderForwarding.seal(
      "QueryService",
      "Read",
      value,
      reader,
      issuer,
      1024,
    );
    await expect(
      ReaderForwarding.open(headers, "QueryService", "Read", value, undefined, "gateway", 1024),
    ).rejects.toThrow("forwarding proof");
    await expect(
      ReaderForwarding.open(headers, "QueryService", "Read", value, verifier, "gateway", 4),
    ).rejects.toThrow("reader envelope");
  });

  it("rejects a null assertion envelope as malformed proof", async () => {
    await expect(
      ReaderForwarding.open(
        {
          "spine-internal-reader": "bnVsbA==",
          "spine-internal-reader-proof": "forged",
        },
        "QueryService",
        "Read",
        value,
        verifier,
        "gateway",
        1024,
      ),
    ).rejects.toThrow("Invalid forwarding proof.");
  });

  it("detaches authority data and carries no credential through the envelope", async () => {
    const headers = await ReaderForwarding.seal(
      "QueryService",
      "Read",
      value,
      { ...reader, credential: "do-not-forward" } as typeof reader,
      issuer,
      1024,
    );
    reader.authorityFacts.permission = "changed";
    const restored = await ReaderForwarding.open(
      headers,
      "QueryService",
      "Read",
      value,
      verifier,
      "gateway",
      1024,
    );
    expect(restored.authorityFacts).toEqual({ permission: "projects.read" });
    expect(restored).not.toHaveProperty("credential");
  });

  it("round-trips detached nested, array and boolean authority facts", async () => {
    const facts = { grant: { roles: ["editor", "viewer"], approved: true } };
    const headers = await ReaderForwarding.seal(
      "QueryService",
      "Read",
      value,
      { principal: { id: "reader-2" }, authorityFacts: facts },
      issuer,
      1024,
    );
    facts.grant.roles[0] = "changed";
    const restored = await ReaderForwarding.open(
      headers,
      "QueryService",
      "Read",
      value,
      verifier,
      "gateway",
      1024,
    );
    expect(restored.authorityFacts).toEqual({
      grant: {
        roles: ["editor", "viewer"],
        approved: true,
      },
    });
    expect(Object.isFrozen((restored.authorityFacts as { grant: object }).grant)).toBe(true);
  });
});
