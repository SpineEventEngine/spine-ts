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

import {
  OpaqueSessionCookies,
  OpaqueSessions,
  type RequestCredential,
} from "@spine-event-engine/auth";
import type { BrowserAuthRoute } from "@spine-event-engine/server/browser";
import { FieldnotesDirectOidc } from "./direct-oidc.js";
import { FieldnotesFirebaseIdentity } from "./firebase-auth.js";
import type { FieldnotesSettings } from "./host-settings.js";

/**
 * Exactly one application-selected identity source for auth routes.
 */
export type FieldnotesAuthSource =
  | {
      /**
       * Selects direct Google authorization.
       */
      readonly mode: "google";

      /**
       * Durable OIDC flow for this host.
       */
      readonly direct: FieldnotesDirectOidc;
    }
  | {
      /**
       * Selects Firebase Google authorization.
       */
      readonly mode: "firebase";

      /**
       * Verified Firebase identity adapter.
       */
      readonly firebase: FieldnotesFirebaseIdentity;
    };

/**
 * Builds exact bounded auth routes against the host's single opaque-session strategy.
 */
export class FieldnotesAuthRoutes {
  readonly #active = new Set<Promise<Response>>();

  #closed = false;

  /**
   * Binds the required policy and shared session resources.
   *
   * @param settings Explicit route origin and budgets.
   * @param sessions Shared persistent sessions.
   * @param cookies Shared credential-bound cookie helper.
   * @param source Selected identity source.
   */
  constructor(
    private readonly settings: FieldnotesSettings,
    private readonly sessions: OpaqueSessions,
    private readonly cookies: OpaqueSessionCookies,
    private readonly source: FieldnotesAuthSource,
  ) {}

  /**
   * Returns the fixed session, logout and selected provider routes.
   *
   * @returns BrowserServer route declarations.
   */
  routes(): readonly BrowserAuthRoute[] {
    const common = [
      this.route("POST", "/auth/session", (request, signal) => this.session(request, signal)),
      this.route("POST", "/auth/logout", (request, signal) => this.logout(request, signal)),
    ];
    if (this.source.mode === "firebase")
      return [
        ...common,
        this.route("POST", "/auth/firebase/exchange", (request, signal) =>
          this.firebaseExchange(request, signal),
        ),
      ];
    return [
      ...common,
      this.route("POST", "/auth/google/start", (request, signal) =>
        this.googleStart(request, signal),
      ),
      this.route(
        "GET",
        "/auth/google/callback",
        (request, signal) => this.googleCallback(request, signal),
        true,
      ),
      this.route("POST", "/auth/google/exchange", (request, signal) =>
        this.googleExchange(request, signal),
      ),
    ];
  }

  /**
   * Stops new auth work and drains callbacks left running after route cancellation.
   *
   * @returns Completion after admitted provider and session work settles.
   */
  async close(): Promise<void> {
    this.#closed = true;
    await Promise.allSettled([...this.#active]);
  }

  /**
   * Builds exact admission names for one bounded browser auth route.
   *
   * @param method HTTP method.
   * @param path Exact public route path.
   * @param onRequest Route callback.
   * @param allowMissingOrigin Only for provider callback navigation.
   * @returns Validated BrowserServer route shape.
   */
  private route(
    method: "GET" | "POST",
    path: string,
    onRequest: BrowserAuthRoute["onRequest"],
    allowMissingOrigin = false,
  ): BrowserAuthRoute {
    return {
      method,
      path,
      origins: [this.settings.publicOrigin],
      allowMissingOrigin,
      maxRequestBytes: this.settings.authRouteMaxBytes,
      timeoutMs: this.settings.authRouteTimeoutMs,
      admission: {
        csrfHeaderNames: [...this.cookies.admission.csrfHeaderNames, "x-fieldnotes-auth"],
        credentialCookieNames: this.cookies.admission.credentialCookieNames,
        stateCookieNames: this.cookies.admission.stateCookieNames,
      },
      onRequest: async (request, signal) => {
        if (this.#closed) return this.empty(503);
        const pending = Promise.resolve().then(() => onRequest(request, signal));
        this.#active.add(pending);
        try {
          return await pending;
        } finally {
          this.#active.delete(pending);
        }
      },
    };
  }

  /**
   * Returns only the current app principal and selected identity mode.
   *
   * @param request Same-origin request.
   * @param signal Route cancellation.
   * @returns No-store public identity response.
   */
  private async session(request: Request, signal: AbortSignal): Promise<Response> {
    if ((await this.postBody(request)) === undefined) return this.empty(403);
    const credential = await this.credential(request);
    if (credential === undefined) return this.empty(401);
    const operation = new AbortController();
    const onAbort = () => {
      operation.abort(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    let session;
    try {
      session = await this.sessions.resolve(credential, operation.signal);
    } finally {
      operation.abort();
      signal.removeEventListener("abort", onAbort);
    }
    if (session === undefined) return this.empty(401);
    return this.json({ authenticated: true, mode: this.source.mode, principal: session.principal });
  }

  /**
   * Removes the durable app session before clearing browser cookies.
   *
   * @param request CSRF-protected same-origin POST.
   * @param signal Route cancellation.
   * @returns Logout response after persistence succeeds.
   */
  private async logout(request: Request, signal: AbortSignal): Promise<Response> {
    if (!(await this.postBody(request))) return this.empty(403);
    const credential = await this.credential(request);
    if (credential === undefined) return this.empty(401);
    try {
      await this.sessions.logout(credential, signal);
    } catch {
      return this.empty(503);
    }
    const response = this.json({ loggedOut: true });
    for (const cookie of this.cookies.clear()) response.headers.append("set-cookie", cookie);
    return response;
  }

  /**
   * Creates one app session after Admin verifies a Firebase Google ID token.
   *
   * @param request Same-origin JSON POST.
   * @param signal Route cancellation.
   * @returns Opaque cookies or refusal.
   */
  private async firebaseExchange(request: Request, signal: AbortSignal): Promise<Response> {
    const body = await this.postBody(request);
    if (body === undefined) return this.empty(403);
    if (this.source.mode !== "firebase" || typeof body.idToken !== "string") return this.empty(400);
    let principal;
    try {
      principal = await this.source.firebase.verify(body.idToken);
    } catch {
      return this.empty(503);
    }
    signal.throwIfAborted();
    if (principal === undefined) return this.empty(401);
    const issued = await this.sessions.issue(principal, signal);
    if (issued.kind !== "created") return this.empty(503);
    if (signal.aborted) {
      await this.sessions.logout(issued.credential);
      signal.throwIfAborted();
    }
    return this.issued(issued.credential.value, issued.session.expiresAt);
  }

  /**
   * Starts a durable direct-Google flow with a browser-held PKCE challenge.
   *
   * @param request Same-origin JSON POST.
   * @param signal Route cancellation.
   * @returns Authorization URL without a session credential.
   */
  private async googleStart(request: Request, signal: AbortSignal): Promise<Response> {
    const body = await this.postBody(request);
    if (body === undefined) return this.empty(403);
    if (this.source.mode !== "google" || typeof body.codeChallenge !== "string")
      return this.empty(400);
    const result = await this.source.direct.flow.start(
      {
        browserCodeChallenge: body.codeChallenge,
        postLoginRedirect: `${this.settings.publicOrigin}/auth/complete`,
      },
      signal,
    );
    return result.kind === "started"
      ? this.json({ authorizationUrl: result.authorizationUrl })
      : this.empty(400);
  }

  /**
   * Processes one provider callback and redirects with a fragment-only grant.
   *
   * @param request Provider navigation callback.
   * @param signal Route cancellation.
   * @returns Fixed completion redirect or refusal.
   */
  private async googleCallback(request: Request, signal: AbortSignal): Promise<Response> {
    if (this.source.mode !== "google") return this.empty(404);
    const params = new URL(request.url).searchParams;
    if (["state", "code", "error", "iss"].some((name) => params.getAll(name).length > 1))
      return this.empty(400);
    const state = params.get("state");
    const code = params.get("code");
    const error = params.get("error");
    if (!state || (code === null) === (error === null)) return this.empty(400);
    const responseIssuer = params.get("iss");
    const issuer = responseIssuer === null ? {} : { responseIssuer };
    const result = await this.source.direct.flow.callback(
      code !== null ? { state, code, ...issuer } : { state, error: error ?? "", ...issuer },
      signal,
    );
    return result.kind === "granted" ? this.completion(result.grant) : this.completion();
  }

  /**
   * Returns a fixed browser completion redirect without provider query details.
   *
   * @param grant One-use grant after successful OIDC verification.
   * @returns No-store same-origin completion navigation.
   */
  private completion(grant?: string): Response {
    const destination = new URL(`${this.settings.publicOrigin}/auth/complete`);
    destination.hash =
      grant === undefined ? "result=failed" : new URLSearchParams({ grant }).toString();
    return new Response(null, {
      status: 303,
      headers: {
        location: destination.href,
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    });
  }

  /**
   * Processes a one-use application grant with the browser-held PKCE verifier.
   *
   * @param request Same-origin JSON POST.
   * @param signal Route cancellation.
   * @returns Opaque cookies or enumeration-safe refusal.
   */
  private async googleExchange(request: Request, signal: AbortSignal): Promise<Response> {
    const body = await this.postBody(request);
    if (body === undefined) return this.empty(403);
    if (
      this.source.mode !== "google" ||
      typeof body.grant !== "string" ||
      typeof body.codeVerifier !== "string"
    )
      return this.empty(400);
    const result = await this.source.direct.flow.exchange(
      { grant: body.grant, browserCodeVerifier: body.codeVerifier },
      signal,
    );
    return result.kind === "issued"
      ? this.issued(result.credential.value, result.session.expiresAt)
      : this.empty(401);
  }

  /**
   * Parses the non-simple same-origin JSON gate before accepting a login operation.
   *
   * @param request Bounded route request.
   * @returns JSON object or undefined for an invalid gate/body.
   */
  private async postBody(request: Request): Promise<Record<string, unknown> | undefined> {
    if (
      request.headers.get("x-fieldnotes-auth") !== "1" ||
      request.headers.get("content-type") !== "application/json"
    )
      return undefined;
    try {
      const body: unknown = await request.json();
      return typeof body === "object" && body !== null && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Reads one CSRF-verified cookie credential from framework-admitted headers.
   *
   * @param request Same-origin browser request.
   * @returns Valid cookie credential or undefined.
   */
  private async credential(request: Request): Promise<RequestCredential | undefined> {
    const headers = Object.fromEntries(request.headers.entries());
    const result = await this.cookies.read({
      headers,
      method: request.method,
      url: new URL(request.url),
    });
    return result?.kind === "cookie" ? result : undefined;
  }

  /**
   * Returns an issued session through Secure host-only cookies.
   *
   * @param credential Opaque sealed application credential.
   * @param expiresAt Authoritative app-session deadline.
   * @returns No-store authenticated response.
   */
  private issued(
    credential: string,
    expiresAt: Parameters<OpaqueSessionCookies["issue"]>[1],
  ): Response {
    const response = this.json({ authenticated: true, mode: this.source.mode });
    for (const cookie of this.cookies.issue(credential, expiresAt))
      response.headers.append("set-cookie", cookie);
    return response;
  }

  /**
   * Returns a bounded no-store JSON response.
   *
   * @param value Public response value.
   * @returns JSON response.
   */
  private json(value: unknown): Response {
    return Response.json(value, { headers: { "cache-control": "no-store" } });
  }

  /**
   * Returns a no-store empty error response.
   *
   * @param status HTTP refusal status.
   * @returns Empty refusal.
   */
  private empty(status: number): Response {
    return new Response(null, { status, headers: { "cache-control": "no-store" } });
  }
}
