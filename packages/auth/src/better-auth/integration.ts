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

import { betterAuth } from "better-auth";
import { genericOAuth as nativeGenericOAuth } from "better-auth/plugins/generic-oauth";
import {
  createCookieGetter,
  deleteSessionCookie,
  getCookies,
  parseSetCookieHeader,
  setSessionCookie,
} from "better-auth/cookies";
import type { AdapterFactory } from "better-auth/adapters";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { parseCookie } from "cookie";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Time } from "@spine-event-engine/core/time";

import {
  nativeFactoryFor,
  nativeSelectionFor,
  type BetterAuthUser,
  type PersistentBetterAuthStore,
} from "./persistent-store.js";
import { BetterAuthRecords } from "./record-codec.js";
import { NativeSignalContext } from "./native-adapter.js";
import { BetterAuthSettings } from "./settings.js";
import type { genericOAuth } from "./generic-oauth.js";
import type { AuthenticatedPrincipal, RequestCredential, ResolvedSession } from "../index.js";
import { SessionLifetimes, type SessionMonitor } from "../sessions/session-lifetime.js";

/**
 * Application-selected browser host bounds for every generated route.
 */
export interface BetterAuthRoutePolicy {
  /**
   * Maximum request body bytes within the host's supported range.
   */
  readonly maxRequestBytes: number;

  /**
   * Complete route deadline in milliseconds within the host's supported range.
   */
  readonly timeoutMs: number;
}

/**
 * Native options accepted by the bounded Better Auth session integration.
 */
export interface SupportedBetterAuthOptions {
  /**
   * Externally visible native authentication URL.
   */
  readonly baseURL: string;

  /**
   * Native route prefix.
   */
  readonly basePath?: string;

  /**
   * Native active signing secret.
   */
  readonly secret?: string;

  /**
   * Versioned native signing secrets, with the active entry first.
   */
  readonly secrets?: readonly { readonly version: number; readonly value: string }[];

  /**
   * Exact browser origins admitted for authentication.
   */
  readonly trustedOrigins: readonly string[];

  /**
   * Native session lifetime and renewal settings.
   */
  readonly session?: {
    readonly expiresIn?: number;
    readonly updateAge?: number;
    readonly disableSessionRefresh?: boolean;
    readonly freshAge?: number;
    readonly cookieCache?: { readonly enabled: false };
  };

  /**
   * Administrator-provisioned password policy.
   */
  readonly emailAndPassword?: {
    readonly enabled: true;
    readonly disableSignUp: true;
    readonly minPasswordLength?: number;
    readonly maxPasswordLength?: number;
    readonly password?: {
      readonly hash?: (password: string) => Promise<string>;
      readonly verify?: (data: { hash: string; password: string }) => Promise<boolean>;
    };
  };

  /**
   * Immutable prelinked Account policy.
   */
  readonly account?: AccountUpdatePolicy & {
    readonly accountLinking?: { readonly enabled: false };
  };

  /**
   * Disables native automatic Verification cleanup.
   */
  readonly verification?: { readonly disableCleanup: true };

  /**
   * Native cookie and schema preparation options.
   */
  readonly advanced?: {
    readonly cookiePrefix?: string;
    readonly cookies?: Readonly<Partial<Record<NativeCookieRole, CookieRoleOptions>>>;
    readonly defaultCookieAttributes?: CookieAttributes;
    readonly useSecureCookies?: true;
    readonly database?: { readonly validateSchema: false };
  };

  /**
   * Selected process-local native rate policy.
   */
  readonly rateLimit?: {
    readonly enabled?: boolean;
    readonly window?: number;
    readonly max?: number;
    readonly customRules?: Readonly<
      Record<
        string,
        | RateLimitRule
        | false
        | ((
            request: Request,
            rule: RateLimitRule,
          ) => RateLimitRule | false | Promise<RateLimitRule | false>)
      >
    >;
    readonly storage?: "memory";
  };

  /**
   * Supported native generic OAuth configuration selected for later OIDC routes.
   */
  readonly plugins?: readonly ReturnType<typeof genericOAuth>[];
}

/**
 * Native Account update setting retained with its exact upstream field name.
 */
type AccountUpdatePolicy = Readonly<Partial<Record<"updateAccountOnSignIn", false>>>;

/**
 * Supported native cookie attributes subject to browser policy validation.
 */
interface CookieAttributes {
  readonly domain?: string;
  readonly expires?: Date;
  readonly httpOnly?: boolean;
  readonly maxAge?: number;
  readonly path?: string;
  readonly secure?: boolean;
  readonly sameSite?: "Strict" | "Lax" | "None" | "strict" | "lax" | "none";
  readonly partitioned?: boolean;
  readonly prefix?: "host" | "secure";
}

/**
 * Five native cookie roles admitted by the bounded browser integration.
 */
type NativeCookieRole =
  "session_token" | "session_data" | "account_data" | "dont_remember" | "state";

/**
 * Optional name and safe attributes for one selected native cookie role.
 */
interface CookieRoleOptions {
  /**
   * Effective cookie name before native secure-prefix resolution.
   */
  readonly name?: string;

  /**
   * Browser attributes validated by the bounded profile.
   */
  readonly attributes?: CookieAttributes;
}

/**
 * Native process-local path rate rule.
 */
interface RateLimitRule {
  readonly window: number;
  readonly max: number;
}

/**
 * Trusted external login proof against a complete User directory.
 */
export interface BetterAuthVerifiedLogin {
  /**
   * Returns a verified stable User ID or absence for an admitted HTTP request.
   *
   * @param request Admitted browser request containing the application proof.
   * @param signal Host cancellation of the login route.
   * @returns Verified stable User ID or absence.
   */
  verify(request: Request, signal: AbortSignal): Promise<string | undefined>;
}

/**
 * Construction dependencies for the bounded native integration.
 */
export interface BetterAuthIntegrationOptions {
  /**
   * Selected prepared store supplied and closed by its host.
   */
  readonly store: PersistentBetterAuthStore;

  /**
   * Required host body and deadline bounds.
   */
  readonly routePolicy: BetterAuthRoutePolicy;

  /**
   * Native names and explicitly supported policy.
   */
  readonly options: SupportedBetterAuthOptions;

  /**
   * Maps a complete native User to an application principal.
   *
   * @param user Complete User from the selected source.
   * @param signal Current native session operation lifetime.
   * @returns Application principal or absence when no mapping applies.
   */
  readonly onPrincipal: (
    user: BetterAuthUser,
    signal: AbortSignal,
  ) => Promise<AuthenticatedPrincipal | undefined>;

  /**
   * Trusted external proof when using a read-only external User directory.
   */
  readonly login?: BetterAuthVerifiedLogin;
}

/**
 * Store and application callbacks captured before native initialization awaits.
 */
type NativeCollaborators = Pick<BetterAuthIntegrationOptions, "store" | "login" | "onPrincipal">;

/**
 * Fixed duplicate-sensitive names for a native reader or route.
 */
interface CredentialAdmission {
  readonly csrfHeaderNames: readonly string[];
  readonly credentialCookieNames: readonly string[];
  readonly stateCookieNames: readonly string[];
}

/**
 * Structural browser reader without an auth-to-server package dependency.
 */
export interface BetterAuthCredentialReader {
  /**
   * Cookie names admitted by the browser host before extraction.
   */
  readonly admission: CredentialAdmission;

  /**
   * Reads the native session cookie without establishing identity.
   *
   * @param request Immutable raw browser request facts.
   * @returns Cookie credential, rejection, or absence.
   */
  read(request: {
    readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
    readonly method: string;
    readonly url: URL;
  }): Promise<RequestCredential | undefined | { readonly kind: "rejected" }>;
}

/**
 * One exact native route admitted by the browser host.
 */
export interface BetterAuthRoute {
  /**
   * Exact HTTP method admitted for this native route.
   */
  readonly method: "GET" | "POST";

  /**
   * Exact path admitted for this native route.
   */
  readonly path: string;

  /**
   * Exact browser origins admitted by the host.
   */
  readonly origins: readonly string[];

  /**
   * Whether a browser callback without Origin is deliberately admitted.
   */
  readonly allowMissingOrigin?: boolean;

  /**
   * Maximum request body bytes checked by the host.
   */
  readonly maxRequestBytes: number;

  /**
   * Total route deadline checked by the host.
   */
  readonly timeoutMs: number;

  /**
   * Cookie and CSRF declarations checked before the route runs.
   */
  readonly admission: CredentialAdmission;

  /**
   * Handles the exact native operation after browser admission.
   *
   * @param request Admitted browser request.
   * @param signal Host cancellation and route deadline.
   * @returns Native route response or a safe terminal error response.
   */
  readonly onRequest: (request: Request, signal: AbortSignal) => Response | Promise<Response>;
}

/**
 * Bounded native Better Auth sessions and browser routes over a selected Spine store.
 */
export class BetterAuthIntegration {
  /**
   * Read-only native sessions used by RPC and Gateway admission.
   */
  readonly sessions: {
    resolve(
      credential: RequestCredential,
      lifetime?: AbortSignal,
    ): Promise<ResolvedSession | undefined>;
  };

  /**
   * Browser cookie reader with matching admission declarations.
   */
  readonly credentials: BetterAuthCredentialReader;

  /**
   * Immutable exact native routes admitted by BrowserServer.
   */
  readonly routes: readonly BetterAuthRoute[];

  /**
   * Native signed-cookie verification callback.
   */
  readonly #verify: (headers: Headers) => Promise<string | false | null>;

  /**
   * Native authoritative Session and User read callback.
   */
  readonly #read: (headers: Headers) => Promise<NativeSessionView | undefined>;

  /**
   * Application principal mapper captured at construction.
   */
  readonly #onPrincipal: BetterAuthIntegrationOptions["onPrincipal"];

  /**
   * Local active-session invalidation and expiry monitors.
   */
  readonly #lifetimes = new SessionLifetimes(Time.currentTimeMillis);

  /**
   * Integration-close signal used by reads without a host lifetime.
   */
  readonly #closedSignal = new AbortController();

  /**
   * Fence for newly admitted operations.
   */
  #closed = false;

  /**
   * Admitted operations still awaiting a collaborator.
   */
  #active = 0;

  /**
   * Completion callback when the active count reaches zero.
   */
  #drained: (() => void) | undefined;

  /**
   * Shared idempotent close result.
   */
  #closing: Promise<void> | undefined;

  /**
   * Binds private native operations to the published bounded surface.
   *
   * @param verify Native signed-cookie verification endpoint.
   * @param read Native authoritative Session and User read.
   * @param onPrincipal Application principal mapper.
   * @param credentials Browser cookie reader.
   * @param routes Exact browser routes.
   */
  private constructor(
    verify: (headers: Headers) => Promise<string | false | null>,
    read: (headers: Headers) => Promise<NativeSessionView | undefined>,
    onPrincipal: BetterAuthIntegrationOptions["onPrincipal"],
    credentials: BetterAuthCredentialReader,
    routes: readonly BetterAuthRoute[],
  ) {
    this.#verify = verify;
    this.#read = read;
    this.#onPrincipal = onPrincipal;
    this.sessions = Object.freeze({
      resolve: (credential: RequestCredential, lifetime?: AbortSignal) =>
        this.#resolve(credential, lifetime),
    });
    this.credentials = credentials;
    this.routes = routes;
  }

  /**
   * Validates and copies configuration before native asynchronous initialization.
   *
   * @param input Application store, policy and native configuration.
   * @returns Bounded integration with exact immutable routes.
   */
  static async create(input: BetterAuthIntegrationOptions): Promise<BetterAuthIntegration> {
    const policy = BetterAuthSettings.routePolicy(input.routePolicy);
    const options = BetterAuthSettings.options(input.options);
    const collaborators = NativeIntegrationSetup.collaborators(input);
    NativeIntegrationSetup.validate(collaborators, options);
    const nativeOptions = options as Parameters<typeof betterAuth>[0];
    const { cookies, admission } = NativeIntegrationSetup.admission(nativeOptions);
    // Assigned only after the native engine has initialized its private endpoints.
    // eslint-disable-next-line prefer-const
    let onInvalidate: ((token: string) => void) | undefined;
    const native = NativeIntegrationSetup.engine(collaborators.store, options, (token) => {
      onInvalidate?.(token);
    });
    await native.$context;
    const integration = this.#assemble(
      collaborators,
      options,
      policy,
      native,
      cookies.sessionToken.name,
      admission,
    );
    onInvalidate = (token) => {
      integration.#lifetimes.invalidate(token);
    };
    return integration;
  }

  /**
   * Binds initialized native operations to immutable browser routes and session reads.
   *
   * @param collaborators Captured application callbacks and selected store.
   * @param options Detached supported native options.
   * @param policy Captured host body and deadline bounds.
   * @param native Initialized native engine.
   * @param cookieName Resolved primary session cookie name.
   * @param admission Matching browser cookie declarations.
   * @returns Bounded native integration.
   */
  static #assemble(
    collaborators: NativeCollaborators,
    options: SupportedBetterAuthOptions,
    policy: BetterAuthRoutePolicy,
    native: ReturnType<typeof NativeIntegrationSetup.engine>,
    cookieName: string,
    admission: CredentialAdmission,
  ): BetterAuthIntegration {
    // The route callback starts only after this integration has been constructed.
    // eslint-disable-next-line prefer-const
    let integration!: BetterAuthIntegration;
    const actions = NativeIntegrationSetup.actions(native);
    const routes = this.#routeSet(
      collaborators.login,
      options,
      policy,
      admission,
      actions,
      cookieName,
      () => integration,
    );
    integration = new BetterAuthIntegration(
      (headers) => native.api.spineVerifiedToken({ headers }),
      NativeIntegrationSetup.read(native),
      collaborators.onPrincipal,
      NativeIntegrationSetup.reader(cookieName, admission),
      routes,
    );
    return integration;
  }

  /**
   * Binds exact browser routes to the integration created in the same factory call.
   *
   * @param login Optional trusted external verifier.
   * @param options Detached native options.
   * @param policy Captured host bounds.
   * @param admission Derived cookie declarations.
   * @param actions Selected private native operations.
   * @param cookieName Resolved primary native cookie name.
   * @param current Returns the initialized integration when a route runs.
   * @returns Immutable exact browser routes.
   */
  static #routeSet(
    login: BetterAuthVerifiedLogin | undefined,
    options: SupportedBetterAuthOptions,
    policy: BetterAuthRoutePolicy,
    admission: CredentialAdmission,
    actions: NativeRouteActions,
    cookieName: string,
    current: () => BetterAuthIntegration,
  ): readonly BetterAuthRoute[] {
    const prefix = options.basePath ?? "/api/auth";
    return NativeIntegrationSetup.routes(
      policy,
      options,
      admission,
      login !== undefined,
      (path, request, signal) => {
        const integration = current();
        const effective = AbortSignal.any([signal, integration.#closedSignal.signal]);
        return NativeSignalContext.run(effective, () =>
          integration.#run(() =>
            integration.#handleRoute(
              path,
              `${prefix}${path}`,
              request,
              effective,
              login,
              actions,
              cookieName,
            ),
          ),
        );
      },
    );
  }

  /**
   * Handles one exact native route and checks cancellation after awaited work.
   *
   * @param path Selected native operation path.
   * @param fullPath Exact admitted browser path.
   * @param request Admitted browser request.
   * @param signal Host route cancellation.
   * @param login Optional trusted external verifier.
   * @param actions Private native operations.
   * @param cookieName Resolved primary native cookie name.
   * @returns Native response or safe terminal response.
   */
  async #handleRoute(
    path: string,
    fullPath: string,
    request: Request,
    signal: AbortSignal,
    login: BetterAuthVerifiedLogin | undefined,
    actions: NativeRouteActions,
    cookieName: string,
  ): Promise<Response> {
    if (
      request.method !== (path === "/get-session" ? "GET" : "POST") ||
      new URL(request.url).pathname !== fullPath
    )
      return new Response("Not found", { status: 404 });
    try {
      if (signal.aborted) return new Response("Authentication cancelled", { status: 503 });
      const result = await this.#routeAction(path, request, signal, login, actions);
      if (this.#isCancelled(signal)) {
        await this.#compensateIssue(path, result, cookieName, actions);
        return new Response("Authentication cancelled", { status: 503 });
      }
      return result;
    } catch (error) {
      if (error instanceof APIError)
        return new Response("Authentication rejected", { status: error.statusCode });
      return new Response("Authentication unavailable", { status: 503 });
    }
  }

  /**
   * Dispatches only a selected native operation after synchronous route admission.
   *
   * @param path Selected native operation path.
   * @param request Admitted browser request.
   * @param signal Host route cancellation.
   * @param login Optional trusted external verifier.
   * @param actions Private native operations.
   * @returns Native response or safe login refusal.
   */
  async #routeAction(
    path: string,
    request: Request,
    signal: AbortSignal,
    login: BetterAuthVerifiedLogin | undefined,
    actions: NativeRouteActions,
  ): Promise<Response> {
    if (path === "/sign-in/external") {
      if (login === undefined) return new Response("Not found", { status: 404 });
      const id = await login.verify(request, signal);
      if (signal.aborted) return new Response("Authentication cancelled", { status: 503 });
      if (typeof id !== "string" || id.length === 0)
        return new Response("Authentication rejected", { status: 401 });
      return actions.external(id);
    }
    return path === "/sign-out" ? actions.logout(request.headers) : actions.handle(request);
  }

  /**
   * Revokes only a confirmed native issuance after late route cancellation.
   *
   * @param path Selected native operation path.
   * @param result Completed native response.
   * @param cookieName Resolved primary native cookie name.
   * @param actions Private native operations.
   */
  async #compensateIssue(
    path: string,
    result: Response,
    cookieName: string,
    actions: NativeRouteActions,
  ): Promise<void> {
    if (path !== "/sign-in/email" && path !== "/sign-in/external") return;
    const signed = NativeResponses.sessionCookie(result, cookieName);
    if (signed !== undefined) await actions.compensate(new Headers({ cookie: signed }));
  }

  /**
   * Closes local sessions and drains admitted work without closing the injected store.
   *
   * @returns Completion after pending admitted operations settle.
   */
  close(): Promise<void> {
    if (this.#closing !== undefined) return this.#closing;
    this.#closed = true;
    this.#closedSignal.abort();
    this.#lifetimes.close();
    this.#closing =
      this.#active === 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            this.#drained = resolve;
          });
    return this.#closing;
  }

  /**
   * Resolves a verified native cookie through the actual read-only native session endpoint.
   *
   * @param credential Native cookie credential.
   * @param lifetime Optional host operation lifetime.
   * @returns Valid mapped session or absence.
   */
  #resolve(
    credential: RequestCredential,
    lifetime?: AbortSignal,
  ): Promise<ResolvedSession | undefined> {
    return NativeSignalContext.run(lifetime ?? this.#closedSignal.signal, () =>
      this.#run(() => this.#resolveCookie(credential, lifetime)),
    );
  }

  /**
   * Registers a verified native token before its authoritative read.
   *
   * @param credential Native cookie credential.
   * @param lifetime Optional host operation lifetime.
   * @returns Mapped session or absence.
   */
  async #resolveCookie(
    credential: RequestCredential,
    lifetime?: AbortSignal,
  ): Promise<ResolvedSession | undefined> {
    if (credential.kind !== "cookie" || lifetime?.aborted) return undefined;
    const headers = new Headers({ cookie: credential.value });
    const token = await this.#verify(headers);
    if (!token || this.#closed || lifetime?.aborted) return undefined;
    const monitor = lifetime === undefined ? undefined : this.#lifetimes.register(token, lifetime);
    let successful = false;
    try {
      const signal = monitor?.signal ?? this.#closedSignal.signal;
      const result = await NativeSignalContext.run(signal, () =>
        this.#readSession(headers, token, monitor),
      );
      successful = result !== undefined;
      return result;
    } finally {
      if (!successful) monitor?.release();
    }
  }

  /**
   * Maps the current native Session and complete User after verification.
   *
   * @param headers Native cookie headers.
   * @param token Verified stable native session token.
   * @param monitor Optional operation lifetime monitor.
   * @returns Live mapped session or absence.
   */
  async #readSession(
    headers: Headers,
    token: string,
    monitor?: SessionMonitor,
  ): Promise<ResolvedSession | undefined> {
    const resolved = await this.#read(headers);
    if (resolved?.session.token !== token || this.#closed || monitor?.signal.aborted)
      return undefined;
    const user = BetterAuthRecords.decode(
      "user",
      BetterAuthRecords.encode("user", resolved.user as unknown as Record<string, unknown>),
    ) as unknown as BetterAuthUser;
    if (resolved.session.userId !== user.id) return undefined;
    const signal = monitor?.signal ?? this.#closedSignal.signal;
    const principal = await this.#onPrincipal(user, signal);
    if (principal === undefined || this.#isClosed() || signal.aborted) return undefined;
    const expiresAt = timestampFromDate(resolved.session.expiresAt);
    if (monitor !== undefined && !monitor.ready(expiresAt)) return undefined;
    if (resolved.session.expiresAt.getTime() <= Time.currentTimeMillis()) return undefined;
    return {
      principal,
      expiresAt,
      ...(monitor === undefined ? {} : { invalidated: monitor.signal }),
    };
  }

  /**
   * Tracks admitted native work until integration close has drained it.
   *
   * @typeParam T Result of the admitted operation.
   * @param work Native session work.
   * @returns Settled result after the close fence.
   */
  async #run<T>(work: () => Promise<T>): Promise<T> {
    if (this.#closed) throw new Error("Better Auth integration is closed.");
    this.#active++;
    try {
      return await work();
    } finally {
      this.#active--;
      if (this.#active === 0) this.#drained?.();
    }
  }

  /**
   * Reads closure after an awaited native or application collaborator.
   *
   * @returns Whether this integration has entered its close fence.
   */
  #isClosed(): boolean {
    return this.#closed;
  }

  /**
   * Reads cancellation after an awaited native or application collaborator.
   *
   * @param signal Admitted route lifetime.
   * @returns Whether the route must suppress its result.
   */
  #isCancelled(signal: AbortSignal): boolean {
    return signal.aborted || this.#closed;
  }
}

/**
 * Private selected native route operations, with no unrestricted handler export.
 */
interface NativeRouteActions {
  /**
   * Calls the native password or renewal handler behind an exact route.
   */
  readonly handle: (request: Request) => Promise<Response>;

  /**
   * Performs strict validated-cookie durable logout.
   */
  readonly logout: (headers: Headers) => Promise<Response>;

  /**
   * Creates a native session after trusted external identity proof.
   */
  readonly external: (id: string) => Promise<Response>;

  /**
   * Removes a confirmed late issuance after host cancellation.
   */
  readonly compensate: (headers: Headers) => Promise<void>;
}

/**
 * Checks bounded native configuration and constructs only private native endpoints.
 */
// Static methods keep the pinned native endpoint and cookie setup in one private boundary.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class NativeIntegrationSetup {
  /**
   * Creates the pinned native engine with only selected private plugins.
   *
   * @param store Selected prepared Spine record store.
   * @param options Detached supported native options.
   * @param onInvalidate Invalidates local monitors during strict logout.
   * @returns Actual native engine pending its asynchronous context initialization.
   */
  static engine(
    store: PersistentBetterAuthStore,
    options: SupportedBetterAuthOptions,
    onInvalidate: (token: string) => void,
  ) {
    const nativeOptions = options as Parameters<typeof betterAuth>[0];
    return betterAuth({
      ...nativeOptions,
      database: nativeFactoryFor(store) as AdapterFactory<Parameters<typeof betterAuth>[0]>,
      logger: { disabled: true },
      onAPIError: { throw: true },
      plugins: [
        ...(options.plugins?.map((plugin) => nativeGenericOAuth(plugin.options)) ?? []),
        this.plugin(onInvalidate),
      ],
    });
  }

  /**
   * Binds only selected native routes and confirmed cancellation cleanup.
   *
   * @param native Actual initialized native engine.
   * @returns Private native route operations.
   */
  static actions(native: ReturnType<typeof NativeIntegrationSetup.engine>): NativeRouteActions {
    return {
      handle: (request) => native.handler(request),
      logout: (headers) => native.api.spineStrictLogout({ headers, asResponse: true }),
      external: (id) =>
        native.api.spineExternalSession({
          headers: new Headers({ "x-spine-verified-user": id }),
          asResponse: true,
        }),
      compensate: async (headers) => {
        await native.api.spineStrictLogout({ headers });
      },
    };
  }

  /**
   * Binds the actual native authoritative Session read without refresh or cache.
   *
   * @param native Actual initialized native engine.
   * @returns Complete native Session and User, or absence.
   */
  static read(native: ReturnType<typeof NativeIntegrationSetup.engine>) {
    return async (headers: Headers): Promise<NativeSessionView | undefined> => {
      const result = await native.api.getSession({
        headers,
        query: { disableRefresh: true, disableCookieCache: true },
      });
      return result === null ? undefined : (result as NativeSessionView);
    };
  }

  /**
   * Captures validated callback identities and the selected store before startup awaits.
   *
   * @param input Caller-supplied integration dependencies.
   * @returns Stable callbacks with the verifier's required receiver retained.
   */
  static collaborators(input: BetterAuthIntegrationOptions): NativeCollaborators {
    const store = input.store;
    const onPrincipal = input.onPrincipal;
    const candidate: unknown = input.login;
    if (candidate === undefined) return { store, onPrincipal };
    if (candidate === null || typeof candidate !== "object")
      throw new TypeError("Trusted external login verifier is required.");
    const login = candidate as BetterAuthVerifiedLogin;
    // Capture the exact method, then bind its original receiver before any await.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const verify = login.verify;
    if (typeof verify !== "function")
      throw new TypeError("Trusted external login verifier is required.");
    return { store, onPrincipal, login: { verify: verify.bind(login) } };
  }

  /**
   * Checks selected physical and external User sources before native initialization.
   *
   * @param input Captured integration collaborators and selected store.
   * @param options Detached native options.
   */
  static validate(input: NativeCollaborators, options: SupportedBetterAuthOptions): void {
    if (
      input.login !== undefined &&
      (typeof input.login !== "object" || typeof input.login.verify !== "function")
    )
      throw new TypeError("Trusted external login verifier is required.");
    if (typeof input.onPrincipal !== "function") throw new TypeError("onPrincipal is required.");
    const selection = nativeSelectionFor(input.store);
    if (!selection.models.has("session"))
      throw new TypeError("Better Auth Session must be selected.");
    if (
      options.emailAndPassword !== undefined &&
      (!selection.models.has("account") ||
        (!selection.models.has("user") && !selection.externalEmail))
    )
      throw new TypeError("Password login requires selected User and Account records.");
    if (input.login !== undefined && !selection.externalUsers)
      throw new TypeError("External login requires a complete external User source.");
  }

  /**
   * Builds immutable admission names from effective native cookie options.
   *
   * @param options Detached native options.
   * @returns Native cookies and matching browser admission metadata.
   */
  static admission(options: Parameters<typeof betterAuth>[0]) {
    const cookies = getCookies(options);
    const state = createCookieGetter(options)("state");
    const supportingNames = [
      cookies.dontRememberToken.name,
      state.name,
      cookies.sessionData.name,
      cookies.accountData.name,
    ];
    const resolvedNames = [cookies.sessionToken.name, ...supportingNames];
    if (new Set(resolvedNames).size !== resolvedNames.length)
      throw new TypeError("Native cookie names must be distinct.");
    if (
      !cookies.sessionToken.attributes.httpOnly ||
      (cookies.sessionToken.attributes.path as unknown) !== "/"
    )
      throw new TypeError("Native session cookie must be HTTP-only on the root path.");
    const admission = Object.freeze({
      csrfHeaderNames: Object.freeze([] as string[]),
      credentialCookieNames: Object.freeze([cookies.sessionToken.name]),
      stateCookieNames: Object.freeze(supportingNames),
    });
    return { cookies, admission };
  }

  /**
   * Captures the exact immutable generated route set and host bounds.
   *
   * @param policy Application-supplied host body and deadline policy.
   * @param options Detached supported native options.
   * @param admission Derived native cookie declarations.
   * @param external Whether a trusted external verifier was supplied.
   * @param onRoute Runs one selected native operation.
   * @returns Exact immutable browser routes.
   */
  static routes(
    policy: BetterAuthRoutePolicy,
    options: SupportedBetterAuthOptions,
    admission: CredentialAdmission,
    external: boolean,
    onRoute: (path: string, request: Request, signal: AbortSignal) => Promise<Response>,
  ): readonly BetterAuthRoute[] {
    const prefix = options.basePath ?? "/api/auth";
    const origins = Object.freeze([...options.trustedOrigins]);
    const route = (path: string): BetterAuthRoute =>
      Object.freeze({
        method: path === "/get-session" ? "GET" : "POST",
        path: `${prefix}${path}`,
        origins,
        admission,
        maxRequestBytes: policy.maxRequestBytes,
        timeoutMs: policy.timeoutMs,
        onRequest: (request: Request, signal: AbortSignal) => onRoute(path, request, signal),
      });
    return Object.freeze([
      ...(options.emailAndPassword === undefined ? [] : [route("/sign-in/email")]),
      ...(external ? [route("/sign-in/external")] : []),
      route("/get-session"),
      route("/sign-out"),
    ]);
  }

  /**
   * Reads only the resolved native primary cookie from immutable raw facts.
   *
   * @param name Resolved primary native cookie name.
   * @param admission Matching browser cookie declarations.
   * @returns Browser reader without identity authority.
   */
  static reader(name: string, admission: CredentialAdmission): BetterAuthCredentialReader {
    return Object.freeze({
      admission,
      read: (request: Parameters<BetterAuthCredentialReader["read"]>[0]) => {
        const values = request.headers.cookie;
        const header = Array.isArray(values) ? values.join("; ") : values;
        if (typeof header !== "string") return Promise.resolve(undefined);
        const signed = parseCookie(header)[name];
        if (signed === undefined) return Promise.resolve(undefined);
        if (request.headers.authorization !== undefined)
          return Promise.resolve({ kind: "rejected" as const });
        return Promise.resolve({
          kind: "cookie" as const,
          value: `${name}=${encodeURIComponent(signed)}`,
        });
      },
    });
  }

  /**
   * Creates only the native endpoints used by the bounded integration.
   *
   * @param onInvalidate Invalidates local monitors before durable logout.
   * @returns Native plugin with private cookie, logout and external login endpoints.
   */
  static plugin(onInvalidate: (token: string) => void) {
    return {
      id: "spine-session-bridge",
      endpoints: {
        spineVerifiedToken: this.verifiedEndpoint(),
        spineStrictLogout: this.logoutEndpoint(onInvalidate),
        spineExternalSession: this.externalEndpoint(),
      },
    } as const;
  }

  /**
   * Verifies one signed native cookie without querying the Session row.
   *
   * @returns Private native verification endpoint.
   */
  static verifiedEndpoint() {
    return createAuthEndpoint(
      "/spine/verified-token",
      { method: "POST", requireHeaders: true },
      (ctx) => ctx.getSignedCookie(ctx.context.authCookies.sessionToken.name, ctx.context.secret),
    );
  }

  /**
   * Deletes one verified native Session after invalidating local monitors.
   *
   * @param onInvalidate Invalidates local monitors for the token.
   * @returns Private strict logout endpoint.
   */
  static logoutEndpoint(onInvalidate: (token: string) => void) {
    return createAuthEndpoint(
      "/spine/strict-logout",
      { method: "POST", requireHeaders: true },
      async (ctx) => {
        const token = await ctx.getSignedCookie(
          ctx.context.authCookies.sessionToken.name,
          ctx.context.secret,
        );
        if (!token) throw new APIError("UNAUTHORIZED");
        onInvalidate(token);
        await ctx.context.internalAdapter.deleteSession(token);
        deleteSessionCookie(ctx);
        return ctx.json({ success: true });
      },
    );
  }

  /**
   * Creates a native Session only after a trusted external verifier chooses a complete User.
   *
   * @returns Private native external login endpoint.
   */
  static externalEndpoint() {
    return createAuthEndpoint(
      "/spine/external-session",
      { method: "POST", requireHeaders: true },
      async (ctx) => {
        const id = ctx.headers.get("x-spine-verified-user");
        if (!id) throw new APIError("UNAUTHORIZED");
        const user = await ctx.context.internalAdapter.findUserById(id);
        if (!user) throw new APIError("UNAUTHORIZED");
        BetterAuthRecords.encode("user", user);
        const session = await ctx.context.internalAdapter.createSession(id, false);
        await setSessionCookie(ctx, { session, user }, false);
        return ctx.json({ success: true });
      },
    );
  }
}

/**
 * Complete native session and User returned by the actual native endpoint.
 */
interface NativeSessionView {
  readonly session: { readonly token: string; readonly userId: string; readonly expiresAt: Date };
  readonly user: BetterAuthUser;
}

/**
 * Selects a confirmed native session cookie from a completed issuance response.
 */
const NativeResponses = Object.freeze({
  /**
   * Returns the signed native cookie used for conditional cancellation cleanup.
   *
   * @param response Completed native issuance response.
   * @param name Resolved primary cookie name.
   * @returns Reusable Cookie field only after confirmed successful issuance.
   */
  sessionCookie(response: Response, name: string): string | undefined {
    if (!response.ok) return undefined;
    for (const header of response.headers.getSetCookie()) {
      const value = parseSetCookieHeader(header).get(name)?.value;
      if (value !== undefined) return `${name}=${encodeURIComponent(value)}`;
    }
    return undefined;
  },
});
