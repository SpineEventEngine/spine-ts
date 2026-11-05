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

import { AsyncLocalStorage } from "node:async_hooks";
import { authorizationCodeRequest, getOAuth2Tokens } from "better-auth/oauth2";
import { genericOAuth as nativeGenericOAuth } from "better-auth/plugins/generic-oauth";
import { createAuthMiddleware } from "better-auth/api";
import type { BetterAuthPlugin } from "better-auth/types";
import type {
  GenericOAuthConfig,
  GenericOAuthUserInfo as OidcProfile,
} from "better-auth/plugins/generic-oauth";
import { createRemoteJWKSet, customFetch, decodeJwt } from "jose";

import type { GenericOAuthProvider } from "./generic-oauth.js";

/**
 * Callback-local transport and key resolution for the selected native OIDC flow.
 */
export class OidcNetwork {
  readonly #scope = new AsyncLocalStorage<OidcOperation>();

  readonly #metadata: ReadonlyMap<string, OidcMetadata>;

  readonly #transport: typeof fetch;

  /**
   * Captures the fully validated trusted discovery snapshot.
   *
   * @param metadata Provider metadata keyed by admitted provider ID.
   * @param transport Local transport reference captured before startup awaits.
   */
  private constructor(metadata: ReadonlyMap<string, OidcMetadata>, transport: typeof fetch) {
    this.#metadata = metadata;
    this.#transport = transport;
  }

  /**
   * Reads each admitted discovery document before publishing native routes.
   *
   * @param providers Detached and validated provider configurations.
   * @returns Callback transport with complete trusted metadata.
   */
  static async create(providers: readonly GenericOAuthProvider[]): Promise<OidcNetwork> {
    const transport = fetch;
    const entries = await Promise.all(
      providers.map(
        async (provider) =>
          [provider.providerId, await this.#discover(provider, transport)] as const,
      ),
    );
    return new OidcNetwork(new Map(entries), transport);
  }

  /**
   * Executes one admitted native request with a fresh key resolver map and lifetime.
   *
   * @param signal Effective host and integration cancellation signal.
   * @param work Native handler including any required compensation.
   * @param defaultErrorURL Trusted native default error destination for callbacks.
   * @param sessionCookieName Primary native session cookie name for callbacks.
   * @returns Native result or safe callback refusal; provider work observes the
   * effective signal while another callback retains its independent lifetime.
   */
  run(
    signal: AbortSignal,
    work: () => Promise<Response>,
    defaultErrorURL?: string,
    sessionCookieName?: string,
  ): Promise<Response> {
    return this.#scope.run({ signal, resolvers: new Map() }, async () => {
      const response = await work();
      if (defaultErrorURL === undefined) return response;
      return this.#callbackResponse(response, defaultErrorURL, sessionCookieName);
    });
  }

  /**
   * Builds the pinned native plugin with captured endpoint overrides and internal hooks.
   *
   * @param providers Detached admitted provider configurations.
   * @returns Native plugin whose init rejects incomplete or changed discovery.
   */
  plugin(providers: readonly GenericOAuthProvider[]): BetterAuthPlugin {
    const configurations = providers.map((provider) => this.#configuration(provider));
    const providerIds = new Set(providers.map((provider) => provider.providerId));
    const native: ReturnType<typeof nativeGenericOAuth> = nativeGenericOAuth({
      config: configurations,
    });
    const plugin: BetterAuthPlugin = {
      ...native,
      init: async (
        context: Parameters<ReturnType<typeof nativeGenericOAuth>["init"]>[0],
      ): Promise<Awaited<ReturnType<ReturnType<typeof nativeGenericOAuth>["init"]>>> => {
        const result = await native.init(context);
        for (const config of configurations) this.#bind(result.context.socialProviders, config);
        return result;
      },
      hooks: { before: [...native.hooks.before, this.#stateHook(providerIds)] },
    };
    return plugin;
  }

  /**
   * Installs a state-consumption gate only for an admitted native callback.
   *
   * @param providerIds Configured native OIDC provider IDs.
   * @returns Request-local public native hook.
   */
  #stateHook(providerIds: ReadonlySet<string>) {
    return {
      matcher: (
        ctx: Parameters<
          ReturnType<typeof nativeGenericOAuth>["hooks"]["before"][number]["matcher"]
        >[0],
      ) =>
        ctx.path === "/callback/:id" &&
        ctx.method === "GET" &&
        providerIds.has(ctx.params?.id ?? ""),
      handler: createAuthMiddleware((ctx) => {
        const scope = this.#scope.getStore();
        if (scope === undefined) throw new Error("No admitted OIDC callback.");
        return Promise.resolve(this.#stateContext(ctx.context, scope));
      }),
    };
  }

  /**
   * Replaces only one callback's native Verification deletion method.
   *
   * @param context Public native callback context.
   * @param scope Admitted callback lifetime and outcome.
   * @returns Native context patch with a private state-consumption gate.
   */
  #stateContext(context: NativeContext, scope: OidcOperation) {
    const original = context.internalAdapter;
    const adapter = context.adapter;
    return {
      context: {
        context: {
          internalAdapter: {
            ...original,
            deleteVerificationByIdentifier: (identifier: string) =>
              this.#consumeState(original, adapter, scope, identifier),
          },
        },
      },
    };
  }

  /**
   * Requires the public atomic consumption result before native code exchange.
   *
   * @param original Native adapter for unrelated identifier operations.
   * @param adapter Public native database adapter over Spine records.
   * @param scope Admitted callback lifetime and outcome.
   * @param identifier Native purpose-qualified Verification identifier.
   */
  async #consumeState(
    original: NativeContext["internalAdapter"],
    adapter: NativeContext["adapter"],
    scope: OidcOperation,
    identifier: string,
  ): Promise<void> {
    if (!identifier.startsWith("auth-state:") || identifier.length === 11)
      return original.deleteVerificationByIdentifier.call(original, identifier);
    this.#require(scope);
    try {
      const removed = await adapter.consumeOne({
        model: "verification",
        where: [{ field: "identifier", value: identifier, operator: "eq" }],
      });
      this.#require(scope);
      if (removed === null) {
        scope.outcome = "refused";
        throw new Error("OIDC state was already consumed.");
      }
    } catch (error) {
      if (scope.outcome !== "refused") scope.outcome = "unavailable";
      throw error;
    }
  }

  /**
   * Converts the native default error destination into a safe admitted response.
   *
   * @param response Completed native callback response.
   * @param defaultErrorURL Trusted native default error destination.
   * @param sessionCookieName Primary native session cookie name.
   * @returns Successful response or terminal safe login refusal.
   */
  #callbackResponse(
    response: Response,
    defaultErrorURL: string,
    sessionCookieName?: string,
  ): Response {
    const scope = this.#scope.getStore();
    if (scope === undefined) throw new Error("No admitted OIDC callback.");
    const issued = response.headers
      .getSetCookie()
      .some((cookie) => cookie.startsWith(`${sessionCookieName ?? ""}=`));
    if (issued && scope.outcome === undefined) return response;
    const location = response.headers.get("location");
    const target = location === null ? undefined : new URL(location, defaultErrorURL);
    const expected = new URL(defaultErrorURL);
    const defaultFailure =
      response.status >= 300 &&
      response.status < 400 &&
      target?.origin === expected.origin &&
      target.pathname === expected.pathname &&
      !!target.searchParams.get("error");
    if (!defaultFailure && scope.outcome === undefined) return response;
    const unavailable =
      scope.outcome === "unavailable" ||
      (scope.outcome === undefined &&
        target?.searchParams.get("error") === "internal_server_error");
    const headers = new Headers(response.headers);
    headers.delete("location");
    headers.delete("content-length");
    headers.set("content-type", "text/plain; charset=utf-8");
    return new Response(unavailable ? "Authentication unavailable" : "Authentication rejected", {
      status: unavailable ? 503 : 401,
      headers,
    });
  }

  /**
   * Validates one discovery response from the configured trusted URL.
   *
   * @param provider Captured provider options.
   * @param transport Local transport reference.
   * @returns Immutable selected issuer, endpoints and signing policy.
   */
  static async #discover(
    provider: GenericOAuthProvider,
    transport: typeof fetch,
  ): Promise<OidcMetadata> {
    const response = await transport(provider.discoveryUrl, { redirect: "manual" });
    if (!response.ok || response.status >= 300) throw new Error("OIDC discovery failed.");
    const value: unknown = await response.json();
    if (value === null || typeof value !== "object") throw new Error("Invalid OIDC discovery.");
    const data = value as Record<string, unknown>;
    const algorithms = data.id_token_signing_alg_values_supported;
    if (
      !Array.isArray(algorithms) ||
      algorithms.length === 0 ||
      algorithms.some((algorithm) => typeof algorithm !== "string" || algorithm.length === 0)
    )
      throw new Error("Invalid OIDC signing algorithms.");
    const jwks = new URL(this.#field(data, "jwks_uri"), provider.discoveryUrl);
    if (!this.#http(jwks)) throw new Error("Invalid OIDC discovery jwks_uri.");
    this.#endpoint(data, "issuer");
    return Object.freeze({
      issuer: this.#field(data, "issuer"),
      authorization: this.#endpoint(data, "authorization_endpoint"),
      token: this.#endpoint(data, "token_endpoint"),
      jwks: jwks.href,
      userinfo:
        data.userinfo_endpoint === undefined
          ? undefined
          : this.#endpoint(data, "userinfo_endpoint"),
      algorithms: Object.freeze([...(algorithms as string[])]),
    });
  }

  /**
   * Reads one required nonempty discovery string.
   *
   * @param data Parsed discovery object.
   * @param field Required metadata field.
   * @returns Selected field value.
   */
  static #field(data: Record<string, unknown>, field: string): string {
    const candidate = data[field];
    if (typeof candidate !== "string" || candidate.length === 0)
      throw new Error(`Invalid OIDC discovery ${field}.`);
    return candidate;
  }

  /**
   * Validates an absolute HTTP endpoint from the trusted discovery document.
   *
   * @param data Parsed discovery object.
   * @param field Required endpoint field.
   * @returns Selected endpoint URL.
   */
  static #endpoint(data: Record<string, unknown>, field: string): string {
    const url = new URL(this.#field(data, field));
    if (!this.#http(url)) throw new Error(`Invalid OIDC discovery ${field}.`);
    return url.href;
  }

  /**
   * Checks the selected endpoint URL scheme and credential absence.
   *
   * @param url Parsed discovery endpoint.
   * @returns Whether the endpoint has an admitted HTTP shape.
   */
  static #http(url: URL): boolean {
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      url.hash === ""
    );
  }

  /**
   * Supplies native token/profile hooks without accepting caller executable hooks.
   *
   * @param provider Captured provider options.
   * @returns Native configuration bound to trusted metadata.
   */
  #configuration(provider: GenericOAuthProvider): GenericOAuthConfig {
    const metadata = this.#metadata.get(provider.providerId);
    if (metadata === undefined) throw new Error("Missing trusted OIDC metadata.");
    return {
      ...provider,
      authorizationUrl: metadata.authorization,
      tokenUrl: metadata.token,
      ...(metadata.userinfo === undefined ? {} : { userInfoUrl: metadata.userinfo }),
      getToken: async (data) => this.#token(provider, metadata, data),
      getUserInfo: async (tokens) => this.#profile(metadata, tokens),
    };
  }

  /**
   * Requires native's original provider to match the trusted metadata snapshot.
   *
   * @param providers Native initialized provider array.
   * @param config Internal native provider configuration.
   */
  #bind(providers: readonly NativeProvider[], config: GenericOAuthConfig): void {
    const metadata = this.#metadata.get(config.providerId);
    const matches = providers.filter((candidate) => candidate.id === config.providerId);
    const provider = matches[0];
    const idToken = provider?.idToken;
    if (
      metadata === undefined ||
      matches.length !== 1 ||
      provider === undefined ||
      idToken === undefined ||
      !("jwks" in idToken) ||
      provider.issuer !== metadata.issuer ||
      idToken.issuer !== metadata.issuer ||
      idToken.audience !== config.clientId ||
      !provider.requiresIdTokenNonce ||
      typeof idToken.jwks !== "function" ||
      JSON.stringify(idToken.algorithms) !== JSON.stringify(metadata.algorithms)
    )
      throw new Error("Native OIDC provider metadata changed or is incomplete.");
    idToken.jwks = async (...arguments_) => this.#key(config.providerId, metadata, arguments_);
  }

  /**
   * Selects a fresh resolver for this callback and verifies cancellation after resolution.
   *
   * @param id Stable configured provider ID.
   * @param metadata Trusted key location.
   * @param arguments_ Native jose header and payload arguments.
   * @returns Selected verification key.
   */
  async #key(
    id: string,
    metadata: OidcMetadata,
    arguments_: Parameters<ReturnType<typeof createRemoteJWKSet>>,
  ): Promise<Awaited<ReturnType<ReturnType<typeof createRemoteJWKSet>>>> {
    const scope = this.#live();
    let resolver = scope.resolvers.get(id);
    if (resolver === undefined) {
      resolver = createRemoteJWKSet(new URL(metadata.jwks), {
        [customFetch]: (url, init) => this.#request(scope, url, init),
      });
      scope.resolvers.set(id, resolver);
    }
    const key = await resolver(...arguments_);
    this.#require(scope);
    return key;
  }

  /**
   * Exchanges one native authorization code through the callback's transport.
   *
   * @param provider Captured client and authentication policy.
   * @param metadata Captured token endpoint.
   * @param data Native code, verifier and redirect input.
   * @returns Native converted tokens, including a mandatory ID token.
   */
  async #token(
    provider: GenericOAuthProvider,
    metadata: OidcMetadata,
    data: Parameters<NonNullable<GenericOAuthConfig["getToken"]>>[0],
  ) {
    const scope = this.#live();
    const request = await authorizationCodeRequest({
      ...data,
      options: { clientId: provider.clientId, clientSecret: provider.clientSecret },
      tokenEndpoint: metadata.token,
      tokenEndpointAuth: provider.tokenEndpointAuth,
      authentication: provider.authentication,
    });
    this.#require(scope);
    const response = await this.#request(scope, metadata.token, {
      method: "POST",
      headers: request.headers,
      body: request.body,
      redirect: "manual",
    });
    if (!response.ok || response.status >= 300) throw new Error("OIDC token exchange failed.");
    const value: unknown = await response.json();
    this.#require(scope);
    if (value === null || typeof value !== "object")
      throw new Error("Invalid OIDC token response.");
    const tokens = getOAuth2Tokens(value as Record<string, unknown>);
    if (typeof tokens.idToken !== "string" || tokens.idToken.length === 0)
      throw new Error("OIDC ID token is required.");
    return tokens;
  }

  /**
   * Returns verified ID-token claims or reads the captured userinfo endpoint.
   *
   * @param metadata Captured optional userinfo endpoint.
   * @param tokens Native tokens after mandatory ID-token verification.
   * @returns Complete provider profile or absence.
   */
  async #profile(
    metadata: OidcMetadata,
    tokens: Parameters<NonNullable<GenericOAuthConfig["getUserInfo"]>>[0],
  ): Promise<OidcProfile | null> {
    const scope = this.#live();
    if (typeof tokens.idToken !== "string") throw new Error("OIDC ID token is required.");
    const claims = decodeJwt(tokens.idToken);
    if (typeof claims.sub !== "string" || claims.sub.length === 0)
      throw new Error("OIDC subject is required.");
    if (typeof claims.email === "string")
      return {
        ...claims,
        sub: claims.sub,
        email: claims.email,
        emailVerified: claims.email_verified === true,
      };
    if (metadata.userinfo === undefined || typeof tokens.accessToken !== "string") return null;
    const response = await this.#request(scope, metadata.userinfo, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      redirect: "manual",
    });
    if (!response.ok || response.status >= 300) throw new Error("OIDC userinfo failed.");
    const value: unknown = await response.json();
    this.#require(scope);
    if (value === null || typeof value !== "object") throw new Error("Invalid OIDC userinfo.");
    const profile = value as Record<string, unknown>;
    if (typeof profile.sub !== "string" || profile.sub.length === 0)
      throw new Error("Invalid OIDC userinfo subject.");
    return {
      ...profile,
      sub: profile.sub,
      emailVerified: profile.email_verified === true || profile.emailVerified === true,
    };
  }

  /**
   * Fetches one provider response with the exact callback lifetime attached.
   *
   * @param scope Current callback state captured before asynchronous work.
   * @param url Captured trusted endpoint or jose selected key URL.
   * @param init Native request options and optional jose timeout signal.
   * @returns Provider response whose body remains abortable.
   */
  async #request(
    scope: OidcOperation,
    url: string | URL,
    init: RequestInit = {},
  ): Promise<Response> {
    this.#require(scope);
    const signal =
      init.signal === undefined || init.signal === null
        ? scope.signal
        : AbortSignal.any([scope.signal, init.signal]);
    const response = await this.#transport(url, { ...init, signal, redirect: "manual" });
    this.#require(scope);
    return response;
  }

  /**
   * Requires an admitted live callback and rejects cancellation.
   *
   * @returns Current callback state.
   */
  #live(): OidcOperation {
    const scope = this.#scope.getStore();
    if (scope === undefined) throw new Error("No admitted OIDC callback.");
    this.#require(scope);
    return scope;
  }

  /**
   * Fences work after callback cancellation.
   *
   * @param scope Captured callback state.
   */
  #require(scope: OidcOperation): void {
    if (scope.signal.aborted) throw scope.signal.reason ?? new Error("OIDC callback cancelled.");
  }
}

/**
 * Trusted discovery fields used by one configured provider.
 */
interface OidcMetadata {
  readonly issuer: string;
  readonly authorization: string;
  readonly token: string;
  readonly jwks: string;
  readonly userinfo: string | undefined;
  readonly algorithms: readonly string[];
}

/**
 * One admitted callback's signal and mutable resolver cache.
 */
interface OidcOperation {
  readonly signal: AbortSignal;
  readonly resolvers: Map<string, ReturnType<typeof createRemoteJWKSet>>;
  outcome?: "refused" | "unavailable";
}

/**
 * Public native generated provider fields checked at initialization.
 */
type NativeProvider = Awaited<
  ReturnType<ReturnType<typeof nativeGenericOAuth>["init"]>
>["context"]["socialProviders"][number];

/**
 * Public native callback context used for the request-local adapter patch.
 */
type NativeContext = Parameters<ReturnType<typeof nativeGenericOAuth>["init"]>[0];
