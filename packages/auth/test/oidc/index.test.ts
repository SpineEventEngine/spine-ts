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

import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { OidcLoginTransactionSchema } from "@spine-event-engine/proto/auth";

import {
  MemoryOpaqueSessionStore,
  OidcFlow,
  OpaqueSessions,
  type ExternalIdentity,
  type OidcFlowCallbackInput,
} from "../../src/index.js";
import { MemoryOidcFlowStore } from "../../src/oidc/flow-store.js";
import { OidcFlowKeys } from "../../src/oidc/records.js";

function clock(start = 1_000) {
  let value = start;
  return { now: () => value, advance: (milliseconds: number) => (value += milliseconds) };
}

function random(...values: number[]) {
  return () => new Uint8Array(32).fill(values.shift() ?? 0);
}

const endpoint = "https://issuer.example/authorize";
const callbackUri = "https://app.example/auth/callback";
const landing = "https://app.example/chat";

function flow(options: Record<string, unknown> = {}) {
  return new OidcFlow({
    authorizationEndpoint: endpoint,
    callbackUri,
    clientId: "chat-web",
    scopes: ["openid", "profile"],
    allowedPostLoginRedirects: [landing],
    provider: {
      issuer: "https://issuer.example",
      exchangeAuthorizationCode: () => Promise.resolve(undefined),
    },
    identityMapping: { resolve: () => Promise.resolve(undefined) },
    sessionIssuer: { issue: () => Promise.resolve(undefined) },
    ...options,
  });
}

function stateOf(authorizationUrl: string) {
  const state = new URL(authorizationUrl).searchParams.get("state");
  if (state === null) throw new Error("expected state");
  return state;
}

describe("OidcFlow start", () => {
  it("reports a default memory-store close failure and keeps close settled", async () => {
    const failure = new Error("memory close failed");
    const close = vi.spyOn(MemoryOidcFlowStore.prototype, "close").mockRejectedValueOnce(failure);
    try {
      const oidc = flow();
      await expect(oidc.close()).rejects.toBe(failure);
      await expect(oidc.close()).rejects.toBe(failure);
    } finally {
      close.mockRestore();
    }
  });

  it("rejects memory-only capacity settings with an injected flow store", async () => {
    const store = new MemoryOidcFlowStore(
      "configured",
      () => create(TimestampSchema, { seconds: 2n }),
      10,
      10,
    );
    expect(() => flow({ store, maxTransactions: 1 })).toThrow("Memory-only");
    expect(() => flow({ store, maxGrants: 1 })).toThrow("Memory-only");
    await store.close();
  });

  it("rejects an injected store without a usable flow identity", () => {
    const store = new MemoryOidcFlowStore(
      "configured",
      () => create(TimestampSchema, { seconds: 2n }),
      10,
      10,
    );
    Object.defineProperty(store, "flowId", { value: " " });
    expect(() => flow({ store })).toThrow("flow identity");
  });

  it("rejects a pre-aborted request with its exact reason and leaves the flow usable", async () => {
    const oidc = flow({ randomBytes: random(1, 2, 3) });
    const controller = new AbortController();
    const reason = new Error("request cancelled");
    controller.abort(reason);
    await expect(
      oidc.start(
        { browserCodeChallenge: "a".repeat(43), postLoginRedirect: landing },
        controller.signal,
      ),
    ).rejects.toBe(reason);
    expect(
      (await oidc.start({ browserCodeChallenge: "a".repeat(43), postLoginRedirect: landing })).kind,
    ).toBe("started");
    await oidc.close();
  });

  it("does not return a URL if the trusted clock fails during start", async () => {
    let reads = 0;
    const oidc = flow({
      clock: { now: () => (++reads === 1 ? 1_000 : Number.NaN) },
      randomBytes: random(1, 2, 3),
    });
    await expect(
      oidc.start({ browserCodeChallenge: "a".repeat(43), postLoginRedirect: landing }),
    ).resolves.toEqual({ kind: "rejected", reason: "closed" });
    expect(reads).toBe(2);
    await oidc.close();
  });

  it("replaces duplicate reserved authorization parameters and retains static provider query", async () => {
    const oidc = flow({
      authorizationEndpoint: [
        "https://issuer.example/authorize?prompt=login&state=old&state=older",
        "&nonce=old&client_id=bad&redirect_uri=https%3A%2F%2Fwrong.example",
        "&response_type=token&scope=bad&code_challenge=bad&code_challenge_method=plain",
      ].join(""),
      randomBytes: random(1, 2, 3),
    });
    const started = await oidc.start({
      browserCodeChallenge: "a".repeat(43),
      postLoginRedirect: landing,
    });
    if (started.kind !== "started") throw new Error("expected OIDC start");
    const query = new URL(started.authorizationUrl).searchParams;
    expect(query.get("prompt")).toBe("login");
    for (const key of [
      "state",
      "nonce",
      "client_id",
      "redirect_uri",
      "response_type",
      "scope",
      "code_challenge",
      "code_challenge_method",
    ])
      expect(query.getAll(key)).toHaveLength(1);
    expect(query.get("response_type")).toBe("code");
    expect(query.get("redirect_uri")).toBe(callbackUri);
    expect(query.get("state")).not.toBe("old");
  });

  it("waits for transaction persistence before exposing an authorization URL", async () => {
    const store = new MemoryOidcFlowStore(
      "employee-login",
      () => create(TimestampSchema, { seconds: 2n }),
      1_000,
      1_000,
    );
    let release!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    const insert = store.insertTransaction.bind(store);
    store.insertTransaction = async (record) => {
      await pending;
      return insert(record);
    };
    const oidc = flow({ store, randomBytes: random(1, 2, 3) });
    let settled = false;
    const starting = oidc.start({
      browserCodeChallenge: "a".repeat(43),
      postLoginRedirect: landing,
    });
    void starting.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    expect((await starting).kind).toBe("started");
    await store.close();
  });

  it("surfaces a known failed transaction insert without returning a browser URL", async () => {
    const store = new MemoryOidcFlowStore(
      "failed-start",
      () => create(TimestampSchema, { seconds: 2n }),
      10,
      10,
    );
    store.insertTransaction = () => Promise.reject(new Error("transaction write failed"));
    const oidc = flow({ store, randomBytes: random(1, 2, 3) });
    await expect(
      oidc.start({ browserCodeChallenge: "a".repeat(43), postLoginRedirect: landing }),
    ).rejects.toThrow("transaction write failed");
    await oidc.close();
    await store.close();
  });

  it("retries a confirmed absent-slot collision before returning a persisted URL", async () => {
    const store = new MemoryOidcFlowStore(
      "collision-start",
      () => create(TimestampSchema, { seconds: 2n }),
      10,
      10,
    );
    const insert = store.insertTransaction.bind(store);
    let attempts = 0;
    store.insertTransaction = (record) => {
      attempts += 1;
      return attempts === 1 ? Promise.resolve(false) : insert(record);
    };
    const oidc = flow({ store, randomBytes: random(1, 2, 3, 4, 5, 6) });
    const started = await oidc.start({
      browserCodeChallenge: "a".repeat(43),
      postLoginRedirect: landing,
    });
    expect(started.kind).toBe("started");
    expect(attempts).toBe(2);
    if (started.kind !== "started") throw new Error("expected start");
    const state = stateOf(started.authorizationUrl);
    expect(await store.readTransaction(OidcFlowKeys.digest(store.flowId, state))).toBeDefined();
    await oidc.close();
    await store.close();
  });

  it("drains and conditionally removes a confirmed late insert after close", async () => {
    const store = new MemoryOidcFlowStore(
      "closing-start",
      () => create(TimestampSchema, { seconds: 2n }),
      10,
      10,
    );
    const insert = store.insertTransaction.bind(store);
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let digest = "";
    store.insertTransaction = async (record) => {
      digest = record.lookupDigest;
      entered();
      await pending;
      return insert(record);
    };
    const oidc = flow({ store, randomBytes: random(1, 2, 3) });
    const started = oidc.start({
      browserCodeChallenge: "a".repeat(43),
      postLoginRedirect: landing,
    });
    await waiting;
    let closed = false;
    const closing = oidc.close().then(() => {
      closed = true;
    });
    expect(closed).toBe(false);
    release();
    await expect(started).resolves.toEqual({ kind: "rejected", reason: "closed" });
    await closing;
    expect(await store.readTransaction(digest)).toBeUndefined();
    await store.close();
  });

  it("conditionally removes a confirmed insert after request abort", async () => {
    const store = new MemoryOidcFlowStore(
      "aborting-start",
      () => create(TimestampSchema, { seconds: 2n }),
      10,
      10,
    );
    const insert = store.insertTransaction.bind(store);
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let digest = "";
    store.insertTransaction = async (record) => {
      digest = record.lookupDigest;
      entered();
      await pending;
      return insert(record);
    };
    const oidc = flow({ store, randomBytes: random(1, 2, 3) });
    const controller = new AbortController();
    const reason = new Error("request cancelled");
    const starting = oidc.start(
      { browserCodeChallenge: "a".repeat(43), postLoginRedirect: landing },
      controller.signal,
    );
    await waiting;
    controller.abort(reason);
    release();
    await expect(starting).rejects.toBe(reason);
    expect(await store.readTransaction(digest)).toBeUndefined();
    await oidc.close();
    await store.close();
  });

  it("preserves cancellation and a failed confirmed-write compensation", async () => {
    const store = new MemoryOidcFlowStore(
      "failed-compensation",
      () => create(TimestampSchema, { seconds: 2n }),
      10,
      10,
    );
    const insert = store.insertTransaction.bind(store);
    const controller = new AbortController();
    const reason = new Error("request cancelled");
    const failure = new Error("conditional removal failed");
    let digest = "";
    store.insertTransaction = async (record) => {
      digest = record.lookupDigest;
      const inserted = await insert(record);
      controller.abort(reason);
      return inserted;
    };
    store.consumeTransaction = () => Promise.reject(failure);
    const oidc = flow({ store, randomBytes: random(1, 2, 3) });
    const starting = oidc.start(
      { browserCodeChallenge: "a".repeat(43), postLoginRedirect: landing },
      controller.signal,
    );
    await expect(starting).rejects.toMatchObject({ errors: [reason, failure] });
    expect(await store.readTransaction(digest)).toBeDefined();
    await oidc.close();
    await store.close();
  });

  it("preserves a concurrent replacement when confirmed-insert compensation finds no match", async () => {
    const store = new MemoryOidcFlowStore(
      "replacement-start",
      () => create(TimestampSchema, { seconds: 2n }),
      10,
      10,
    );
    const insert = store.insertTransaction.bind(store);
    const consume = store.consumeTransaction.bind(store);
    const controller = new AbortController();
    const reason = new Error("request cancelled");
    let replacementDigest = "";
    store.insertTransaction = async (record) => {
      replacementDigest = record.lookupDigest;
      const inserted = await insert(record);
      expect(await consume(record)).toBe(true);
      expect(
        await insert(create(OidcLoginTransactionSchema, { ...record, nonce: "replacement" })),
      ).toBe(true);
      controller.abort(reason);
      return inserted;
    };
    const oidc = flow({ store, randomBytes: random(1, 2, 3) });
    await expect(
      oidc.start(
        { browserCodeChallenge: "a".repeat(43), postLoginRedirect: landing },
        controller.signal,
      ),
    ).rejects.toBe(reason);
    expect((await store.readTransaction(replacementDigest))?.nonce).toBe("replacement");
    await oidc.close();
    await store.close();
  });

  it("retains close and conditional-removal failures after a confirmed insert", async () => {
    const store = new MemoryOidcFlowStore(
      "closing-compensation",
      () => create(TimestampSchema, { seconds: 2n }),
      10,
      10,
    );
    const insert = store.insertTransaction.bind(store);
    const failure = new Error("conditional removal failed");
    const oidc = flow({ store, randomBytes: random(1, 2, 3) });
    store.insertTransaction = async (record) => {
      const inserted = await insert(record);
      void oidc.close();
      return inserted;
    };
    store.consumeTransaction = () => Promise.reject(failure);
    await expect(
      oidc.start({ browserCodeChallenge: "a".repeat(43), postLoginRedirect: landing }),
    ).rejects.toMatchObject({
      errors: [expect.objectContaining({ message: "OIDC flow closed." }), failure],
    });
    await oidc.close();
    await store.close();
  });

  it("does not blindly remove an insert whose storage outcome is unknown", async () => {
    const store = new MemoryOidcFlowStore(
      "ambiguous-start",
      () => create(TimestampSchema, { seconds: 2n }),
      10,
      10,
    );
    const insert = store.insertTransaction.bind(store);
    const controller = new AbortController();
    const reason = new Error("request cancelled");
    const failure = new Error("storage outcome unknown");
    let digest = "";
    store.insertTransaction = async (record) => {
      digest = record.lookupDigest;
      await insert(record);
      controller.abort(reason);
      throw failure;
    };
    const oidc = flow({ store, randomBytes: random(1, 2, 3) });
    await expect(
      oidc.start(
        { browserCodeChallenge: "a".repeat(43), postLoginRedirect: landing },
        controller.signal,
      ),
    ).rejects.toBe(failure);
    expect(await store.readTransaction(digest)).toBeDefined();
    await oidc.close();
    await store.close();
  });

  it("creates an exact authorization-code URL with unique random security parameters", async () => {
    const time = clock();
    const generated = [
      new Uint8Array(32).fill(1),
      new Uint8Array(32).fill(2),
      new Uint8Array(32).fill(3),
    ];
    const oidc = flow({
      clock: time,
      randomBytes: () => {
        const bytes = generated.shift();
        if (bytes === undefined) throw new Error("expected random test material");
        return bytes;
      },
    });

    const started = await oidc.start({
      browserCodeChallenge: "a".repeat(43),
      postLoginRedirect: landing,
    });

    expect(started.kind).toBe("started");
    if (started.kind !== "started") throw new Error("expected OIDC start");
    expect(started.expiresAt).toBe(301_000);
    const url = new URL(started.authorizationUrl);
    expect(url.origin + url.pathname).toBe(endpoint);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "chat-web",
      code_challenge: createHash("sha256")
        .update(Buffer.alloc(32, 3).toString("base64url"), "ascii")
        .digest("base64url"),
      code_challenge_method: "S256",
      nonce: Buffer.alloc(32, 2).toString("base64url"),
      redirect_uri: callbackUri,
      response_type: "code",
      scope: "openid profile",
      state: Buffer.alloc(32, 1).toString("base64url"),
    });
    expect(generated).toHaveLength(0);
  });

  it("rejects invalid construction and start input without retaining a transaction", async () => {
    expect(() => flow({ authorizationEndpoint: "http://issuer.example/authorize" })).toThrow();
    expect(() => flow({ callbackUri: "https://user@application.example/callback" })).toThrow();
    expect(() => flow({ scopes: ["openid", "openid"] })).toThrow();
    expect(() => flow({ scopes: ["profile"] })).toThrow();
    expect(() => flow({ allowedPostLoginRedirects: [] })).toThrow();

    const oidc = flow({ randomBytes: random(1, 2, 3) });
    expect(
      await oidc.start({ browserCodeChallenge: "invalid", postLoginRedirect: landing }),
    ).toEqual({
      kind: "rejected",
      reason: "invalid-input",
    });
    expect(
      await oidc.start({
        browserCodeChallenge: "a".repeat(43),
        postLoginRedirect: "https://app.example/other",
      }),
    ).toEqual({ kind: "rejected", reason: "invalid-input" });
  });

  it.each([
    new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error("prototype");
        },
      },
    ),
    {
      get browserCodeChallenge() {
        throw new Error("challenge");
      },
      postLoginRedirect: landing,
    },
  ])("rejects hostile start input without escaping %#", async (input) => {
    const oidc = flow({ randomBytes: random(1, 2, 3) });

    expect(await oidc.start(input as never)).toEqual({ kind: "rejected", reason: "invalid-input" });
    expect(
      await oidc.start({ browserCodeChallenge: "a".repeat(43), postLoginRedirect: landing }),
    ).toMatchObject({ kind: "started" });
  });

  it.each([
    { clientId: "" },
    { scopes: ["openid", "has space"] },
    { scopes: [] },
    { allowedPostLoginRedirects: [landing, landing] },
    { transactionTtlMilliseconds: 0 },
    { grantTtlMilliseconds: 0 },
    { maxTransactions: 0 },
    { maxGrants: 0 },
    { collisionAttempts: 0 },
    { operationTimeoutMilliseconds: 0 },
    { maxAuthorizationUrlLength: 0 },
    {
      provider: {
        issuer: "http://issuer.example",
        exchangeAuthorizationCode: () => Promise.resolve(undefined),
      },
    },
    { provider: { issuer: "https://issuer.example", exchangeAuthorizationCode: undefined } },
    { identityMapping: { resolve: undefined } },
    { sessionIssuer: { issue: undefined } },
  ])("rejects finite malformed construction option %#", (options) => {
    expect(() => flow(options)).toThrow();
  });

  it("bounds live transactions, expires them before capacity, and zeroes random buffers", async () => {
    const time = clock();
    const values = [1, 2, 3, 1, 4, 5, 6, 7, 8];
    const buffers: Uint8Array[] = [];
    const oidc = flow({
      clock: time,
      randomBytes: () => {
        const bytes = new Uint8Array(32).fill(values.shift() ?? 0);
        buffers.push(bytes);
        return bytes;
      },
      transactionTtlMilliseconds: 10,
      maxTransactions: 1,
      collisionAttempts: 2,
    });
    const input = { browserCodeChallenge: "a".repeat(43), postLoginRedirect: landing };

    expect(await oidc.start(input)).toMatchObject({ kind: "started" });
    expect(await oidc.start(input)).toEqual({ kind: "rejected", reason: "capacity-exceeded" });
    time.advance(10);
    expect(
      await oidc.purgeExpired(create(TimestampSchema, { seconds: 1n, nanos: 10_000_000 })),
    ).toEqual({ transactions: 1, grants: 0 });
    expect(await oidc.start(input)).toMatchObject({ kind: "started" });
    expect(buffers.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
  });

  it("retries colliding state material before committing a transaction", async () => {
    const oidc = flow({
      randomBytes: random(1, 2, 3, 1, 4, 5, 6, 7, 8),
      maxTransactions: 2,
      collisionAttempts: 2,
    });
    const input = { browserCodeChallenge: "a".repeat(43), postLoginRedirect: landing };

    expect(await oidc.start(input)).toMatchObject({ kind: "started" });
    expect(await oidc.start(input)).toMatchObject({ kind: "started" });
  });

  it("keeps state, nonce, and provider PKCE challenge distinct across live starts", async () => {
    const oidc = flow({ randomBytes: random(1, 2, 3, 4, 5, 6), maxTransactions: 2 });
    const input = { browserCodeChallenge: "a".repeat(43), postLoginRedirect: landing };
    const first = await oidc.start(input);
    const second = await oidc.start(input);
    if (first.kind !== "started" || second.kind !== "started") throw new Error("expected starts");
    const a = new URL(first.authorizationUrl).searchParams;
    const b = new URL(second.authorizationUrl).searchParams;
    expect(a.get("state")).not.toBe(b.get("state"));
    expect(a.get("nonce")).not.toBe(b.get("nonce"));
    expect(a.get("code_challenge")).not.toBe(b.get("code_challenge"));
  });

  it("retries repeated active nonce or provider verifier material before committing", async () => {
    const oidc = flow({
      randomBytes: random(1, 2, 3, 4, 2, 3, 5, 6, 7),
      maxTransactions: 2,
      collisionAttempts: 2,
    });
    const input = { browserCodeChallenge: "a".repeat(43), postLoginRedirect: landing };
    const first = await oidc.start(input);
    const second = await oidc.start(input);
    expect(first.kind).toBe("started");
    expect(second.kind).toBe("started");
    if (first.kind !== "started" || second.kind !== "started") return;
    expect(new URL(first.authorizationUrl).searchParams.get("nonce")).not.toBe(
      new URL(second.authorizationUrl).searchParams.get("nonce"),
    );
  });

  it.each([
    ["nonce", [1, 2, 3, 4, 2, 5, 6, 7, 8]],
    ["verifier", [1, 2, 3, 4, 5, 3, 6, 7, 8]],
  ] as const)("retries active %s reuse with fresh successful material", async (_kind, values) => {
    const oidc = flow({ randomBytes: random(...values), maxTransactions: 2, collisionAttempts: 2 });
    const input = { browserCodeChallenge: "a".repeat(43), postLoginRedirect: landing };
    const first = await oidc.start(input);
    const second = await oidc.start(input);
    if (first.kind !== "started" || second.kind !== "started") throw new Error("expected starts");
    const firstUrl = new URL(first.authorizationUrl).searchParams;
    const secondUrl = new URL(second.authorizationUrl).searchParams;
    if (_kind === "nonce") expect(firstUrl.get("nonce")).not.toBe(secondUrl.get("nonce"));
    else expect(firstUrl.get("code_challenge")).not.toBe(secondUrl.get("code_challenge"));
  });

  it("fails safely when entropy cannot create a valid unique transaction and after terminal close", async () => {
    const short = new Uint8Array(31).fill(9);
    const oidc = flow({ randomBytes: () => short, collisionAttempts: 2 });
    const input = { browserCodeChallenge: "a".repeat(43), postLoginRedirect: landing };
    expect(await oidc.start(input)).toEqual({ kind: "rejected", reason: "entropy-exhausted" });
    expect(short).toEqual(new Uint8Array(31));
    void oidc.close();
    void oidc.close();
    expect(await oidc.start(input)).toEqual({ kind: "rejected", reason: "closed" });
  });

  it.each([
    { name: "nonce", badAt: 2 },
    { name: "verifier", badAt: 3 },
  ])("rejects wrong-length $name random material", async ({ badAt }) => {
    let calls = 0;
    const oidc = flow({
      collisionAttempts: 1,
      randomBytes: () => {
        calls += 1;
        return new Uint8Array(calls === badAt ? 31 : 32).fill(1);
      },
    });
    expect(
      await oidc.start({ browserCodeChallenge: "a".repeat(43), postLoginRedirect: landing }),
    ).toEqual({ kind: "rejected", reason: "entropy-exhausted" });
  });

  it("rejects an authorization URL beyond its finite configured bound", async () => {
    const oidc = flow({ randomBytes: random(1, 2, 3), maxAuthorizationUrlLength: 1 });
    expect(
      await oidc.start({ browserCodeChallenge: "a".repeat(43), postLoginRedirect: landing }),
    ).toEqual({ kind: "rejected", reason: "invalid-input" });
  });

  it.each(["valid", "invalid", "throw"] as const)(
    "lets terminal close win re-entrant %s clock and random callbacks",
    async (outcome) => {
      const closeThen = () => {
        void oidc.close();
        if (outcome === "throw") throw new Error("entropy");
        return outcome === "valid" ? 1_000 : Number.NaN;
      };
      const oidc = flow({ clock: { now: closeThen }, randomBytes: random(1, 2, 3) });
      expect(
        await oidc.start({ browserCodeChallenge: "a".repeat(43), postLoginRedirect: landing }),
      ).toEqual({ kind: "rejected", reason: "closed" });

      const randomClosing = flow({
        randomBytes: () => {
          void randomClosing.close();
          if (outcome === "throw") throw new Error("entropy");
          return new Uint8Array(outcome === "valid" ? 32 : 31);
        },
      });
      expect(
        await randomClosing.start({
          browserCodeChallenge: "a".repeat(43),
          postLoginRedirect: landing,
        }),
      ).toEqual({ kind: "rejected", reason: "closed" });
    },
  );
});

describe("OidcFlow callback", () => {
  async function startedFlow(options: Record<string, unknown> = {}) {
    const oidc = flow({ randomBytes: random(1, 2, 3, 4), ...options });
    const started = await oidc.start({
      browserCodeChallenge: "a".repeat(43),
      postLoginRedirect: landing,
    });
    if (started.kind !== "started") throw new Error("expected start");
    const state = new URL(started.authorizationUrl).searchParams.get("state");
    if (state === null) throw new Error("expected state");
    return { oidc, state };
  }

  it("rejects a transaction whose persisted provider binding changed before callback", async () => {
    const store = new MemoryOidcFlowStore(
      "bound-callback",
      () => create(TimestampSchema, { seconds: 2n }),
      10,
      10,
    );
    let providerCalls = 0;
    const { oidc, state } = await startedFlow({
      store,
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: () => {
          providerCalls += 1;
          return Promise.resolve(undefined);
        },
      },
    });
    const digest = OidcFlowKeys.digest(store.flowId, state);
    const original = await store.readTransaction(digest);
    if (original === undefined) throw new Error("expected transaction");
    expect(await store.consumeTransaction(original)).toBe(true);
    const changed = create(OidcLoginTransactionSchema, { ...original, clientId: "different-app" });
    expect(await store.insertTransaction(changed)).toBe(true);
    await expect(oidc.callback({ state, code: "code" })).resolves.toEqual({
      kind: "rejected",
      reason: "issuer-mismatch",
    });
    expect(providerCalls).toBe(0);
    expect(await store.readTransaction(digest)).toEqual(changed);
    await oidc.close();
    await store.close();
  });

  it("reports a confirmed grant-slot collision after consuming the validated transaction", async () => {
    const store = new MemoryOidcFlowStore(
      "grant-collision",
      () => create(TimestampSchema, { seconds: 2n }),
      10,
      10,
    );
    store.insertGrant = () => Promise.resolve(false);
    const { oidc, state } = await startedFlow({
      store,
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: () =>
          Promise.resolve({ issuer: "https://issuer.example", subject: "person" }),
      },
      identityMapping: {
        resolve: (externalIdentity: ExternalIdentity) =>
          Promise.resolve({ externalIdentity, principal: { id: "person" } }),
      },
    });
    await expect(oidc.callback({ state, code: "code" })).resolves.toEqual({
      kind: "rejected",
      reason: "entropy-exhausted",
    });
    expect(await store.readTransaction(OidcFlowKeys.digest(store.flowId, state))).toBeUndefined();
    await oidc.close();
    await store.close();
  });

  it.each(["expiry", "close"] as const)(
    "does not consume a transaction after delayed read reaches %s",
    async (outcome) => {
      const time = clock();
      const store = new MemoryOidcFlowStore(
        "delayed-callback",
        () => create(TimestampSchema, { seconds: 2n }),
        10,
        10,
      );
      const read = store.readTransaction.bind(store);
      const consume = store.consumeTransaction.bind(store);
      let release!: () => void;
      let entered!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      const waiting = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let consumes = 0;
      let providerCalls = 0;
      const started = await startedFlow({
        store,
        clock: time,
        transactionTtlMilliseconds: 10,
        provider: {
          issuer: "https://issuer.example",
          exchangeAuthorizationCode: () => {
            providerCalls += 1;
            return Promise.resolve(undefined);
          },
        },
      });
      store.readTransaction = async (digest) => {
        entered();
        await pending;
        return read(digest);
      };
      store.consumeTransaction = (record) => {
        consumes += 1;
        return consume(record);
      };
      const callback = started.oidc.callback({ state: started.state, code: "code" });
      await waiting;
      const closing = outcome === "close" ? started.oidc.close() : undefined;
      if (outcome === "expiry") time.advance(10);
      release();
      await expect(callback).resolves.toEqual({
        kind: "rejected",
        reason: outcome === "close" ? "closed" : "expired",
      });
      await closing;
      expect(consumes).toBe(0);
      expect(providerCalls).toBe(0);
      await store.close();
    },
  );

  it.each(["expiry", "clock-failure"] as const)(
    "does not exchange a provider code after consumption reaches %s",
    async (outcome) => {
      const time = clock();
      let clockFailed = false;
      const store = new MemoryOidcFlowStore(
        "consumed-expiry",
        () => create(TimestampSchema, { seconds: 2n }),
        10,
        10,
      );
      const consume = store.consumeTransaction.bind(store);
      let entered!: () => void;
      let release!: () => void;
      const waiting = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      let providerCalls = 0;
      const started = await startedFlow({
        store,
        clock: { now: () => (clockFailed ? Number.NaN : time.now()) },
        transactionTtlMilliseconds: 10,
        provider: {
          issuer: "https://issuer.example",
          exchangeAuthorizationCode: () => {
            providerCalls += 1;
            return Promise.resolve(undefined);
          },
        },
      });
      store.consumeTransaction = async (record) => {
        entered();
        await pending;
        return consume(record);
      };
      const callback = started.oidc.callback({ state: started.state, code: "code" });
      await waiting;
      if (outcome === "expiry") time.advance(10);
      else clockFailed = true;
      release();
      await expect(callback).resolves.toEqual({
        kind: "rejected",
        reason: outcome === "expiry" ? "expired" : "closed",
      });
      expect(providerCalls).toBe(0);
      expect(
        await store.readTransaction(OidcFlowKeys.digest(store.flowId, started.state)),
      ).toBeUndefined();
      await started.oidc.close();
      await store.close();
    },
  );

  it.each(["read", "consume"] as const)(
    "aborts a delayed transaction %s without provider exchange",
    async (stage) => {
      const store = new MemoryOidcFlowStore(
        "aborting-callback",
        () => create(TimestampSchema, { seconds: 2n }),
        10,
        10,
      );
      const read = store.readTransaction.bind(store);
      const consume = store.consumeTransaction.bind(store);
      let entered!: () => void;
      let release!: () => void;
      const waiting = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      let providerCalls = 0;
      const started = await startedFlow({
        store,
        provider: {
          issuer: "https://issuer.example",
          exchangeAuthorizationCode: () => {
            providerCalls += 1;
            return Promise.resolve(undefined);
          },
        },
      });
      if (stage === "read")
        store.readTransaction = async (digest) => {
          entered();
          await pending;
          return read(digest);
        };
      else
        store.consumeTransaction = async (record) => {
          entered();
          await pending;
          return consume(record);
        };
      const controller = new AbortController();
      const reason = new Error("request cancelled");
      const callback = started.oidc.callback(
        { state: started.state, code: "code" },
        controller.signal,
      );
      await waiting;
      controller.abort(reason);
      release();
      await expect(callback).rejects.toBe(reason);
      expect(providerCalls).toBe(0);
      const digest = OidcFlowKeys.digest(store.flowId, started.state);
      if (stage === "read") expect(await read(digest)).toBeDefined();
      else expect(await read(digest)).toBeUndefined();
      await started.oidc.close();
      await store.close();
    },
  );

  it.each(["read", "consume"] as const)(
    "surfaces a failed transaction %s before provider exchange",
    async (stage) => {
      const store = new MemoryOidcFlowStore(
        "failing-callback",
        () => create(TimestampSchema, { seconds: 2n }),
        10,
        10,
      );
      let exchanged = 0;
      const started = await startedFlow({
        store,
        provider: {
          issuer: "https://issuer.example",
          exchangeAuthorizationCode: () => {
            exchanged += 1;
            return Promise.resolve(undefined);
          },
        },
      });
      if (stage === "read") store.readTransaction = () => Promise.reject(new Error("read failed"));
      else store.consumeTransaction = () => Promise.reject(new Error("consume failed"));
      await expect(
        started.oidc.callback({ state: started.state, code: "provider-code" }),
      ).rejects.toThrow(`${stage} failed`);
      expect(exchanged).toBe(0);
      await started.oidc.close();
      await store.close();
    },
  );

  it("closes over a late confirmed grant insert and removes that grant", async () => {
    const store = new MemoryOidcFlowStore(
      "closing-grant",
      () => create(TimestampSchema, { seconds: 2n }),
      10,
      10,
    );
    const insert = store.insertGrant.bind(store);
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let digest = "";
    store.insertGrant = async (record) => {
      digest = record.lookupDigest;
      entered();
      await pending;
      return insert(record);
    };
    const started = await startedFlow({
      store,
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: () =>
          Promise.resolve({ issuer: "https://issuer.example", subject: "person" }),
      },
      identityMapping: {
        resolve: (externalIdentity: unknown) =>
          Promise.resolve({ externalIdentity, principal: { id: "person" } }),
      },
    });
    const callback = started.oidc.callback({ state: started.state, code: "code" });
    await waiting;
    const closing = started.oidc.close();
    release();
    await expect(callback).resolves.toEqual({ kind: "rejected", reason: "closed" });
    await closing;
    expect(await store.readGrant(digest)).toBeUndefined();
    await store.close();
  });

  it("conditionally removes a confirmed grant insert after request abort", async () => {
    const store = new MemoryOidcFlowStore(
      "aborting-grant",
      () => create(TimestampSchema, { seconds: 2n }),
      10,
      10,
    );
    const insert = store.insertGrant.bind(store);
    let entered!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let digest = "";
    store.insertGrant = async (record) => {
      digest = record.lookupDigest;
      entered();
      await pending;
      return insert(record);
    };
    const started = await startedFlow({
      store,
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: () =>
          Promise.resolve({ issuer: "https://issuer.example", subject: "person" }),
      },
      identityMapping: {
        resolve: (externalIdentity: unknown) =>
          Promise.resolve({ externalIdentity, principal: { id: "person" } }),
      },
    });
    const controller = new AbortController();
    const reason = new Error("request cancelled");
    const callback = started.oidc.callback(
      { state: started.state, code: "code" },
      controller.signal,
    );
    await waiting;
    controller.abort(reason);
    release();
    await expect(callback).rejects.toBe(reason);
    expect(await store.readGrant(digest)).toBeUndefined();
    await started.oidc.close();
    await store.close();
  });

  it("surfaces a failed grant insert after consuming the transaction", async () => {
    const store = new MemoryOidcFlowStore(
      "failed-grant",
      () => create(TimestampSchema, { seconds: 2n }),
      10,
      10,
    );
    const failure = new Error("grant write failed");
    store.insertGrant = () => Promise.reject(failure);
    const started = await startedFlow({
      store,
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: () =>
          Promise.resolve({ issuer: "https://issuer.example", subject: "person" }),
      },
      identityMapping: {
        resolve: (externalIdentity: unknown) =>
          Promise.resolve({ externalIdentity, principal: { id: "person" } }),
      },
    });
    await expect(started.oidc.callback({ state: started.state, code: "code" })).rejects.toBe(
      failure,
    );
    await expect(started.oidc.callback({ state: started.state, code: "code" })).resolves.toEqual({
      kind: "rejected",
      reason: "not-found",
    });
    await started.oidc.close();
    await store.close();
  });

  it.each([[{ state: "bad", code: "code" }]])(
    "rejects malformed callback facts before provider work %#",
    async (input) => {
      const oidc = flow({ randomBytes: random(1, 2, 3) });
      await expect(oidc.callback(input as never)).resolves.toEqual({
        kind: "rejected",
        reason: "invalid-input",
      });
    },
  );

  it("rejects hostile callback input without escaping and keeps a consumed state burned", async () => {
    const prototypeHostile = await startedFlow();
    await expect(
      prototypeHostile.oidc.callback(
        new Proxy(
          {},
          {
            getPrototypeOf: () => {
              throw new Error("prototype");
            },
          },
        ) as never,
      ),
    ).resolves.toEqual({ kind: "rejected", reason: "invalid-input" });
    await expect(
      prototypeHostile.oidc.callback({ state: prototypeHostile.state, error: "denied" }),
    ).resolves.toEqual({ kind: "rejected", reason: "provider-error" });

    const getterHostile = await startedFlow();
    await expect(
      getterHostile.oidc.callback({
        state: getterHostile.state,
        get code() {
          throw new Error("code");
        },
      } as never),
    ).resolves.toEqual({ kind: "rejected", reason: "invalid-input" });
    await expect(
      getterHostile.oidc.callback({ state: getterHostile.state, code: "code" }),
    ).resolves.toEqual({ kind: "rejected", reason: "verification-failed" });
  });

  it("consumes state before provider work, then creates a one-time bounded grant", async () => {
    let providerCalls = 0;
    let mappingIdentity: unknown;
    const time = clock();
    const { oidc, state } = await startedFlow({
      clock: time,
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: () => {
          providerCalls += 1;
          return Promise.resolve({
            issuer: "https://issuer.example",
            subject: "subject-1",
            claims: { email: "a@b.c" },
          });
        },
      },
      identityMapping: {
        resolve: (identity: unknown) => {
          mappingIdentity = identity;
          return Promise.resolve({
            externalIdentity: identity,
            principal: { id: "principal-1", attributes: { role: "member" } },
          });
        },
      },
    });

    const callback = await oidc.callback({ state, code: "provider-code" });
    expect(callback).toMatchObject({
      kind: "granted",
      postLoginRedirect: landing,
      expiresAt: 61_000,
    });
    expect(providerCalls).toBe(1);
    expect(mappingIdentity).toEqual({
      issuer: "https://issuer.example",
      subject: "subject-1",
      claims: { email: "a@b.c" },
    });
    expect(await oidc.callback({ state, code: "provider-code" })).toEqual({
      kind: "rejected",
      reason: "not-found",
    });
    expect(providerCalls).toBe(1);
  });

  it.each([
    ["both", { code: "code", error: "error" }, {}, "invalid-input"],
    ["error", { error: "denied" }, {}, "provider-error"],
    ["issuer", { code: "code", responseIssuer: "https://other.example" }, {}, "issuer-mismatch"],
    [
      "undefined provider",
      { code: "code" },
      {
        provider: {
          issuer: "https://issuer.example",
          exchangeAuthorizationCode: (): Promise<undefined> => Promise.resolve(undefined),
        },
      },
      "verification-failed",
    ],
    [
      "throwing provider",
      { code: "code" },
      {
        provider: {
          issuer: "https://issuer.example",
          exchangeAuthorizationCode: () => {
            throw new Error("provider");
          },
        },
      },
      "verification-failed",
    ],
    [
      "undefined mapping",
      { code: "code" },
      {
        provider: {
          issuer: "https://issuer.example",
          exchangeAuthorizationCode: () =>
            Promise.resolve({
              issuer: "https://issuer.example",
              subject: "subject",
            }),
        },
        identityMapping: { resolve: (): Promise<undefined> => Promise.resolve(undefined) },
      },
      "mapping-failed",
    ],
    [
      "throwing mapping",
      { code: "code" },
      {
        provider: {
          issuer: "https://issuer.example",
          exchangeAuthorizationCode: () =>
            Promise.resolve({
              issuer: "https://issuer.example",
              subject: "subject",
            }),
        },
        identityMapping: {
          resolve: () => {
            throw new Error("mapping");
          },
        },
      },
      "mapping-failed",
    ],
  ] as const)(
    "reaches callback %s outcome with a live state",
    async (_name, facts, options, reason) => {
      const started = await startedFlow(options);
      await expect(
        started.oidc.callback({ state: started.state, ...facts } as never),
      ).resolves.toEqual({ kind: "rejected", reason });
    },
  );

  it("consumes provider errors while preserving state after malformed or mismatched callbacks", async () => {
    let providerCalls = 0;
    const provider = {
      issuer: "https://issuer.example",
      exchangeAuthorizationCode: () => {
        providerCalls += 1;
        return { issuer: "https://issuer.example", subject: "subject" };
      },
    };
    const error = await startedFlow({ provider });
    expect(await error.oidc.callback({ state: error.state, error: "access_denied" })).toEqual({
      kind: "rejected",
      reason: "provider-error",
    });
    expect(await error.oidc.callback({ state: error.state, code: "code" })).toEqual({
      kind: "rejected",
      reason: "not-found",
    });

    const malformed = await startedFlow({ provider });
    expect(
      await malformed.oidc.callback({
        state: malformed.state,
        code: "code",
        error: "bad",
      } as unknown as OidcFlowCallbackInput),
    ).toEqual({
      kind: "rejected",
      reason: "invalid-input",
    });
    expect(await malformed.oidc.callback({ state: malformed.state, code: "code" })).toEqual({
      kind: "rejected",
      reason: "mapping-failed",
    });

    const mixed = await startedFlow({ provider });
    expect(
      await mixed.oidc.callback({
        state: mixed.state,
        code: "code",
        responseIssuer: "https://other.example",
      }),
    ).toEqual({ kind: "rejected", reason: "issuer-mismatch" });
    expect(await mixed.oidc.callback({ state: mixed.state, code: "code" })).toEqual({
      kind: "rejected",
      reason: "mapping-failed",
    });

    const time = clock();
    const expired = await startedFlow({ clock: time, provider, transactionTtlMilliseconds: 1 });
    time.advance(1);
    expect(await expired.oidc.callback({ state: expired.state, code: "code" })).toEqual({
      kind: "rejected",
      reason: "expired",
    });
    expect(providerCalls).toBe(2);
  });

  it("rejects unverified or unbounded identity and mapping failures without a grant", async () => {
    const rejected = await startedFlow({
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: () => Promise.resolve(undefined),
      },
    });
    expect(await rejected.oidc.callback({ state: rejected.state, code: "code" })).toEqual({
      kind: "rejected",
      reason: "verification-failed",
    });

    const wrongIssuer = await startedFlow({
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: () =>
          Promise.resolve({
            issuer: "https://other.example",
            subject: "subject",
          }),
      },
    });
    expect(await wrongIssuer.oidc.callback({ state: wrongIssuer.state, code: "code" })).toEqual({
      kind: "rejected",
      reason: "verification-failed",
    });

    const manyClaims = Object.fromEntries(
      Array.from({ length: 33 }, (_, index) => [`claim-${String(index)}`, "x"]),
    );
    const oversized = await startedFlow({
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: () =>
          Promise.resolve({
            issuer: "https://issuer.example",
            subject: "subject",
            claims: manyClaims,
          }),
      },
    });
    expect(await oversized.oidc.callback({ state: oversized.state, code: "code" })).toEqual({
      kind: "rejected",
      reason: "verification-failed",
    });

    const mapping = await startedFlow({
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: () =>
          Promise.resolve({
            issuer: "https://issuer.example",
            subject: "subject",
          }),
      },
      identityMapping: { resolve: () => Promise.resolve(undefined) },
    });
    expect(await mapping.oidc.callback({ state: mapping.state, code: "code" })).toEqual({
      kind: "rejected",
      reason: "mapping-failed",
    });
  });

  it("aborts deadline-bound provider work and lets close win an in-flight callback", async () => {
    const deadline = await startedFlow({
      operationTimeoutMilliseconds: 1,
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: ({ signal }: { signal: AbortSignal }) =>
          new Promise((resolve) => {
            signal.addEventListener(
              "abort",
              () => {
                resolve(undefined);
              },
              { once: true },
            );
          }),
      },
    });
    await expect(deadline.oidc.callback({ state: deadline.state, code: "code" })).resolves.toEqual({
      kind: "rejected",
      reason: "verification-failed",
    });

    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const closing = await startedFlow({
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: () =>
          new Promise((resolve) => {
            entered();
            release = () => {
              resolve({ issuer: "https://issuer.example", subject: "subject" });
            };
          }),
      },
    });
    const pending = closing.oidc.callback({ state: closing.state, code: "code" });
    await waiting;
    const drained = closing.oidc.close();
    release();
    await expect(pending).resolves.toEqual({ kind: "rejected", reason: "closed" });
    await drained;
  });

  it("bounds mapping work with the configured deadline", async () => {
    let release!: () => void;
    const bounded = await startedFlow({
      operationTimeoutMilliseconds: 1,
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: () =>
          Promise.resolve({
            issuer: "https://issuer.example",
            subject: "subject",
          }),
      },
      identityMapping: {
        resolve: () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      },
    });
    await expect(bounded.oidc.callback({ state: bounded.state, code: "code" })).resolves.toEqual({
      kind: "rejected",
      reason: "mapping-failed",
    });
    release();
    await bounded.oidc.close();
  });

  it("returns closed when a callback clock closes during lookup", async () => {
    let calls = 0;
    const time = {
      now: () => {
        calls += 1;
        if (calls > 2) void oidc.close();
        return 1_000;
      },
    };
    const oidc = flow({ clock: time, randomBytes: random(1, 2, 3) });
    const started = await oidc.start({
      browserCodeChallenge: "a".repeat(43),
      postLoginRedirect: landing,
    });
    if (started.kind !== "started") throw new Error("expected start");
    await expect(
      oidc.callback({
        state: stateOf(started.authorizationUrl),
        code: "code",
      }),
    ).resolves.toEqual({ kind: "rejected", reason: "closed" });
  });

  it("rejects hostile claim records without escaping", async () => {
    for (const claims of [
      null,
      [],
      1,
      new Proxy(
        {},
        {
          ownKeys: () => {
            throw new Error("getter");
          },
        },
      ),
    ]) {
      const hostile = await startedFlow({
        provider: {
          issuer: "https://issuer.example",
          exchangeAuthorizationCode: () =>
            Promise.resolve({
              issuer: "https://issuer.example",
              subject: "subject",
              claims,
            } as never),
        },
      });
      await expect(hostile.oidc.callback({ state: hostile.state, code: "code" })).resolves.toEqual({
        kind: "rejected",
        reason: "verification-failed",
      });
    }
  });

  it("preserves an own __proto__ claim through provider verification and mapping", async () => {
    const claims = Object.create(null) as Record<string, string>;
    Object.defineProperty(claims, "__proto__", {
      value: "literal-claim",
      enumerable: true,
    });
    const preserved = await startedFlow({
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: () =>
          Promise.resolve({
            issuer: "https://issuer.example",
            subject: "subject",
            claims,
          }),
      },
      identityMapping: {
        resolve: (externalIdentity: ExternalIdentity) => {
          expect(Object.hasOwn(externalIdentity.claims ?? {}, "__proto__")).toBe(true);
          expect(externalIdentity.claims?.__proto__).toBe("literal-claim");
          return Promise.resolve({ externalIdentity, principal: { id: "principal" } });
        },
      },
    });
    await expect(
      preserved.oidc.callback({ state: preserved.state, code: "code" }),
    ).resolves.toMatchObject({ kind: "granted" });
  });

  it("rejects hostile mapping output after consuming state", async () => {
    const hostile = await startedFlow({
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: () =>
          Promise.resolve({
            issuer: "https://issuer.example",
            subject: "subject",
          }),
      },
      identityMapping: {
        resolve: () =>
          Promise.resolve(
            new Proxy(
              {},
              {
                get: () => {
                  throw new Error("getter");
                },
              },
            ) as never,
          ),
      },
    });
    await expect(hostile.oidc.callback({ state: hostile.state, code: "code" })).resolves.toEqual({
      kind: "rejected",
      reason: "mapping-failed",
    });
    await expect(hostile.oidc.callback({ state: hostile.state, code: "code" })).resolves.toEqual({
      kind: "rejected",
      reason: "not-found",
    });
  });

  it.each([
    null,
    [],
    1,
    { externalIdentity: null, principal: { id: "principal" } },
    { externalIdentity: { issuer: "https://issuer.example", subject: "subject" }, principal: null },
  ])("rejects malformed mapping boundary %#", async (output) => {
    const malformed = await startedFlow({
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: () =>
          Promise.resolve({
            issuer: "https://issuer.example",
            subject: "subject",
          }),
      },
      identityMapping: { resolve: () => Promise.resolve(output as never) },
    });
    await expect(
      malformed.oidc.callback({ state: malformed.state, code: "code" }),
    ).resolves.toEqual({ kind: "rejected", reason: "mapping-failed" });
  });

  it.each([
    {
      name: "missing external identity fields",
      output: { externalIdentity: {}, principal: { id: "principal" } },
    },
    {
      name: "empty principal ID",
      output: {
        externalIdentity: { issuer: "https://issuer.example", subject: "subject" },
        principal: { id: "" },
      },
    },
    {
      name: "array claims",
      output: {
        externalIdentity: {
          issuer: "https://issuer.example",
          subject: "subject",
          claims: [],
        },
        principal: { id: "principal" },
      },
    },
    {
      name: "too many claims",
      output: {
        externalIdentity: {
          issuer: "https://issuer.example",
          subject: "subject",
          claims: Object.fromEntries(
            Array.from({ length: 33 }, (_, index) => [`c${String(index)}`, "v"]),
          ),
        },
        principal: { id: "principal" },
      },
    },
    {
      name: "oversized claims",
      output: {
        externalIdentity: {
          issuer: "https://issuer.example",
          subject: "subject",
          claims: { claim: "x".repeat(4_092) },
        },
        principal: { id: "principal" },
      },
    },
    {
      name: "invalid claim entry",
      output: {
        externalIdentity: {
          issuer: "https://issuer.example",
          subject: "subject",
          claims: { "": "value" },
        },
        principal: { id: "principal" },
      },
    },
    {
      name: "token-like mapped claim",
      output: {
        externalIdentity: {
          issuer: "https://issuer.example",
          subject: "subject",
          claims: { refresh_token: "secret" },
        },
        principal: { id: "principal" },
      },
    },
    {
      name: "dropped verified claims",
      providerClaims: { role: "user" },
      output: {
        externalIdentity: { issuer: "https://issuer.example", subject: "subject" },
        principal: { id: "principal" },
      },
    },
    {
      name: "altered verified claims",
      providerClaims: { role: "user" },
      output: {
        externalIdentity: {
          issuer: "https://issuer.example",
          subject: "subject",
          claims: { role: "admin" },
        },
        principal: { id: "principal" },
      },
    },
    {
      name: "array attributes",
      output: {
        externalIdentity: { issuer: "https://issuer.example", subject: "subject" },
        principal: { id: "principal", attributes: [] },
      },
    },
    {
      name: "too many attributes",
      output: {
        externalIdentity: { issuer: "https://issuer.example", subject: "subject" },
        principal: {
          id: "principal",
          attributes: Object.fromEntries(
            Array.from({ length: 33 }, (_, index) => [`a${String(index)}`, "v"]),
          ),
        },
      },
    },
    {
      name: "oversized attributes",
      output: {
        externalIdentity: { issuer: "https://issuer.example", subject: "subject" },
        principal: { id: "principal", attributes: { role: "x".repeat(4_093) } },
      },
    },
    {
      name: "invalid attribute entry",
      output: {
        externalIdentity: { issuer: "https://issuer.example", subject: "subject" },
        principal: { id: "principal", attributes: { role: 1 } },
      },
    },
  ])("rejects mapped identity with $name", async ({ output, providerClaims }) => {
    const malformed = await startedFlow({
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: () =>
          Promise.resolve({
            issuer: "https://issuer.example",
            subject: "subject",
            ...(providerClaims === undefined ? {} : { claims: providerClaims }),
          }),
      },
      identityMapping: { resolve: () => Promise.resolve(output as never) },
    });
    await expect(
      malformed.oidc.callback({ state: malformed.state, code: "code" }),
    ).resolves.toEqual({ kind: "rejected", reason: "mapping-failed" });
  });

  it("snapshots each valid mapping-owned getter once", async () => {
    const reads = { external: 0, principal: 0, issuer: 0, subject: 0, id: 0 };
    const external = {
      get issuer() {
        reads.issuer += 1;
        return reads.issuer === 1 ? "https://issuer.example" : "other";
      },
      get subject() {
        reads.subject += 1;
        return reads.subject === 1 ? "subject" : "other";
      },
    };
    const principal = {
      get id() {
        reads.id += 1;
        return reads.id === 1 ? "principal" : "other";
      },
    };
    const mapped = {
      get externalIdentity() {
        reads.external += 1;
        return external;
      },
      get principal() {
        reads.principal += 1;
        return principal;
      },
    };
    const stable = await startedFlow({
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: () =>
          Promise.resolve({
            issuer: "https://issuer.example",
            subject: "subject",
          }),
      },
      identityMapping: { resolve: () => Promise.resolve(mapped as never) },
    });
    await expect(
      stable.oidc.callback({ state: stable.state, code: "code" }),
    ).resolves.toMatchObject({ kind: "granted" });
    expect(reads).toEqual({ external: 1, principal: 1, issuer: 1, subject: 1, id: 1 });
  });

  it("explicitly purges an expired grant before admitting the next bounded callback", async () => {
    const time = clock();
    const oidc = flow({
      clock: time,
      randomBytes: random(1, 2, 3, 4, 5, 6, 7, 8),
      maxGrants: 1,
      grantTtlMilliseconds: 10,
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: () =>
          Promise.resolve({
            issuer: "https://issuer.example",
            subject: "subject",
          }),
      },
      identityMapping: {
        resolve: (externalIdentity: unknown) =>
          Promise.resolve({
            externalIdentity,
            principal: { id: "principal" },
          }),
      },
    });
    const start = async () => {
      const started = await oidc.start({
        browserCodeChallenge: "a".repeat(43),
        postLoginRedirect: landing,
      });
      if (started.kind !== "started") throw new Error("expected start");
      return stateOf(started.authorizationUrl);
    };
    expect((await oidc.callback({ state: await start(), code: "one" })).kind).toBe("granted");
    await expect(oidc.callback({ state: await start(), code: "two" })).resolves.toEqual({
      kind: "rejected",
      reason: "capacity-exceeded",
    });
    time.advance(10);
    expect(
      await oidc.purgeExpired(create(TimestampSchema, { seconds: 1n, nanos: 10_000_000 })),
    ).toEqual({ transactions: 0, grants: 1 });
    expect((await oidc.callback({ state: await start(), code: "three" })).kind).toBe("granted");
  });

  it("exhausts colliding grant IDs without retaining another grant", async () => {
    const verifier = "c".repeat(43);
    const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
    const oidc = flow({
      randomBytes: random(1, 2, 3, 9, 4, 5, 6, 9, 9),
      collisionAttempts: 2,
      maxGrants: 2,
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: () =>
          Promise.resolve({
            issuer: "https://issuer.example",
            subject: "subject",
          }),
      },
      identityMapping: {
        resolve: (externalIdentity: unknown) =>
          Promise.resolve({
            externalIdentity,
            principal: { id: "principal" },
          }),
      },
      sessionIssuer: {
        issue: () =>
          Promise.resolve({
            credential: { kind: "cookie", value: "session" },
            session: { principal: { id: "principal" }, expiresAt: { seconds: 1n, nanos: 0 } },
          }),
      },
    });
    const start = async () => {
      const started = await oidc.start({
        browserCodeChallenge: challenge,
        postLoginRedirect: landing,
      });
      if (started.kind !== "started") throw new Error("expected start");
      return stateOf(started.authorizationUrl);
    };
    const first = await oidc.callback({ state: await start(), code: "one" });
    if (first.kind !== "granted") throw new Error("expected grant");
    await expect(oidc.callback({ state: await start(), code: "two" })).resolves.toEqual({
      kind: "rejected",
      reason: "entropy-exhausted",
    });
    expect(
      await oidc.exchange({ grant: first.grant, browserCodeVerifier: verifier }),
    ).toMatchObject({ kind: "issued" });
    expect(await oidc.exchange({ grant: first.grant, browserCodeVerifier: verifier })).toEqual({
      kind: "rejected",
    });
  });
});

describe("OidcFlow exchange", () => {
  const verifier = "b".repeat(43);
  const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");

  async function grantedFlow(options: Record<string, unknown> = {}) {
    const oidc = flow({
      randomBytes: random(1, 2, 3, 4),
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: () =>
          Promise.resolve({
            issuer: "https://issuer.example",
            subject: "subject",
          }),
      },
      identityMapping: {
        resolve: (externalIdentity: unknown) =>
          Promise.resolve({
            externalIdentity,
            principal: { id: "principal" },
          }),
      },
      ...options,
    });
    const started = await oidc.start({
      browserCodeChallenge: challenge,
      postLoginRedirect: landing,
    });
    if (started.kind !== "started") throw new Error("expected start");
    const callback = await oidc.callback({
      state: stateOf(started.authorizationUrl),
      code: "provider-code",
    });
    if (callback.kind !== "granted") throw new Error("expected grant");
    return { oidc, grant: callback.grant };
  }

  it("rejects an invalid pre-aborted exchange before store or issuer work", async () => {
    const store = new MemoryOidcFlowStore(
      "pre-aborted-exchange",
      () => create(TimestampSchema, { seconds: 2n }),
      10,
      10,
    );
    let reads = 0;
    let issues = 0;
    const granted = await grantedFlow({
      store,
      sessionIssuer: {
        issue: () => {
          issues += 1;
          return Promise.resolve(undefined);
        },
      },
    });
    const read = store.readGrant.bind(store);
    store.readGrant = (digest) => {
      reads += 1;
      return read(digest);
    };
    const controller = new AbortController();
    const reason = new Error("host stopped");
    controller.abort(reason);
    await expect(
      granted.oidc.exchange({ grant: "", browserCodeVerifier: "invalid" }, controller.signal),
    ).rejects.toBe(reason);
    expect(reads).toBe(0);
    expect(issues).toBe(0);
    expect(await read(OidcFlowKeys.digest(store.flowId, granted.grant))).toBeDefined();
    await granted.oidc.close();
    await store.close();
  });

  it.each(["expiry", "clock-failure"] as const)(
    "does not issue a session after grant consumption reaches %s",
    async (outcome) => {
      const time = clock();
      let clockFailed = false;
      const store = new MemoryOidcFlowStore(
        "consumed-grant-expiry",
        () => create(TimestampSchema, { seconds: 2n }),
        10,
        10,
      );
      const consume = store.consumeGrant.bind(store);
      let entered!: () => void;
      let release!: () => void;
      const waiting = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      let issues = 0;
      const granted = await grantedFlow({
        store,
        clock: { now: () => (clockFailed ? Number.NaN : time.now()) },
        grantTtlMilliseconds: 10,
        sessionIssuer: {
          issue: () => {
            issues += 1;
            return Promise.resolve(undefined);
          },
        },
      });
      store.consumeGrant = async (record) => {
        entered();
        await pending;
        return consume(record);
      };
      const exchange = granted.oidc.exchange({
        grant: granted.grant,
        browserCodeVerifier: verifier,
      });
      await waiting;
      if (outcome === "expiry") time.advance(10);
      else clockFailed = true;
      release();
      await expect(exchange).resolves.toEqual({ kind: "rejected" });
      expect(issues).toBe(0);
      expect(
        await store.readGrant(OidcFlowKeys.digest(store.flowId, granted.grant)),
      ).toBeUndefined();
      await granted.oidc.close();
      await store.close();
    },
  );

  it.each(["read", "consume"] as const)(
    "surfaces a failed grant %s before session issuance",
    async (stage) => {
      const store = new MemoryOidcFlowStore(
        "failed-exchange",
        () => create(TimestampSchema, { seconds: 2n }),
        10,
        10,
      );
      let issues = 0;
      const granted = await grantedFlow({
        store,
        sessionIssuer: {
          issue: () => {
            issues += 1;
            return Promise.resolve(undefined);
          },
        },
      });
      if (stage === "read") store.readGrant = () => Promise.reject(new Error("grant read failed"));
      else store.consumeGrant = () => Promise.reject(new Error("grant consume failed"));
      await expect(
        granted.oidc.exchange({ grant: granted.grant, browserCodeVerifier: verifier }),
      ).rejects.toThrow(`grant ${stage} failed`);
      expect(issues).toBe(0);
      await granted.oidc.close();
      await store.close();
    },
  );

  it("propagates an issuer failure while exchange is pending", async () => {
    const failure = new Error("durable issuer failed");
    const granted = await grantedFlow({ sessionIssuer: { issue: () => Promise.reject(failure) } });
    await expect(
      granted.oidc.exchange({ grant: granted.grant, browserCodeVerifier: verifier }),
    ).rejects.toBe(failure);
    await granted.oidc.close();
  });

  it("treats an undefined issuer rejection as failure while its signal is live", async () => {
    const granted = await grantedFlow({
      // The undefined rejection is the exact contract boundary under test.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      sessionIssuer: { issue: () => Promise.reject(undefined) },
    });
    let rejected = false;
    try {
      await granted.oidc.exchange({ grant: granted.grant, browserCodeVerifier: verifier });
    } catch (reason) {
      rejected = true;
      expect(reason).toBeUndefined();
    }
    expect(rejected).toBe(true);
    await granted.oidc.close();
  });

  it("treats an issuer rejection with its exact aborted reason as ordinary cancellation", async () => {
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const granted = await grantedFlow({
      sessionIssuer: {
        issue: (_principal: unknown, signal: AbortSignal) =>
          new Promise((_resolve, reject) => {
            entered();
            signal.addEventListener(
              "abort",
              () => {
                // A custom issuer may reject with the exact abort reason.
                // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
                reject(signal.reason);
              },
              { once: true },
            );
          }),
      },
    });
    const controller = new AbortController();
    const reason = new Error("request stopped");
    const exchange = granted.oidc.exchange(
      { grant: granted.grant, browserCodeVerifier: verifier },
      controller.signal,
    );
    await waiting;
    controller.abort(reason);
    await expect(exchange).rejects.toBe(reason);
    await granted.oidc.close();
  });

  it("keeps close pending for a timed-out issuer and reports its late rejection", async () => {
    let rejectIssue!: (reason: unknown) => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const granted = await grantedFlow({
      operationTimeoutMilliseconds: 5,
      sessionIssuer: {
        issue: () => {
          entered();
          return new Promise((_, reject) => {
            rejectIssue = reject;
          });
        },
      },
    });
    const exchange = granted.oidc.exchange({ grant: granted.grant, browserCodeVerifier: verifier });
    await waiting;
    await expect(exchange).resolves.toEqual({ kind: "rejected" });
    let closed = false;
    const closing = granted.oidc.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    const closedEarly = closed;
    const late = new Error("late durable issuer failure");
    rejectIssue(late);
    expect(closedEarly).toBe(false);
    await expect(closing).rejects.toBe(late);
  });

  it("retains a distinct issuer failure when rejection and host abort occur in one turn", async () => {
    let rejectIssue!: (reason: unknown) => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const granted = await grantedFlow({
      sessionIssuer: {
        issue: () => {
          entered();
          return new Promise((_, reject) => {
            rejectIssue = reject;
          });
        },
      },
    });
    const controller = new AbortController();
    const reason = new Error("host request ended");
    const failure = new Error("durable issuer failed");
    const exchange = granted.oidc.exchange(
      { grant: granted.grant, browserCodeVerifier: verifier },
      controller.signal,
    );
    await waiting;
    rejectIssue(failure);
    await Promise.resolve();
    await Promise.resolve();
    controller.abort(reason);
    await expect(exchange).rejects.toBe(reason);
    await expect(granted.oidc.close()).rejects.toBe(failure);
  });

  it("waits for real opaque issuance compensation and reports its late failure at close", async () => {
    const store = new MemoryOpaqueSessionStore();
    const insert = store.insert.bind(store);
    const failure = new Error("session compensation failed");
    let entered!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    store.insert = async (record) => {
      entered();
      await pending;
      return insert(record);
    };
    store.remove = () => Promise.reject(failure);
    const sessions = await OpaqueSessions.create({
      scope: "oidc-cancellation-test",
      store,
      password: "OIDC cancellation test password is at least 32 characters",
      clock: { now: () => Date.now() },
      ttlMilliseconds: 60_000,
    });
    const granted = await grantedFlow({
      sessionIssuer: {
        issue: async (principal: { id: string }, signal: AbortSignal) => {
          const result = await sessions.issue(principal, signal);
          return result.kind === "created"
            ? { credential: result.credential, session: result.session }
            : undefined;
        },
      },
    });
    const controller = new AbortController();
    const reason = new Error("host request cancelled");
    const exchange = granted.oidc.exchange(
      { grant: granted.grant, browserCodeVerifier: verifier },
      controller.signal,
    );
    await waiting;
    controller.abort(reason);
    await expect(exchange).rejects.toBe(reason);
    let closed = false;
    const closing = granted.oidc.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    release();
    await expect(closing).rejects.toMatchObject({ errors: [reason, failure] });
    await expect(granted.oidc.close()).rejects.toMatchObject({ errors: [reason, failure] });
    await sessions.close();
    await store.close();
  });

  it.each(["expiry", "close"] as const)(
    "does not consume a grant after delayed read reaches %s",
    async (outcome) => {
      const time = clock();
      const store = new MemoryOidcFlowStore(
        "delayed-exchange",
        () => create(TimestampSchema, { seconds: 2n }),
        10,
        10,
      );
      const read = store.readGrant.bind(store);
      const consume = store.consumeGrant.bind(store);
      let release!: () => void;
      let entered!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      const waiting = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let consumes = 0;
      let issues = 0;
      const granted = await grantedFlow({
        store,
        clock: time,
        grantTtlMilliseconds: 10,
        sessionIssuer: {
          issue: () => {
            issues += 1;
            return Promise.resolve(undefined);
          },
        },
      });
      store.readGrant = async (digest) => {
        entered();
        await pending;
        return read(digest);
      };
      store.consumeGrant = (record) => {
        consumes += 1;
        return consume(record);
      };
      const exchange = granted.oidc.exchange({
        grant: granted.grant,
        browserCodeVerifier: verifier,
      });
      await waiting;
      const closing = outcome === "close" ? granted.oidc.close() : undefined;
      if (outcome === "expiry") time.advance(10);
      release();
      await expect(exchange).resolves.toEqual({ kind: "rejected" });
      await closing;
      expect(consumes).toBe(0);
      expect(issues).toBe(0);
      await store.close();
    },
  );

  it.each(["read", "consume"] as const)(
    "aborts a delayed grant %s without session issuance",
    async (stage) => {
      const store = new MemoryOidcFlowStore(
        "aborting-exchange",
        () => create(TimestampSchema, { seconds: 2n }),
        10,
        10,
      );
      const read = store.readGrant.bind(store);
      const consume = store.consumeGrant.bind(store);
      let entered!: () => void;
      let release!: () => void;
      const waiting = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      let issues = 0;
      const granted = await grantedFlow({
        store,
        sessionIssuer: {
          issue: () => {
            issues += 1;
            return Promise.resolve(undefined);
          },
        },
      });
      if (stage === "read")
        store.readGrant = async (digest) => {
          entered();
          await pending;
          return read(digest);
        };
      else
        store.consumeGrant = async (record) => {
          entered();
          await pending;
          return consume(record);
        };
      const controller = new AbortController();
      const reason = new Error("request cancelled");
      const exchange = granted.oidc.exchange(
        { grant: granted.grant, browserCodeVerifier: verifier },
        controller.signal,
      );
      await waiting;
      controller.abort(reason);
      release();
      await expect(exchange).rejects.toBe(reason);
      expect(issues).toBe(0);
      const digest = OidcFlowKeys.digest(store.flowId, granted.grant);
      if (stage === "read") expect(await read(digest)).toBeDefined();
      else expect(await read(digest)).toBeUndefined();
      await granted.oidc.close();
      await store.close();
    },
  );

  it("drains a late grant consume without issuing a session after close", async () => {
    const store = new MemoryOidcFlowStore(
      "closing-exchange",
      () => create(TimestampSchema, { seconds: 2n }),
      10,
      10,
    );
    const consume = store.consumeGrant.bind(store);
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let issues = 0;
    const granted = await grantedFlow({
      store,
      sessionIssuer: {
        issue: () => {
          issues += 1;
          return Promise.resolve(undefined);
        },
      },
    });
    store.consumeGrant = async (record) => {
      entered();
      await pending;
      return consume(record);
    };
    const exchange = granted.oidc.exchange({ grant: granted.grant, browserCodeVerifier: verifier });
    await waiting;
    const closing = granted.oidc.close();
    release();
    await expect(exchange).resolves.toEqual({ kind: "rejected" });
    await closing;
    expect(issues).toBe(0);
    await store.close();
  });

  it("validates browser PKCE before consuming a grant and issues a session once", async () => {
    let issued = 0;
    const { oidc, grant } = await grantedFlow({
      sessionIssuer: {
        issue: (principal: unknown) => {
          issued += 1;
          expect(principal).toEqual({ id: "principal" });
          return Promise.resolve({
            credential: { kind: "cookie", value: "opaque-session" },
            session: { principal, expiresAt: { seconds: 1n, nanos: 0 } },
          });
        },
      },
    });

    expect(await oidc.exchange({ grant, browserCodeVerifier: verifier })).toMatchObject({
      kind: "issued",
      credential: { kind: "cookie", value: "opaque-session" },
      session: { principal: { id: "principal" } },
    });
    expect(issued).toBe(1);
    expect(await oidc.exchange({ grant, browserCodeVerifier: verifier })).toEqual({
      kind: "rejected",
    });
    expect(issued).toBe(1);
  });

  it("snapshots cycling grant and verifier getters before it burns and verifies a grant", async () => {
    const oidc = flow({
      randomBytes: random(1, 2, 3, 4, 5, 6, 7, 8),
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: () =>
          Promise.resolve({ issuer: "https://issuer.example", subject: "subject" }),
      },
      identityMapping: {
        resolve: (externalIdentity: unknown) =>
          Promise.resolve({ externalIdentity, principal: { id: "principal" } }),
      },
      sessionIssuer: {
        issue: (principal: unknown) =>
          Promise.resolve({
            credential: { kind: "cookie", value: "opaque-session" },
            session: { principal, expiresAt: { seconds: 1n, nanos: 0 } },
          }),
      },
    });
    const grant = async () => {
      const started = await oidc.start({
        browserCodeChallenge: challenge,
        postLoginRedirect: landing,
      });
      if (started.kind !== "started") throw new Error("expected start");
      const callback = await oidc.callback({
        state: stateOf(started.authorizationUrl),
        code: "code",
      });
      if (callback.kind !== "granted") throw new Error("expected grant");
      return callback.grant;
    };
    const first = await grant();
    const second = await grant();
    let grantReads = 0;
    let verifierReads = 0;
    const input = {
      get grant() {
        grantReads += 1;
        return grantReads === 1 ? first : second;
      },
      get browserCodeVerifier() {
        verifierReads += 1;
        return verifierReads === 1 ? verifier : "wrong";
      },
    };

    await expect(oidc.exchange(input)).resolves.toMatchObject({ kind: "issued" });
    expect(grantReads).toBe(1);
    expect(verifierReads).toBe(1);
    await expect(oidc.exchange({ grant: first, browserCodeVerifier: verifier })).resolves.toEqual({
      kind: "rejected",
    });
    await expect(
      oidc.exchange({ grant: second, browserCodeVerifier: verifier }),
    ).resolves.toMatchObject({
      kind: "issued",
    });
  });

  it("rejects hostile exchange input without escaping or revealing grant state", async () => {
    const prototypeHostile = await grantedFlow({
      sessionIssuer: {
        issue: () =>
          Promise.resolve({
            credential: { kind: "cookie", value: "opaque-session" },
            session: { principal: { id: "principal" }, expiresAt: { seconds: 1n, nanos: 0 } },
          }),
      },
    });
    await expect(
      prototypeHostile.oidc.exchange(
        new Proxy(
          {},
          {
            getPrototypeOf: () => {
              throw new Error("prototype");
            },
          },
        ) as never,
      ),
    ).resolves.toEqual({ kind: "rejected" });
    await expect(
      prototypeHostile.oidc.exchange({
        grant: prototypeHostile.grant,
        browserCodeVerifier: verifier,
      }),
    ).resolves.toMatchObject({ kind: "issued" });

    const getterHostile = await grantedFlow({
      sessionIssuer: {
        issue: () =>
          Promise.resolve({
            credential: { kind: "cookie", value: "opaque-session" },
            session: { principal: { id: "principal" }, expiresAt: { seconds: 1n, nanos: 0 } },
          }),
      },
    });
    await expect(
      getterHostile.oidc.exchange({
        grant: getterHostile.grant,
        get browserCodeVerifier() {
          throw new Error("verifier");
        },
      } as never),
    ).resolves.toEqual({ kind: "rejected" });
    await expect(
      getterHostile.oidc.exchange({
        grant: getterHostile.grant,
        browserCodeVerifier: verifier,
      }),
    ).resolves.toMatchObject({ kind: "issued" });
  });

  it("preserves grants after wrong proof and burns them before session issuance", async () => {
    let issued = 0;
    const wrong = await grantedFlow({
      sessionIssuer: {
        issue: () => {
          issued += 1;
          return Promise.resolve(undefined);
        },
      },
    });
    expect(await wrong.oidc.exchange({ grant: wrong.grant, browserCodeVerifier: "wrong" })).toEqual(
      {
        kind: "rejected",
      },
    );
    expect(
      await wrong.oidc.exchange({ grant: wrong.grant, browserCodeVerifier: verifier }),
    ).toEqual({
      kind: "rejected",
    });
    expect(issued).toBe(1);

    const failing = await grantedFlow({
      sessionIssuer: {
        issue: () => {
          issued += 1;
          return Promise.resolve(undefined);
        },
      },
    });
    expect(
      await failing.oidc.exchange({ grant: failing.grant, browserCodeVerifier: verifier }),
    ).toEqual({
      kind: "rejected",
    });
    expect(
      await failing.oidc.exchange({ grant: failing.grant, browserCodeVerifier: verifier }),
    ).toEqual({
      kind: "rejected",
    });
    expect(issued).toBe(2);
  });

  it("bounds session issuer work with the configured deadline", async () => {
    let release!: () => void;
    const bounded = await grantedFlow({
      operationTimeoutMilliseconds: 1,
      sessionIssuer: {
        issue: () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      },
    });
    await expect(
      bounded.oidc.exchange({ grant: bounded.grant, browserCodeVerifier: verifier }),
    ).resolves.toEqual({ kind: "rejected" });
    release();
    await bounded.oidc.close();
  });

  it("expires grants before exchange and makes close win a pending session issuance", async () => {
    const time = clock();
    const expired = await grantedFlow({
      clock: time,
      grantTtlMilliseconds: 1,
      sessionIssuer: {
        issue: () => {
          throw new Error("must not issue");
        },
      },
    });
    time.advance(1);
    expect(
      await expired.oidc.exchange({ grant: expired.grant, browserCodeVerifier: verifier }),
    ).toEqual({
      kind: "rejected",
    });

    let releaseIssue!: () => void;
    let issueEntered!: () => void;
    const issueWaiting = new Promise<void>((resolve) => {
      issueEntered = resolve;
    });
    const closing = await grantedFlow({
      sessionIssuer: {
        issue: () =>
          new Promise<void>((resolve) => {
            releaseIssue = resolve;
            issueEntered();
          }),
      },
    });
    const pending = closing.oidc.exchange({ grant: closing.grant, browserCodeVerifier: verifier });
    await issueWaiting;
    const drained = closing.oidc.close();
    await expect(pending).resolves.toEqual({ kind: "rejected" });
    releaseIssue();
    await drained;
  });

  it("rejects malformed issuer sessions without throwing", async () => {
    const malformed = await grantedFlow({
      sessionIssuer: {
        issue: () => Promise.resolve({ credential: { kind: "cookie", value: "x" } } as never),
      },
    });
    await expect(
      malformed.oidc.exchange({ grant: malformed.grant, browserCodeVerifier: verifier }),
    ).resolves.toEqual({ kind: "rejected" });
  });

  it("surfaces an issuer rejection caused by a throwing thenable getter", async () => {
    const hostile = await grantedFlow({
      sessionIssuer: {
        issue: () =>
          Promise.resolve(
            new Proxy(
              {},
              {
                get: () => {
                  throw new Error("getter");
                },
              },
            ) as never,
          ),
      },
    });
    await expect(
      hostile.oidc.exchange({ grant: hostile.grant, browserCodeVerifier: verifier }),
    ).rejects.toThrow("getter");
  });

  it("rejects negative timestamp nanos and token-like external claims", async () => {
    const tokenOidc = flow({
      randomBytes: random(1, 2, 3),
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: () =>
          Promise.resolve({
            issuer: "https://issuer.example",
            subject: "subject",
            claims: { access_token: "secret" },
          }),
      },
    });
    const tokenStarted = await tokenOidc.start({
      browserCodeChallenge: challenge,
      postLoginRedirect: landing,
    });
    if (tokenStarted.kind !== "started") throw new Error("expected start");
    await expect(
      tokenOidc.callback({
        state: stateOf(tokenStarted.authorizationUrl),
        code: "code",
      }),
    ).resolves.toEqual({
      kind: "rejected",
      reason: "verification-failed",
    });

    const nanos = await grantedFlow({
      sessionIssuer: {
        issue: () =>
          Promise.resolve({
            credential: { kind: "cookie", value: "x" },
            session: { principal: { id: "principal" }, expiresAt: { seconds: 1n, nanos: -1 } },
          }),
      },
    });
    await expect(
      nanos.oidc.exchange({ grant: nanos.grant, browserCodeVerifier: verifier }),
    ).resolves.toEqual({
      kind: "rejected",
    });
  });

  it.each([
    { name: "null issue", issue: null },
    { name: "array issue", issue: [] },
    { name: "null credential", issue: { credential: null, session: {} } },
    {
      name: "unsupported credential",
      issue: {
        credential: { kind: "header", value: "x" },
        session: { principal: { id: "principal" }, expiresAt: { seconds: 1n, nanos: 0 } },
      },
    },
    {
      name: "empty credential",
      issue: {
        credential: { kind: "cookie", value: "" },
        session: { principal: { id: "principal" }, expiresAt: { seconds: 1n, nanos: 0 } },
      },
    },
    { name: "null session", issue: { credential: { kind: "cookie", value: "x" }, session: null } },
    {
      name: "null principal",
      issue: {
        credential: { kind: "cookie", value: "x" },
        session: { principal: null, expiresAt: { seconds: 1n, nanos: 0 } },
      },
    },
    {
      name: "empty principal ID",
      issue: {
        credential: { kind: "cookie", value: "x" },
        session: { principal: { id: "" }, expiresAt: { seconds: 1n, nanos: 0 } },
      },
    },
    {
      name: "invalid principal attributes",
      issue: {
        credential: { kind: "cookie", value: "x" },
        session: {
          principal: { id: "principal", attributes: [] },
          expiresAt: { seconds: 1n, nanos: 0 },
        },
      },
    },
    {
      name: "null expiry",
      issue: {
        credential: { kind: "cookie", value: "x" },
        session: { principal: { id: "principal" }, expiresAt: null },
      },
    },
    {
      name: "non-bigint seconds",
      issue: {
        credential: { kind: "cookie", value: "x" },
        session: { principal: { id: "principal" }, expiresAt: { seconds: 1, nanos: 0 } },
      },
    },
    {
      name: "seconds below Timestamp range",
      issue: {
        credential: { kind: "cookie", value: "x" },
        session: {
          principal: { id: "principal" },
          expiresAt: { seconds: -62_135_596_801n, nanos: 0 },
        },
      },
    },
    {
      name: "seconds above Timestamp range",
      issue: {
        credential: { kind: "cookie", value: "x" },
        session: {
          principal: { id: "principal" },
          expiresAt: { seconds: 253_402_300_800n, nanos: 0 },
        },
      },
    },
    {
      name: "non-integer nanos",
      issue: {
        credential: { kind: "cookie", value: "x" },
        session: { principal: { id: "principal" }, expiresAt: { seconds: 1n, nanos: 0.5 } },
      },
    },
    {
      name: "nanos at upper bound",
      issue: {
        credential: { kind: "cookie", value: "x" },
        session: {
          principal: { id: "principal" },
          expiresAt: { seconds: 1n, nanos: 1_000_000_000 },
        },
      },
    },
  ])("rejects session issuer output with $name", async ({ issue }) => {
    const malformed = await grantedFlow({
      sessionIssuer: { issue: () => Promise.resolve(issue as never) },
    });
    await expect(
      malformed.oidc.exchange({ grant: malformed.grant, browserCodeVerifier: verifier }),
    ).resolves.toEqual({ kind: "rejected" });
  });
});
