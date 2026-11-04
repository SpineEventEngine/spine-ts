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

import { createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SignedSessions } from "../../src/index.js";

interface GoldenFixture {
  readonly privateKeyPkcs8Pem: string;
  readonly publicKeySpkiPem: string;
  readonly options: {
    readonly issuer: string;
    readonly audience: string;
    readonly kid: string;
    readonly clockMilliseconds: number;
    readonly ttlSeconds: number;
    readonly clockSkewSeconds: number;
    readonly maxTokenCharacters: number;
  };
  readonly goldenTokens: readonly {
    readonly token: string;
    readonly principal: {
      readonly id: string;
      readonly attributes?: Readonly<Record<string, string>>;
    };
    readonly header: Record<string, unknown>;
    readonly claims: Record<string, unknown>;
  }[];
}

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/signed-golden.json", import.meta.url), "utf8"),
) as GoldenFixture;

function sessions() {
  return new SignedSessions({
    issuer: fixture.options.issuer,
    audience: fixture.options.audience,
    activeKey: {
      kid: fixture.options.kid,
      privateKey: createPrivateKey(fixture.privateKeyPkcs8Pem),
    },
    clock: { now: () => fixture.options.clockMilliseconds },
    ttlSeconds: fixture.options.ttlSeconds,
    clockSkewSeconds: fixture.options.clockSkewSeconds,
    maxTokenCharacters: fixture.options.maxTokenCharacters,
    randomBytes: (() => {
      let next = 0x11;
      return () => new Uint8Array(16).fill(next === 0x11 ? next++ : 0x22);
    })(),
  });
}

describe("signed-session golden tokens", () => {
  it("resolves both tokens issued by the preserved pre-jose class", async () => {
    const verifier = new SignedSessions({
      issuer: fixture.options.issuer,
      audience: fixture.options.audience,
      activeKey: {
        kid: fixture.options.kid,
        privateKey: createPrivateKey(fixture.privateKeyPkcs8Pem),
      },
      clock: { now: () => fixture.options.clockMilliseconds },
      ttlSeconds: fixture.options.ttlSeconds,
      clockSkewSeconds: fixture.options.clockSkewSeconds,
      maxTokenCharacters: fixture.options.maxTokenCharacters,
    });
    expect(createPublicKey(fixture.publicKeySpkiPem).asymmetricKeyDetails?.namedCurve).toBe(
      "prime256v1",
    );
    for (const old of fixture.goldenTokens)
      await expect(verifier.resolve({ kind: "bearer", value: old.token })).resolves.toMatchObject({
        principal: old.principal,
        expiresAt: { seconds: 1_700_003_600n, nanos: 0 },
      });
    await verifier.close();
  });

  it("issues the exact preserved header and claim schema for both attribute presences", async () => {
    const issuer = sessions();
    for (const old of fixture.goldenTokens) {
      const result = await issuer.issue(old.principal);
      if (result.kind !== "issued") throw new Error("expected issued token");
      const [header, payload] = result.credential.value.split(".");
      if (header === undefined || payload === undefined) throw new Error("expected JWT");
      expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual(old.header);
      expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toEqual(old.claims);
      await expect(issuer.resolve(result.credential)).resolves.toMatchObject({
        principal: old.principal,
        expiresAt: { seconds: 1_700_003_600n, nanos: 0 },
      });
    }
    await issuer.close();
  });
});
