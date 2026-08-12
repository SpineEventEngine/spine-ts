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
import { SignJWT, exportJWK, generateKeyPair } from "jose";

import {
  createGoogleProvider,
  createGitHubProvider,
  createOidcProvider,
  discoverOidcProvider,
} from "../../src/providers/index.js";

describe("custom OIDC provider", () => {
  it.each(["RS256", "ES256"] as const)(
    "accepts a locally signed %s ID token only with exact claims",
    async (algorithm) => {
      const { privateKey, publicKey } = await generateKeyPair(algorithm);
      const jwk = await exportJWK(publicKey);
      Object.assign(jwk, { kid: "current", alg: algorithm, use: "sig" });
      const token = await new SignJWT({
        nonce: "nonce",
        email: "user@example.test",
        email_verified: true,
      })
        .setProtectedHeader({ alg: algorithm, kid: "current", typ: "JWT" })
        .setIssuer("https://issuer.example")
        .setAudience("chat-web")
        .setSubject("user-42")
        .setIssuedAt(1)
        .setExpirationTime(2_000_000_000)
        .sign(privateKey);
      let call = 0;
      const configured = createOidcProvider({
        issuer: "https://issuer.example",
        authorizationEndpoint: "https://issuer.example/authorize",
        tokenEndpoint: "https://issuer.example/token",
        jwksEndpoint: "https://issuer.example/keys",
        clientId: "chat-web",
        fetch: () =>
          Promise.resolve(
            new Response(JSON.stringify(++call === 1 ? { id_token: token } : { keys: [jwk] }), {
              headers: { "content-type": "application/json" },
            }),
          ),
        clock: () => 1_000,
      });
      await expect(
        configured.provider.exchangeAuthorizationCode({
          code: "code",
          clientId: "chat-web",
          callbackUri: "https://app.example/callback",
          providerCodeVerifier: "v".repeat(43),
          expectedNonce: "nonce",
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual({
        issuer: "https://issuer.example",
        subject: "user-42",
        claims: { email: "user@example.test", email_verified: "true" },
      });
    },
  );
  it("exchanges a code with S256 verifier and returns only a verified identity", async () => {
    const provider = createOidcProvider({
      issuer: "https://issuer.example",
      authorizationEndpoint: "https://issuer.example/authorize",
      tokenEndpoint: "https://issuer.example/token",
      jwksEndpoint: "https://issuer.example/keys",
      clientId: "chat-web",
      clientAuthentication: "none",
      fetch: (url, init) => {
        expect(url).toBe("https://issuer.example/token");
        expect(init?.redirect).toBe("error");
        const body = init?.body;
        if (!(body instanceof URLSearchParams))
          throw new Error("expected URL-encoded request body");
        expect(body.toString()).toContain("grant_type=authorization_code");
        return Promise.resolve(
          new Response(JSON.stringify({ id_token: "not-a-jwt" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      },
    });

    expect(provider.authorizationEndpoint).toBe("https://issuer.example/authorize");
    await expect(
      provider.provider.exchangeAuthorizationCode({
        code: "code",
        clientId: "chat-web",
        callbackUri: "https://app.example/callback",
        providerCodeVerifier: "v".repeat(43),
        expectedNonce: "nonce",
        signal: new AbortController().signal,
      }),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["wrong issuer", { issuer: "https://other.example" }],
    ["wrong audience", { audience: "other-client" }],
    ["wrong nonce", { nonce: "other-nonce" }],
    ["missing subject", { subject: undefined }],
    ["expired token", { expiration: 0 }],
    ["future not-before", { notBefore: 2_000_000_000 }],
    ["missing authorized presenter", { audience: ["chat-web", "other-client"] }],
    [
      "wrong authorized presenter",
      { audience: ["chat-web", "other-client"], authorizedPresenter: "other-client" },
    ],
  ] as const)("rejects a signed token with %s", async (_label, claims) => {
    await expect(exchangeSigned(claims)).resolves.toBeUndefined();
  });

  it.each([
    ["unknown key", { keyId: "unknown" }],
    ["duplicate key", { duplicateKey: true }],
    ["oversized key set", { oversizedKeySet: true }],
    ["key algorithm mismatch", { keyAlgorithm: "ES256" }],
  ] as const)("rejects %s", async (_label, keys) => {
    await expect(exchangeSigned({}, keys)).resolves.toBeUndefined();
  });

  it("rejects a non-canonical JWT signature spelling", async () => {
    const fixture = await signedFixture();
    const parts = fixture.token.split(".");
    const signature = parts[2];
    if (signature === undefined) throw new Error("expected JWT signature segment");
    parts[2] = `${signature}=`;
    await expect(exchangeFixture({ ...fixture, token: parts.join(".") })).resolves.toBeUndefined();
  });

  it.each([
    ["provider error", new Response("{}", { status: 503, headers: jsonHeaders() })],
    ["wrong media type", new Response("{}", { headers: { "content-type": "text/plain" } })],
    ["declared overflow", new Response("{}", { headers: jsonHeaders({ "content-length": "3" }) })],
    ["malformed JSON", new Response("{", { headers: jsonHeaders() })],
    ["empty response", new Response(null, { headers: jsonHeaders() })],
  ])("fails closed for a %s token response", async (_label, response) => {
    const provider = oidcProvider(() => Promise.resolve(response), { maxResponseBytes: 2 });
    await expect(
      provider.provider.exchangeAuthorizationCode(exchangeInput()),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["provider error", { status: 503, headers: jsonHeaders() }],
    ["wrong media type", { status: 200, headers: { "content-type": "text/plain" } }],
    ["declared overflow", { status: 200, headers: jsonHeaders({ "content-length": "3" }) }],
  ])("cancels the body rejected for %s", async (_label, init) => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{}"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const provider = oidcProvider(() => Promise.resolve(new Response(body, init)), {
      maxResponseBytes: 2,
    });
    await expect(
      provider.provider.exchangeAuthorizationCode(exchangeInput()),
    ).resolves.toBeUndefined();
    expect(cancelled).toBe(true);
  });

  it("cancels a response stream after the byte cap is crossed", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(3));
      },
      cancel() {
        cancelled = true;
      },
    });
    const provider = oidcProvider(
      () => Promise.resolve(new Response(body, { headers: jsonHeaders() })),
      {
        maxResponseBytes: 2,
      },
    );
    await expect(
      provider.provider.exchangeAuthorizationCode(exchangeInput()),
    ).resolves.toBeUndefined();
    expect(cancelled).toBe(true);
  });

  it("settles when an injected token client ignores abort", async () => {
    const provider = oidcProvider(() => new Promise<Response>(() => undefined), {
      timeoutMilliseconds: 5,
    });
    await expect(
      Promise.race([
        provider.provider.exchangeAuthorizationCode(exchangeInput()),
        rejectAfter(100),
      ]),
    ).resolves.toBeUndefined();
  });

  it("bounds discovery and rejects issuer mismatch", async () => {
    await expect(
      discoverOidcProvider({
        issuer: "https://issuer.example",
        clientId: "chat-web",
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                issuer: "https://other.example",
                authorization_endpoint: "https://issuer.example/authorize",
                token_endpoint: "https://issuer.example/token",
                jwks_uri: "https://issuer.example/keys",
              }),
              { headers: jsonHeaders() },
            ),
          ),
      }),
    ).resolves.toBeUndefined();
    await expect(
      Promise.race([
        discoverOidcProvider({
          issuer: "https://issuer.example",
          clientId: "chat-web",
          timeoutMilliseconds: 5,
          fetch: () => new Promise<Response>(() => undefined),
        }),
        rejectAfter(100),
      ]),
    ).resolves.toBeUndefined();
  });

  it("discovers exact metadata and applies Google scopes", async () => {
    const metadata = (issuer: string) =>
      new Response(
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/keys`,
        }),
        { headers: jsonHeaders() },
      );
    await expect(
      discoverOidcProvider({
        issuer: "https://issuer.example",
        clientId: "chat-web",
        discoveryEndpoint: "https://metadata.example/configuration",
        fetch: (url) => {
          expect(url).toBe("https://metadata.example/configuration");
          return Promise.resolve(metadata("https://issuer.example"));
        },
      }),
    ).resolves.toMatchObject({
      authorizationEndpoint: "https://issuer.example/authorize",
      recommendedScopes: ["openid"],
    });
    await expect(
      createGoogleProvider({
        clientId: "chat-web",
        fetch: () => Promise.resolve(metadata("https://accounts.google.com")),
      }),
    ).resolves.toMatchObject({
      authorizationEndpoint: "https://accounts.google.com/authorize",
      recommendedScopes: ["openid", "profile", "email"],
    });
  });

  it("does not allow a runtime-only option to replace Google's discovery endpoint", async () => {
    const urls: string[] = [];
    await createGoogleProvider({
      clientId: "chat-web",
      discoveryEndpoint: "https://attacker.example/configuration",
      fetch: (url) => {
        urls.push(url);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              issuer: "https://accounts.google.com",
              authorization_endpoint: "https://accounts.google.com/authorize",
              token_endpoint: "https://accounts.google.com/token",
              jwks_uri: "https://accounts.google.com/keys",
            }),
            { headers: jsonHeaders() },
          ),
        );
      },
    } as Parameters<typeof createGoogleProvider>[0] & { discoveryEndpoint: string });
    expect(urls).toEqual(["https://accounts.google.com/.well-known/openid-configuration"]);
  });

  it.each(["client_secret_post", "client_secret_basic"] as const)(
    "uses %s token endpoint authentication",
    async (clientAuthentication) => {
      const provider = oidcProvider(
        (_url, init) => {
          const headers = new Headers(init?.headers);
          const requestBody = init?.body;
          if (!(requestBody instanceof URLSearchParams))
            throw new Error("expected URL-encoded request body");
          const body = requestBody.toString();
          if (clientAuthentication === "client_secret_post") {
            expect(body).toContain("client_secret=secret");
            expect(headers.has("authorization")).toBe(false);
          } else {
            expect(headers.get("authorization")).toBe(
              `Basic ${Buffer.from("chat-web:secret").toString("base64")}`,
            );
            expect(body).not.toContain("client_secret");
          }
          return Promise.resolve(new Response(JSON.stringify({}), { headers: jsonHeaders() }));
        },
        { clientAuthentication, clientSecret: "secret" },
      );
      await expect(
        provider.provider.exchangeAuthorizationCode(exchangeInput()),
      ).resolves.toBeUndefined();
    },
  );

  it.each([
    ["non-HTTPS issuer", { issuer: "http://issuer.example" }],
    ["credentialed endpoint", { tokenEndpoint: "https://user@issuer.example/token" }],
    ["empty client", { clientId: "" }],
    ["invalid response cap", { maxResponseBytes: 0 }],
    ["invalid timeout", { timeoutMilliseconds: Number.NaN }],
    ["missing POST client secret", { clientAuthentication: "client_secret_post" as const }],
    ["missing Basic client secret", { clientAuthentication: "client_secret_basic" as const }],
    ["non-string unused client secret", { clientSecret: 42 as never }],
    ["oversized unused client secret", { clientSecret: "s".repeat(4097) }],
    ["unknown client authentication", { clientAuthentication: "unknown" as never }],
  ])("rejects %s configuration", (_label, overrides) => {
    expect(() => oidcProvider(() => Promise.resolve(new Response("{}")), overrides)).toThrow(
      TypeError,
    );
  });

  it("refreshes JWKS once for a rotated key and then caches it", async () => {
    const fixture = await signedFixture();
    let call = 0;
    const provider = oidcProvider(() => {
      call++;
      const body =
        call === 1 || call === 4
          ? { id_token: fixture.token }
          : call === 2
            ? { keys: [{ ...fixture.jwk, kid: "old" }] }
            : { keys: [fixture.jwk] };
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          headers: jsonHeaders({ "cache-control": "max-age=60" }),
        }),
      );
    });
    await expect(
      provider.provider.exchangeAuthorizationCode(exchangeInput()),
    ).resolves.toMatchObject({ subject: "user-42" });
    await expect(
      provider.provider.exchangeAuthorizationCode(exchangeInput()),
    ).resolves.toMatchObject({ subject: "user-42" });
    expect(call).toBe(4);
  });

  it("expires JWKS according to cache directives", async () => {
    const fixture = await signedFixture();
    let now = 1_000;
    let keyCalls = 0;
    const provider = oidcProvider(
      (url) => {
        const body = url.endsWith("/token") ? { id_token: fixture.token } : { keys: [fixture.jwk] };
        if (url.endsWith("/keys")) keyCalls++;
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            headers: jsonHeaders({ "cache-control": "max-age=1" }),
          }),
        );
      },
      { clock: () => now },
    );
    await expect(
      provider.provider.exchangeAuthorizationCode(exchangeInput()),
    ).resolves.toMatchObject({ subject: "user-42" });
    now = 2_001;
    await expect(
      provider.provider.exchangeAuthorizationCode(exchangeInput()),
    ).resolves.toMatchObject({ subject: "user-42" });
    expect(keyCalls).toBe(2);
  });

  it("shares one cold JWKS fetch across concurrent exchanges", async () => {
    const fixture = await signedFixture();
    let keyCalls = 0;
    let release: ((response: Response) => void) | undefined;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const provider = oidcProvider((url) => {
      if (url.endsWith("/token"))
        return Promise.resolve(
          new Response(JSON.stringify({ id_token: fixture.token }), {
            headers: jsonHeaders(),
          }),
        );
      keyCalls++;
      return pending;
    });
    const first = provider.provider.exchangeAuthorizationCode(exchangeInput());
    const second = provider.provider.exchangeAuthorizationCode(exchangeInput());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(keyCalls).toBe(1);
    release?.(
      new Response(JSON.stringify({ keys: [fixture.jwk] }), {
        headers: jsonHeaders({ "cache-control": "max-age=60" }),
      }),
    );
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it("keeps a shared JWKS fetch alive when only its first waiter aborts", async () => {
    const fixture = await signedFixture();
    let keyCalls = 0;
    let release: ((response: Response) => void) | undefined;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const provider = oidcProvider((url) => {
      if (url.endsWith("/token"))
        return Promise.resolve(
          new Response(JSON.stringify({ id_token: fixture.token }), {
            headers: jsonHeaders(),
          }),
        );
      keyCalls++;
      return pending;
    });
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = provider.provider.exchangeAuthorizationCode({
      ...exchangeInput(),
      signal: firstController.signal,
    });
    const second = provider.provider.exchangeAuthorizationCode({
      ...exchangeInput(),
      signal: secondController.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(keyCalls).toBe(1);
    firstController.abort();
    release?.(
      new Response(JSON.stringify({ keys: [fixture.jwk] }), {
        headers: jsonHeaders({ "cache-control": "max-age=60" }),
      }),
    );
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toMatchObject({ subject: "user-42" });
    expect(keyCalls).toBe(1);
  });

  it("cancels JWKS work after its final waiter aborts and permits a fresh fetch", async () => {
    const fixture = await signedFixture();
    let keyCalls = 0;
    let firstJwksSignal: AbortSignal | undefined;
    const provider = oidcProvider((url, init) => {
      if (url.endsWith("/token"))
        return Promise.resolve(
          new Response(JSON.stringify({ id_token: fixture.token }), {
            headers: jsonHeaders(),
          }),
        );
      keyCalls++;
      if (keyCalls === 1) {
        firstJwksSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => undefined);
      }
      return Promise.resolve(
        new Response(JSON.stringify({ keys: [fixture.jwk] }), {
          headers: jsonHeaders({ "cache-control": "max-age=60" }),
        }),
      );
    });
    const controller = new AbortController();
    const abandoned = provider.provider.exchangeAuthorizationCode({
      ...exchangeInput(),
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(keyCalls).toBe(1);
    controller.abort();
    await expect(abandoned).resolves.toBeUndefined();
    expect(firstJwksSignal?.aborted).toBe(true);
    await expect(
      provider.provider.exchangeAuthorizationCode(exchangeInput()),
    ).resolves.toMatchObject({ subject: "user-42" });
    expect(keyCalls).toBe(2);
  });

  it("does not consume or follow up a response which arrives after deadline", async () => {
    let calls = 0;
    let cancelled = false;
    const provider = oidcProvider(
      async () => {
        calls++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return new (class extends Response {
          override get body(): ReadableStream<Uint8Array<ArrayBuffer>> | null {
            return {
              cancel: () => {
                cancelled = true;
                return Promise.resolve();
              },
            } as ReadableStream<Uint8Array<ArrayBuffer>>;
          }
        })();
      },
      { timeoutMilliseconds: 5 },
    );
    await expect(
      provider.provider.exchangeAuthorizationCode(exchangeInput()),
    ).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(cancelled).toBe(true);
    expect(calls).toBe(1);
  });

  it("cancels a non-cooperative response stream at deadline", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => undefined),
      cancel() {
        cancelled = true;
      },
    });
    const provider = oidcProvider(
      () => Promise.resolve(new Response(body, { headers: jsonHeaders() })),
      {
        timeoutMilliseconds: 5,
      },
    );
    await expect(
      provider.provider.exchangeAuthorizationCode(exchangeInput()),
    ).resolves.toBeUndefined();
    expect(cancelled).toBe(true);
  });

  it.each([
    ["unsupported algorithm", { alg: "HS256", kid: "current" }],
    ["missing key identifier", { alg: "RS256" }],
    ["critical extension", { alg: "RS256", kid: "current", crit: ["unknown"] }],
  ])("rejects a JWT header with %s before key use", async (_label, header) => {
    const fixture = await signedFixture();
    const token = replaceHeader(fixture.token, header);
    let calls = 0;
    const provider = oidcProvider(() => {
      calls++;
      return Promise.resolve(
        new Response(JSON.stringify({ id_token: token }), { headers: jsonHeaders() }),
      );
    });
    await expect(
      provider.provider.exchangeAuthorizationCode(exchangeInput()),
    ).resolves.toBeUndefined();
    expect(calls).toBe(1);
  });

  it("rejects a mismatched client and an already-aborted exchange", async () => {
    let calls = 0;
    const provider = oidcProvider(() => {
      calls++;
      return Promise.resolve(new Response("{}", { headers: jsonHeaders() }));
    });
    await expect(
      provider.provider.exchangeAuthorizationCode({ ...exchangeInput(), clientId: "other" }),
    ).resolves.toBeUndefined();
    const controller = new AbortController();
    controller.abort();
    await expect(
      provider.provider.exchangeAuthorizationCode({
        ...exchangeInput(),
        signal: controller.signal,
      }),
    ).resolves.toBeUndefined();
    expect(calls).toBe(0);
  });

  it("does not retain a string-valued email verification claim", async () => {
    const result = await exchangeSigned({ emailVerified: "true" });
    expect(result).toMatchObject({ claims: {} });
    expect((result as { claims: Record<string, string> }).claims).not.toHaveProperty(
      "email_verified",
    );
  });
});

describe("GitHub provider", () => {
  it("retains exactly one verified primary email only when requested", async () => {
    const calls: string[] = [];
    const provider = createGitHubProvider({
      clientId: "chat-web",
      clientSecret: "secret",
      includeVerifiedPrimaryEmail: true,
      fetch: (url, init) => {
        calls.push(url);
        if (url.includes("api.github"))
          expect(init?.headers).toMatchObject({ "x-github-api-version": "2022-11-28" });
        const body = url.endsWith("access_token")
          ? { access_token: "provider-token", token_type: "bearer", scope: "read:user user:email" }
          : url.endsWith("/user")
            ? { id: 42 }
            : [{ email: "user@example.test", primary: true, verified: true }];
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            headers: { "content-type": "application/json" },
          }),
        );
      },
    });
    await expect(
      provider.provider.exchangeAuthorizationCode({
        code: "code",
        clientId: "chat-web",
        callbackUri: "https://app.example/callback",
        providerCodeVerifier: "v".repeat(43),
        expectedNonce: "nonce",
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      issuer: "https://github.com",
      subject: "42",
      claims: { email: "user@example.test" },
    });
    expect(calls).toEqual([
      "https://github.com/login/oauth/access_token",
      "https://api.github.com/user",
      "https://api.github.com/user/emails",
    ]);
  });
  it("uses a fresh stable numeric user identity and discards the access token", async () => {
    const calls: string[] = [];
    const provider = createGitHubProvider({
      clientId: "chat-web",
      clientSecret: "secret",
      fetch: (url) => {
        calls.push(url);
        if (url.includes("access_token"))
          return Promise.resolve(
            new Response(
              JSON.stringify({
                access_token: "provider-token",
                token_type: "bearer",
                scope: "read:user",
              }),
              { headers: { "content-type": "application/json" } },
            ),
          );
        return Promise.resolve(
          new Response(JSON.stringify({ id: 42, login: "mutable-login" }), {
            headers: { "content-type": "application/json" },
          }),
        );
      },
    });
    const result = await provider.provider.exchangeAuthorizationCode({
      code: "code",
      clientId: "chat-web",
      callbackUri: "https://app.example/callback",
      providerCodeVerifier: "v".repeat(43),
      expectedNonce: "nonce",
      signal: new AbortController().signal,
    });
    expect(result).toEqual({ issuer: "https://github.com", subject: "42" });
    expect(calls).toEqual([
      "https://github.com/login/oauth/access_token",
      "https://api.github.com/user",
    ]);
  });

  it.each([
    ["missing bearer token", { token: { scope: "read:user" } }],
    [
      "missing required scope",
      { token: { access_token: "provider-token", token_type: "bearer", scope: "user:email" } },
    ],
    ["unsafe user ID", { user: { id: Number.MAX_SAFE_INTEGER + 1 } }],
    ["missing user ID", { user: { login: "mutable" } }],
  ])("rejects %s", async (_label, scenario) => {
    const provider = githubProvider(scenario);
    await expect(
      provider.provider.exchangeAuthorizationCode(exchangeInput()),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["unverified", [{ email: "user@example.test", primary: true, verified: false }]],
    ["non-primary", [{ email: "user@example.test", primary: false, verified: true }]],
    [
      "ambiguous",
      [
        { email: "one@example.test", primary: true, verified: true },
        { email: "two@example.test", primary: true, verified: true },
      ],
    ],
    ["malformed", [{ email: "not-an-email", primary: true, verified: true }]],
  ])("rejects %s requested email identity", async (_label, emails) => {
    const provider = githubProvider({ emails }, true);
    await expect(
      provider.provider.exchangeAuthorizationCode(exchangeInput()),
    ).resolves.toBeUndefined();
  });

  it("settles when an injected GitHub client ignores abort", async () => {
    const provider = createGitHubProvider({
      clientId: "chat-web",
      clientSecret: "secret",
      timeoutMilliseconds: 5,
      fetch: () => new Promise<Response>(() => undefined),
    });
    await expect(
      Promise.race([
        provider.provider.exchangeAuthorizationCode(exchangeInput()),
        rejectAfter(100),
      ]),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["public base with enterprise API", "https://github.com", "https://github.example/api/v3"],
    ["enterprise base with public API", "https://github.example", "https://api.github.com"],
    [
      "unrelated enterprise origins",
      "https://github-one.example",
      "https://github-two.example/api/v3",
    ],
  ])("rejects mixed GitHub origins: %s", (_label, baseUrl, apiBaseUrl) => {
    expect(() =>
      createGitHubProvider({
        clientId: "chat-web",
        clientSecret: "secret",
        baseUrl,
        apiBaseUrl,
      }),
    ).toThrow(TypeError);
  });

  it.each([
    ["non-array email response", { email: "user@example.test" }],
    ["oversized email response", Array.from({ length: 65 }, () => ({ email: "x" }))],
  ])("rejects a %s", async (_label, emails) => {
    const provider = githubProvider({ emails }, true);
    await expect(
      provider.provider.exchangeAuthorizationCode(exchangeInput()),
    ).resolves.toBeUndefined();
  });

  it("accepts coherent GitHub Enterprise endpoints", () => {
    expect(
      createGitHubProvider({
        clientId: "chat-web",
        clientSecret: "secret",
        baseUrl: "https://github.example/",
        apiBaseUrl: "https://github.example/api/v3/",
      }),
    ).toMatchObject({
      authorizationEndpoint: "https://github.example/login/oauth/authorize",
    });
  });

  it.each([
    ["invalid API version", { apiVersion: "latest" }],
    ["empty scopes", { scopes: [] }],
    [
      "too many scopes",
      { scopes: Array.from({ length: 33 }, (_, index) => `scope-${String(index)}`) },
    ],
    ["whitespace in scope", { scopes: ["read:user extra"] }],
    ["non-array scopes", { scopes: new Set(["read:user"]) as never }],
    ["non-boolean email lookup", { includeVerifiedPrimaryEmail: "yes" as never }],
    ["oversized base URL", { baseUrl: `https://${"a".repeat(4090)}.example` }],
  ])("rejects %s configuration", (_label, overrides) => {
    expect(() =>
      createGitHubProvider({
        clientId: "chat-web",
        clientSecret: "secret",
        ...overrides,
      }),
    ).toThrow();
  });
});

interface SignedClaims {
  readonly issuer?: string;
  readonly audience?: string | readonly string[];
  readonly nonce?: string;
  readonly subject?: string | undefined;
  readonly expiration?: number;
  readonly notBefore?: number;
  readonly authorizedPresenter?: string;
  readonly emailVerified?: unknown;
}
interface KeyScenario {
  readonly keyId?: string;
  readonly duplicateKey?: boolean;
  readonly oversizedKeySet?: boolean;
  readonly keyAlgorithm?: string;
}

async function signedFixture(
  claims: SignedClaims = {},
): Promise<{ token: string; jwk: Record<string, unknown> }> {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = (await exportJWK(publicKey)) as Record<string, unknown>;
  Object.assign(jwk, { kid: "current", alg: "RS256", use: "sig" });
  let token = new SignJWT({
    nonce: claims.nonce ?? "nonce",
    ...(claims.authorizedPresenter ? { azp: claims.authorizedPresenter } : {}),
    ...(Object.hasOwn(claims, "emailVerified") ? { email_verified: claims.emailVerified } : {}),
  })
    .setProtectedHeader({ alg: "RS256", kid: "current", typ: "JWT" })
    .setIssuer(claims.issuer ?? "https://issuer.example")
    .setAudience(
      claims.audience === undefined
        ? "chat-web"
        : typeof claims.audience === "string"
          ? claims.audience
          : Array.from(claims.audience),
    )
    .setIssuedAt(1)
    .setExpirationTime(claims.expiration ?? 2_000_000_000);
  if (!Object.hasOwn(claims, "subject") || claims.subject !== undefined)
    token = token.setSubject(claims.subject ?? "user-42");
  if (claims.notBefore !== undefined) token = token.setNotBefore(claims.notBefore);
  return { token: await token.sign(privateKey), jwk };
}

async function exchangeSigned(claims: SignedClaims = {}, keys: KeyScenario = {}): Promise<unknown> {
  return exchangeFixture(await signedFixture(claims), keys);
}

async function exchangeFixture(
  fixture: { token: string; jwk: Record<string, unknown> },
  keys: KeyScenario = {},
): Promise<unknown> {
  const jwk = { ...fixture.jwk, alg: keys.keyAlgorithm ?? fixture.jwk.alg };
  const selected = {
    ...jwk,
    kid: keys.keyId ?? (fixture.jwk.kid as string | undefined),
  };
  const keySet = keys.oversizedKeySet
    ? Array.from({ length: 33 }, (_, index) => ({ ...jwk, kid: `key-${String(index)}` }))
    : keys.duplicateKey
      ? [selected, { ...selected }]
      : [selected];
  let call = 0;
  const provider = oidcProvider(() =>
    Promise.resolve(
      new Response(JSON.stringify(++call === 1 ? { id_token: fixture.token } : { keys: keySet }), {
        headers: jsonHeaders(),
      }),
    ),
  );
  return provider.provider.exchangeAuthorizationCode(exchangeInput());
}

function oidcProvider(
  fetch: (url: string, init?: RequestInit) => Promise<Response>,
  overrides: Partial<Parameters<typeof createOidcProvider>[0]> = {},
) {
  return createOidcProvider({
    issuer: "https://issuer.example",
    authorizationEndpoint: "https://issuer.example/authorize",
    tokenEndpoint: "https://issuer.example/token",
    jwksEndpoint: "https://issuer.example/keys",
    clientId: "chat-web",
    clock: () => 1_000,
    fetch,
    ...overrides,
  });
}

function exchangeInput() {
  return {
    code: "code",
    clientId: "chat-web",
    callbackUri: "https://app.example/callback",
    providerCodeVerifier: "v".repeat(43),
    expectedNonce: "nonce",
    signal: new AbortController().signal,
  } as const;
}

function githubProvider(
  scenario: {
    readonly token?: unknown;
    readonly user?: unknown;
    readonly emails?: unknown;
  },
  includeVerifiedPrimaryEmail = false,
) {
  return createGitHubProvider({
    clientId: "chat-web",
    clientSecret: "secret",
    includeVerifiedPrimaryEmail,
    fetch: (url) => {
      const body = url.endsWith("access_token")
        ? (scenario.token ?? {
            access_token: "provider-token",
            token_type: "bearer",
            scope: includeVerifiedPrimaryEmail ? "read:user user:email" : "read:user",
          })
        : url.endsWith("/user")
          ? (scenario.user ?? { id: 42 })
          : (scenario.emails ?? []);
      return Promise.resolve(new Response(JSON.stringify(body), { headers: jsonHeaders() }));
    },
  });
}

function jsonHeaders(extra: Record<string, string> = {}) {
  return { "content-type": "application/json", ...extra };
}

function replaceHeader(token: string, header: Record<string, unknown>): string {
  const [, payload, signature] = token.split(".");
  if (payload === undefined || signature === undefined) throw new Error("expected a JWT");
  return `${Buffer.from(JSON.stringify(header)).toString("base64url")}.${payload}.${signature}`;
}

async function rejectAfter(milliseconds: number): Promise<never> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
  throw new Error("Operation did not settle after abort.");
}
