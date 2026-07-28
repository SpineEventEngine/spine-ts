import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import { OidcFlow } from "../../src/index.js";

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
      exchangeAuthorizationCode: async () => undefined,
    },
    identityMapping: { resolve: async () => undefined },
    sessionIssuer: { issue: async () => undefined },
    ...options,
  });
}

describe("OidcFlow start", () => {
  it("creates an exact authorization-code URL with unique random security parameters", () => {
    const time = clock();
    const generated = [
      new Uint8Array(32).fill(1),
      new Uint8Array(32).fill(2),
      new Uint8Array(32).fill(3),
    ];
    const oidc = flow({ clock: time, randomBytes: () => generated.shift()! });

    const started = oidc.start({
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

  it("rejects invalid construction and start input without retaining a transaction", () => {
    expect(() => flow({ authorizationEndpoint: "http://issuer.example/authorize" })).toThrow();
    expect(() => flow({ callbackUri: "https://user@application.example/callback" })).toThrow();
    expect(() => flow({ scopes: ["openid", "openid"] })).toThrow();
    expect(() => flow({ scopes: ["profile"] })).toThrow();
    expect(() => flow({ allowedPostLoginRedirects: [] })).toThrow();

    const oidc = flow({ randomBytes: random(1, 2, 3) });
    expect(oidc.start({ browserCodeChallenge: "invalid", postLoginRedirect: landing })).toEqual({
      kind: "rejected",
      reason: "invalid-input",
    });
    expect(
      oidc.start({
        browserCodeChallenge: "a".repeat(43),
        postLoginRedirect: "https://app.example/other",
      }),
    ).toEqual({ kind: "rejected", reason: "invalid-input" });
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
        exchangeAuthorizationCode: async () => undefined,
      },
    },
    { provider: { issuer: "https://issuer.example", exchangeAuthorizationCode: undefined } },
    { identityMapping: { resolve: undefined } },
    { sessionIssuer: { issue: undefined } },
  ])("rejects finite malformed construction option %#", (options) => {
    expect(() => flow(options)).toThrow();
  });

  it("bounds live transactions, expires them before capacity, and zeroes random buffers", () => {
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

    expect(oidc.start(input)).toMatchObject({ kind: "started" });
    expect(oidc.start(input)).toEqual({ kind: "rejected", reason: "capacity-exceeded" });
    time.advance(10);
    expect(oidc.start(input)).toMatchObject({ kind: "started" });
    expect(buffers.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
  });

  it("retries colliding state material before committing a transaction", () => {
    const oidc = flow({
      randomBytes: random(1, 2, 3, 1, 4, 5, 6, 7, 8),
      maxTransactions: 2,
      collisionAttempts: 2,
    });
    const input = { browserCodeChallenge: "a".repeat(43), postLoginRedirect: landing };

    expect(oidc.start(input)).toMatchObject({ kind: "started" });
    expect(oidc.start(input)).toMatchObject({ kind: "started" });
  });

  it("keeps state, nonce, and provider PKCE challenge distinct across live starts", () => {
    const oidc = flow({ randomBytes: random(1, 2, 3, 4, 5, 6), maxTransactions: 2 });
    const input = { browserCodeChallenge: "a".repeat(43), postLoginRedirect: landing };
    const first = oidc.start(input);
    const second = oidc.start(input);
    if (first.kind !== "started" || second.kind !== "started") throw new Error("expected starts");
    const a = new URL(first.authorizationUrl).searchParams;
    const b = new URL(second.authorizationUrl).searchParams;
    expect(a.get("state")).not.toBe(b.get("state"));
    expect(a.get("nonce")).not.toBe(b.get("nonce"));
    expect(a.get("code_challenge")).not.toBe(b.get("code_challenge"));
  });

  it("retries repeated active nonce or provider verifier material before committing", () => {
    const oidc = flow({
      randomBytes: random(1, 2, 3, 4, 2, 3, 5, 6, 7),
      maxTransactions: 2,
      collisionAttempts: 2,
    });
    const input = { browserCodeChallenge: "a".repeat(43), postLoginRedirect: landing };
    const first = oidc.start(input);
    const second = oidc.start(input);
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
  ] as const)("retries active %s reuse with fresh successful material", (_kind, values) => {
    const oidc = flow({ randomBytes: random(...values), maxTransactions: 2, collisionAttempts: 2 });
    const input = { browserCodeChallenge: "a".repeat(43), postLoginRedirect: landing };
    const first = oidc.start(input);
    const second = oidc.start(input);
    if (first.kind !== "started" || second.kind !== "started") throw new Error("expected starts");
    const firstUrl = new URL(first.authorizationUrl).searchParams;
    const secondUrl = new URL(second.authorizationUrl).searchParams;
    if (_kind === "nonce") expect(firstUrl.get("nonce")).not.toBe(secondUrl.get("nonce"));
    else expect(firstUrl.get("code_challenge")).not.toBe(secondUrl.get("code_challenge"));
  });

  it("fails safely when entropy cannot create a valid unique transaction and after terminal close", () => {
    const short = new Uint8Array(31).fill(9);
    const oidc = flow({ randomBytes: () => short, collisionAttempts: 2 });
    const input = { browserCodeChallenge: "a".repeat(43), postLoginRedirect: landing };
    expect(oidc.start(input)).toEqual({ kind: "rejected", reason: "entropy-exhausted" });
    expect(short).toEqual(new Uint8Array(31));
    oidc.close();
    oidc.close();
    expect(oidc.start(input)).toEqual({ kind: "rejected", reason: "closed" });
  });

  it.each([
    { name: "nonce", badAt: 2 },
    { name: "verifier", badAt: 3 },
  ])("rejects wrong-length $name random material", ({ badAt }) => {
    let calls = 0;
    const oidc = flow({
      collisionAttempts: 1,
      randomBytes: () => {
        calls += 1;
        return new Uint8Array(calls === badAt ? 31 : 32).fill(1);
      },
    });
    expect(
      oidc.start({ browserCodeChallenge: "a".repeat(43), postLoginRedirect: landing }),
    ).toEqual({ kind: "rejected", reason: "entropy-exhausted" });
  });

  it("rejects an authorization URL beyond its finite configured bound", () => {
    const oidc = flow({ randomBytes: random(1, 2, 3), maxAuthorizationUrlLength: 1 });
    expect(
      oidc.start({ browserCodeChallenge: "a".repeat(43), postLoginRedirect: landing }),
    ).toEqual({ kind: "rejected", reason: "invalid-input" });
  });

  it.each(["valid", "invalid", "throw"] as const)(
    "lets terminal close win re-entrant %s clock and random callbacks",
    (outcome) => {
      let oidc: OidcFlow;
      const closeThen = () => {
        oidc.close();
        if (outcome === "throw") throw new Error("entropy");
        return outcome === "valid" ? 1_000 : Number.NaN;
      };
      oidc = flow({ clock: { now: closeThen }, randomBytes: random(1, 2, 3) });
      expect(
        oidc.start({ browserCodeChallenge: "a".repeat(43), postLoginRedirect: landing }),
      ).toEqual({ kind: "rejected", reason: "closed" });

      let randomClosing: OidcFlow;
      randomClosing = flow({
        randomBytes: () => {
          randomClosing.close();
          if (outcome === "throw") throw new Error("entropy");
          return new Uint8Array(outcome === "valid" ? 32 : 31);
        },
      });
      expect(
        randomClosing.start({ browserCodeChallenge: "a".repeat(43), postLoginRedirect: landing }),
      ).toEqual({ kind: "rejected", reason: "closed" });
    },
  );
});

describe("OidcFlow callback", () => {
  function startedFlow(options: Record<string, unknown> = {}) {
    const oidc = flow({ randomBytes: random(1, 2, 3, 4), ...options });
    const started = oidc.start({
      browserCodeChallenge: "a".repeat(43),
      postLoginRedirect: landing,
    });
    if (started.kind !== "started") throw new Error("expected start");
    return { oidc, state: new URL(started.authorizationUrl).searchParams.get("state")! };
  }

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

  it("consumes state before provider work, then creates a one-time bounded grant", async () => {
    let providerCalls = 0;
    let mappingIdentity: unknown;
    const time = clock();
    const { oidc, state } = startedFlow({
      clock: time,
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: async () => {
          providerCalls += 1;
          return {
            issuer: "https://issuer.example",
            subject: "subject-1",
            claims: { email: "a@b.c" },
          };
        },
      },
      identityMapping: {
        resolve: async (identity: unknown) => {
          mappingIdentity = identity;
          return {
            externalIdentity: identity,
            principal: { id: "principal-1", attributes: { role: "member" } },
          };
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
          exchangeAuthorizationCode: async () => undefined,
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
          exchangeAuthorizationCode: async () => {
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
          exchangeAuthorizationCode: async () => ({
            issuer: "https://issuer.example",
            subject: "subject",
          }),
        },
        identityMapping: { resolve: async () => undefined },
      },
      "mapping-failed",
    ],
    [
      "throwing mapping",
      { code: "code" },
      {
        provider: {
          issuer: "https://issuer.example",
          exchangeAuthorizationCode: async () => ({
            issuer: "https://issuer.example",
            subject: "subject",
          }),
        },
        identityMapping: {
          resolve: async () => {
            throw new Error("mapping");
          },
        },
      },
      "mapping-failed",
    ],
  ] as const)(
    "reaches callback %s outcome with a live state",
    async (_name, facts, options, reason) => {
      const started = startedFlow(options);
      await expect(
        started.oidc.callback({ state: started.state, ...facts } as never),
      ).resolves.toEqual({ kind: "rejected", reason });
    },
  );

  it("burns state before rejecting provider errors, malformed callbacks, issuer mix-ups, and expiry", async () => {
    let providerCalls = 0;
    const provider = {
      issuer: "https://issuer.example",
      exchangeAuthorizationCode: async () => {
        providerCalls += 1;
        return { issuer: "https://issuer.example", subject: "subject" };
      },
    };
    const error = startedFlow({ provider });
    expect(await error.oidc.callback({ state: error.state, error: "access_denied" })).toEqual({
      kind: "rejected",
      reason: "provider-error",
    });
    expect(await error.oidc.callback({ state: error.state, code: "code" })).toEqual({
      kind: "rejected",
      reason: "not-found",
    });

    const malformed = startedFlow({ provider });
    expect(
      await malformed.oidc.callback({ state: malformed.state, code: "code", error: "bad" }),
    ).toEqual({
      kind: "rejected",
      reason: "invalid-input",
    });
    expect(await malformed.oidc.callback({ state: malformed.state, code: "code" })).toEqual({
      kind: "rejected",
      reason: "not-found",
    });

    const mixed = startedFlow({ provider });
    expect(
      await mixed.oidc.callback({
        state: mixed.state,
        code: "code",
        responseIssuer: "https://other.example",
      }),
    ).toEqual({ kind: "rejected", reason: "issuer-mismatch" });
    expect(await mixed.oidc.callback({ state: mixed.state, code: "code" })).toEqual({
      kind: "rejected",
      reason: "not-found",
    });

    const time = clock();
    const expired = startedFlow({ clock: time, provider, transactionTtlMilliseconds: 1 });
    time.advance(1);
    expect(await expired.oidc.callback({ state: expired.state, code: "code" })).toEqual({
      kind: "rejected",
      reason: "expired",
    });
    expect(providerCalls).toBe(0);
  });

  it("rejects unverified or unbounded identity and mapping failures without a grant", async () => {
    const rejected = startedFlow({
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: async () => undefined,
      },
    });
    expect(await rejected.oidc.callback({ state: rejected.state, code: "code" })).toEqual({
      kind: "rejected",
      reason: "verification-failed",
    });

    const wrongIssuer = startedFlow({
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: async () => ({
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
      Array.from({ length: 33 }, (_, index) => [`claim-${index}`, "x"]),
    );
    const oversized = startedFlow({
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: async () => ({
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

    const mapping = startedFlow({
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: async () => ({
          issuer: "https://issuer.example",
          subject: "subject",
        }),
      },
      identityMapping: { resolve: async () => undefined },
    });
    expect(await mapping.oidc.callback({ state: mapping.state, code: "code" })).toEqual({
      kind: "rejected",
      reason: "mapping-failed",
    });
  });

  it("aborts deadline-bound provider work and lets close win an in-flight callback", async () => {
    const deadline = startedFlow({
      operationTimeoutMilliseconds: 1,
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: ({ signal }: { signal: AbortSignal }) =>
          new Promise((resolve) =>
            signal.addEventListener("abort", () => resolve(undefined), { once: true }),
          ),
      },
    });
    await expect(deadline.oidc.callback({ state: deadline.state, code: "code" })).resolves.toEqual({
      kind: "rejected",
      reason: "verification-failed",
    });

    let release: (() => void) | undefined;
    const closing = startedFlow({
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: async () =>
          new Promise((resolve) => {
            release = () => resolve({ issuer: "https://issuer.example", subject: "subject" });
          }),
      },
    });
    const pending = closing.oidc.callback({ state: closing.state, code: "code" });
    await Promise.resolve();
    closing.oidc.close();
    release?.();
    await expect(pending).resolves.toEqual({ kind: "rejected", reason: "closed" });
  });

  it("bounds mapping work with the configured deadline", async () => {
    const bounded = startedFlow({
      operationTimeoutMilliseconds: 1,
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: async () => ({
          issuer: "https://issuer.example",
          subject: "subject",
        }),
      },
      identityMapping: { resolve: async () => new Promise(() => {}) },
    });
    await expect(bounded.oidc.callback({ state: bounded.state, code: "code" })).resolves.toEqual({
      kind: "rejected",
      reason: "mapping-failed",
    });
  });

  it("returns closed when a callback clock closes during lookup", async () => {
    let calls = 0;
    let oidc: OidcFlow;
    const time = {
      now: () => {
        calls += 1;
        if (calls > 2) oidc.close();
        return 1_000;
      },
    };
    oidc = flow({ clock: time, randomBytes: random(1, 2, 3) });
    const started = oidc.start({
      browserCodeChallenge: "a".repeat(43),
      postLoginRedirect: landing,
    });
    if (started.kind !== "started") throw new Error("expected start");
    await expect(
      oidc.callback({
        state: new URL(started.authorizationUrl).searchParams.get("state")!,
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
      const hostile = startedFlow({
        provider: {
          issuer: "https://issuer.example",
          exchangeAuthorizationCode: async () =>
            ({ issuer: "https://issuer.example", subject: "subject", claims }) as never,
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
    const preserved = startedFlow({
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: async () => ({
          issuer: "https://issuer.example",
          subject: "subject",
          claims,
        }),
      },
      identityMapping: {
        resolve: async (externalIdentity) => {
          expect(Object.hasOwn(externalIdentity.claims ?? {}, "__proto__")).toBe(true);
          expect(externalIdentity.claims?.["__proto__"]).toBe("literal-claim");
          return { externalIdentity, principal: { id: "principal" } };
        },
      },
    });
    await expect(
      preserved.oidc.callback({ state: preserved.state, code: "code" }),
    ).resolves.toMatchObject({ kind: "granted" });
  });

  it("rejects hostile mapping output after consuming state", async () => {
    const hostile = startedFlow({
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: async () => ({
          issuer: "https://issuer.example",
          subject: "subject",
        }),
      },
      identityMapping: {
        resolve: async () =>
          new Proxy(
            {},
            {
              get: () => {
                throw new Error("getter");
              },
            },
          ) as never,
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
    const malformed = startedFlow({
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: async () => ({
          issuer: "https://issuer.example",
          subject: "subject",
        }),
      },
      identityMapping: { resolve: async () => output as never },
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
          claims: Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`c${index}`, "v"])),
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
            Array.from({ length: 33 }, (_, index) => [`a${index}`, "v"]),
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
    const malformed = startedFlow({
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: async () => ({
          issuer: "https://issuer.example",
          subject: "subject",
          ...(providerClaims === undefined ? {} : { claims: providerClaims }),
        }),
      },
      identityMapping: { resolve: async () => output as never },
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
    const stable = startedFlow({
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: async () => ({
          issuer: "https://issuer.example",
          subject: "subject",
        }),
      },
      identityMapping: { resolve: async () => mapped as never },
    });
    await expect(
      stable.oidc.callback({ state: stable.state, code: "code" }),
    ).resolves.toMatchObject({ kind: "granted" });
    expect(reads).toEqual({ external: 1, principal: 1, issuer: 1, subject: 1, id: 1 });
  });

  it("reclaims an expired grant before admitting the next bounded callback", async () => {
    const time = clock();
    const oidc = flow({
      clock: time,
      randomBytes: random(1, 2, 3, 4, 5, 6, 7, 8),
      maxGrants: 1,
      grantTtlMilliseconds: 10,
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: async () => ({
          issuer: "https://issuer.example",
          subject: "subject",
        }),
      },
      identityMapping: {
        resolve: async (externalIdentity: unknown) => ({
          externalIdentity,
          principal: { id: "principal" },
        }),
      },
    });
    const start = () => {
      const started = oidc.start({
        browserCodeChallenge: "a".repeat(43),
        postLoginRedirect: landing,
      });
      if (started.kind !== "started") throw new Error("expected start");
      return new URL(started.authorizationUrl).searchParams.get("state")!;
    };
    expect((await oidc.callback({ state: start(), code: "one" })).kind).toBe("granted");
    await expect(oidc.callback({ state: start(), code: "two" })).resolves.toEqual({
      kind: "rejected",
      reason: "capacity-exceeded",
    });
    time.advance(10);
    expect((await oidc.callback({ state: start(), code: "three" })).kind).toBe("granted");
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
        exchangeAuthorizationCode: async () => ({
          issuer: "https://issuer.example",
          subject: "subject",
        }),
      },
      identityMapping: {
        resolve: async (externalIdentity: unknown) => ({
          externalIdentity,
          principal: { id: "principal" },
        }),
      },
      sessionIssuer: {
        issue: async () => ({
          credential: { kind: "cookie", value: "session" },
          session: { principal: { id: "principal" }, expiresAt: { seconds: 1n, nanos: 0 } },
        }),
      },
    });
    const start = () => {
      const started = oidc.start({
        browserCodeChallenge: challenge,
        postLoginRedirect: landing,
      });
      if (started.kind !== "started") throw new Error("expected start");
      return new URL(started.authorizationUrl).searchParams.get("state")!;
    };
    const first = await oidc.callback({ state: start(), code: "one" });
    if (first.kind !== "granted") throw new Error("expected grant");
    await expect(oidc.callback({ state: start(), code: "two" })).resolves.toEqual({
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
        exchangeAuthorizationCode: async () => ({
          issuer: "https://issuer.example",
          subject: "subject",
        }),
      },
      identityMapping: {
        resolve: async (externalIdentity: unknown) => ({
          externalIdentity,
          principal: { id: "principal" },
        }),
      },
      ...options,
    });
    const started = oidc.start({ browserCodeChallenge: challenge, postLoginRedirect: landing });
    if (started.kind !== "started") throw new Error("expected start");
    const callback = await oidc.callback({
      state: new URL(started.authorizationUrl).searchParams.get("state")!,
      code: "provider-code",
    });
    if (callback.kind !== "granted") throw new Error("expected grant");
    return { oidc, grant: callback.grant };
  }

  it("burns a grant before browser PKCE verification and issues an application session once", async () => {
    let issued = 0;
    const { oidc, grant } = await grantedFlow({
      sessionIssuer: {
        issue: async (principal: unknown) => {
          issued += 1;
          expect(principal).toEqual({ id: "principal" });
          return {
            credential: { kind: "cookie", value: "opaque-session" },
            session: { principal, expiresAt: { seconds: 1n, nanos: 0 } },
          };
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

  it("burns grants before malformed or incorrect PKCE proof and session failures", async () => {
    let issued = 0;
    const wrong = await grantedFlow({
      sessionIssuer: { issue: async () => ((issued += 1), undefined) },
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
    expect(issued).toBe(0);

    const failing = await grantedFlow({
      sessionIssuer: { issue: async () => ((issued += 1), undefined) },
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
    expect(issued).toBe(1);
  });

  it("bounds session issuer work with the configured deadline", async () => {
    const bounded = await grantedFlow({
      operationTimeoutMilliseconds: 1,
      sessionIssuer: { issue: async () => new Promise(() => {}) },
    });
    await expect(
      bounded.oidc.exchange({ grant: bounded.grant, browserCodeVerifier: verifier }),
    ).resolves.toEqual({ kind: "rejected" });
  });

  it("expires grants before exchange and makes close win a pending session issuance", async () => {
    const time = clock();
    const expired = await grantedFlow({
      clock: time,
      grantTtlMilliseconds: 1,
      sessionIssuer: {
        issue: async () => {
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

    const closing = await grantedFlow({
      sessionIssuer: {
        issue: async () => new Promise(() => {}),
      },
    });
    const pending = closing.oidc.exchange({ grant: closing.grant, browserCodeVerifier: verifier });
    await Promise.resolve();
    closing.oidc.close();
    await expect(pending).resolves.toEqual({ kind: "rejected" });
  });

  it("rejects malformed issuer sessions without throwing", async () => {
    const malformed = await grantedFlow({
      sessionIssuer: {
        issue: async () => ({ credential: { kind: "cookie", value: "x" } }) as never,
      },
    });
    await expect(
      malformed.oidc.exchange({ grant: malformed.grant, browserCodeVerifier: verifier }),
    ).resolves.toEqual({ kind: "rejected" });
  });

  it("rejects throwing session getters and proxies without escaping", async () => {
    const hostile = await grantedFlow({
      sessionIssuer: {
        issue: async () =>
          new Proxy(
            {},
            {
              get: () => {
                throw new Error("getter");
              },
            },
          ) as never,
      },
    });
    await expect(
      hostile.oidc.exchange({ grant: hostile.grant, browserCodeVerifier: verifier }),
    ).resolves.toEqual({ kind: "rejected" });
  });

  it("rejects negative timestamp nanos and token-like external claims", async () => {
    const tokenOidc = flow({
      randomBytes: random(1, 2, 3),
      provider: {
        issuer: "https://issuer.example",
        exchangeAuthorizationCode: async () => ({
          issuer: "https://issuer.example",
          subject: "subject",
          claims: { access_token: "secret" },
        }),
      },
    });
    const tokenStarted = tokenOidc.start({
      browserCodeChallenge: challenge,
      postLoginRedirect: landing,
    });
    if (tokenStarted.kind !== "started") throw new Error("expected start");
    await expect(
      tokenOidc.callback({
        state: new URL(tokenStarted.authorizationUrl).searchParams.get("state")!,
        code: "code",
      }),
    ).resolves.toEqual({
      kind: "rejected",
      reason: "verification-failed",
    });

    const nanos = await grantedFlow({
      sessionIssuer: {
        issue: async () => ({
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
      sessionIssuer: { issue: async () => issue as never },
    });
    await expect(
      malformed.oidc.exchange({ grant: malformed.grant, browserCodeVerifier: verifier }),
    ).resolves.toEqual({ kind: "rejected" });
  });
});
