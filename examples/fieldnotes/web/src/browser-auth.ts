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

import { calculatePKCECodeChallenge, generateRandomCodeVerifier } from "oauth4webapi";

/**
 * Minimal session-scoped verifier store used during direct Google navigation.
 */
export interface VerifierStore {
  /**
   * Reads a previously saved verifier.
   *
   * @param key Storage key for the pending flow.
   * @returns Saved verifier, if present.
   */
  get(key: string): string | undefined;

  /**
   * Stores a verifier for one browser navigation.
   *
   * @param key Storage key for the pending flow.
   * @param value Fresh PKCE verifier.
   * @returns Store-specific result.
   */
  set(key: string, value: string): unknown;

  /**
   * Deletes a verifier after either completion outcome.
   *
   * @param key Storage key for the pending flow.
   * @returns Store-specific result.
   */
  delete(key: string): unknown;
}

/**
 * Current application principal returned by the opaque-session host.
 */
export interface BrowserPrincipal {
  /**
   * Stable host identity used for author-only client access.
   */
  readonly id: string;
}

/**
 * Uses only same-origin application routes for session and provider exchange.
 */
export class FieldnotesBrowserAuth {
  /**
   * Session storage key for the pending direct Google verifier.
   */
  static readonly verifierKey = "fieldnotes.google.verifier";

  /**
   * Binds request and browser storage capabilities without retaining provider tokens.
   *
   * @param fetcher Same-origin browser fetch.
   * @param cookie Reads the current browser cookie string.
   * @param verifierStore Session-scoped PKCE verifier storage.
   * @param origin Current public application origin.
   */
  constructor(
    private readonly fetcher: (request: Request) => Promise<Response>,
    private readonly cookie: () => string,
    private readonly verifierStore: VerifierStore,
    private readonly origin: string,
  ) {}

  /**
   * Resolves the current opaque app session before any protected client work.
   *
   * @returns Current principal, or null when the cookie is absent or expired.
   */
  async session(): Promise<BrowserPrincipal | null> {
    const result = await this.post("/auth/session", {});
    if (result.status === 401) return null;
    if (!result.ok) throw new Error("Session check failed.");
    const body: unknown = await result.json();
    if (!this.principal(body)) throw new Error("Session response is invalid.");
    return body.principal;
  }

  /**
   * Starts direct Google PKCE without putting the verifier in a URL.
   *
   * @returns Validated Google authorization URL for top-level navigation.
   */
  async startGoogle(): Promise<URL> {
    const verifier = generateRandomCodeVerifier();
    this.verifierStore.set(FieldnotesBrowserAuth.verifierKey, verifier);
    try {
      const codeChallenge = await calculatePKCECodeChallenge(verifier);
      const response = await this.post("/auth/google/start", { codeChallenge });
      if (!response.ok) throw new Error("Google sign-in could not start.");
      const body: unknown = await response.json();
      if (!this.authorization(body)) throw new Error("Google sign-in response is invalid.");
      const url = new URL(body.authorizationUrl);
      if (url.protocol !== "https:" || url.hostname !== "accounts.google.com")
        throw new Error("Google sign-in destination is invalid.");
      return url;
    } catch (error) {
      this.verifierStore.delete(FieldnotesBrowserAuth.verifierKey);
      throw error;
    }
  }

  /**
   * Completes one fragment-only callback grant with the stored PKCE verifier.
   *
   * @param fragment Callback fragment removed from browser history by the page first.
   * @returns Whether the one-use grant created an app session.
   */
  async completeGoogle(fragment: string): Promise<boolean> {
    const verifier = this.verifierStore.get(FieldnotesBrowserAuth.verifierKey);
    this.verifierStore.delete(FieldnotesBrowserAuth.verifierKey);
    const params = new URLSearchParams(fragment.startsWith("#") ? fragment.slice(1) : "");
    if (params.get("result") === "failed") return false;
    const grants = params.getAll("grant");
    if (params.size !== 1 || grants.length !== 1 || !grants[0] || !verifier) return false;
    const response = await this.post("/auth/google/exchange", {
      grant: grants[0], codeVerifier: verifier,
    });
    return response.ok;
  }

  /**
   * Sends a Firebase SDK ID token for opaque application-cookie exchange.
   *
   * @param idToken Fresh browser Firebase token.
   * @returns Whether the host accepted the verified identity.
   */
  async exchangeFirebase(idToken: string): Promise<boolean> {
    const response = await this.post("/auth/firebase/exchange", { idToken });
    return response.ok;
  }

  /**
   * Calls durable app-session revocation before reporting logout success.
   *
   * @returns True only after the host confirms revocation.
   */
  async logout(): Promise<boolean> {
    const response = await this.post("/auth/logout", {});
    return response.ok;
  }

  /**
   * Clears a pending Google verifier when browser identity work ends.
   */
  clearPendingGoogle(): void {
    this.verifierStore.delete(FieldnotesBrowserAuth.verifierKey);
  }

  /**
   * Sends the host's exact non-simple JSON gate and bound CSRF value.
   *
   * @param path Admitted app-auth route.
   * @param body Route-specific JSON object.
   * @returns Uncached same-origin response.
   */
  private post(path: string, body: object): Promise<Response> {
    const headers = new Headers({
      "content-type": "application/json",
      "x-fieldnotes-auth": "1",
    });
    const csrf = this.csrf();
    if (csrf !== undefined) headers.set("x-spine-csrf", csrf);
    return this.fetcher(new Request(new URL(path, this.origin), {
      method: "POST", headers, body: JSON.stringify(body), credentials: "same-origin",
      cache: "no-store",
    }));
  }

  /**
   * Reads exactly one host CSRF cookie value for credential-bound POSTs.
   *
   * @returns Cookie value or undefined before sign-in.
   */
  private csrf(): string | undefined {
    const values = this.cookie().split(";").map((part) => part.trim());
    const matches = values.filter((part) => part.startsWith("__Host-spine-csrf="));
    return matches.length === 1 ? matches[0]?.slice("__Host-spine-csrf=".length) : undefined;
  }

  /**
   * Validates the only principal shape the browser uses.
   *
   * @param value Untrusted session JSON.
   * @returns Whether it carries a stable principal identifier.
   */
  private principal(value: unknown): value is { principal: BrowserPrincipal } {
    if (typeof value !== "object" || value === null || !("principal" in value)) return false;
    const principal: unknown = value.principal;
    return typeof principal === "object" && principal !== null &&
      "id" in principal && typeof principal.id === "string" && principal.id.length > 0;
  }

  /**
   * Validates the direct provider start response.
   *
   * @param value Untrusted JSON response.
   * @returns Whether it carries an authorization URL.
   */
  private authorization(value: unknown): value is { authorizationUrl: string } {
    return typeof value === "object" && value !== null &&
      "authorizationUrl" in value && typeof value.authorizationUrl === "string";
  }
}
