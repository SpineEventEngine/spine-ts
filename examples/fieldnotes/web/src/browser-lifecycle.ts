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

import { FieldnotesBrowserAuth, type BrowserPrincipal } from "./browser-auth";
import { FieldnotesFirebaseBrowser } from "./firebase-browser";
import type { PublicConfig } from "./public-config";

/**
 * App-auth operations needed by the browser lifecycle.
 */
export interface BrowserAuthPort {
  /**
   * Returns the current opaque app session.
   *
   * @returns Verified principal or null.
   */
  session(): Promise<BrowserPrincipal | null>;

  /**
   * Starts direct Google authorization.
   *
   * @returns Fixed provider navigation URL.
   */
  startGoogle(): Promise<URL>;

  /**
   * Posts a Firebase ID token for an app session.
   *
   * @param token Verified Firebase ID token candidate.
   * @returns Whether an app session was established.
   */
  exchangeFirebase(token: string): Promise<boolean>;

  /**
   * Closes the current app session.
   *
   * @returns Whether revocation was confirmed.
   */
  logout(): Promise<boolean>;

  /**
   * Clears a pending Google verifier after cancellation or disposal.
   */
  clearPendingGoogle(): void;
}

/**
 * Popup operations needed while Firebase identity is selected.
 */
export interface FirebasePopupPort {
  /**
   * Returns a fresh provider ID token.
   *
   * @returns Fresh Firebase token.
   */
  googleToken(): Promise<string>;

  /**
   * Clears SDK identity after a failed exchange or logout.
   *
   * @returns Completion after SDK sign-out.
   */
  clear(): Promise<void>;

  /**
   * Closes the SDK app after browser shell disposal.
   *
   * @returns Completion after Firebase resources close.
   */
  close(): Promise<void>;
}

/**
 * Narrow browser capabilities replaceable for concurrency tests.
 */
export interface LifecycleDependencies {
  /**
   * App-auth boundary, defaulting to same-origin fetch.
   */
  readonly auth?: BrowserAuthPort;

  /**
   * Creates the Firebase popup for the selected public project.
   *
   * @returns Popup adapter.
   */
  readonly firebase?: () => FirebasePopupPort;

  /**
   * Opens the fixed provider origin.
   *
   * @param url Verified provider URL.
   */
  readonly navigate?: (url: URL) => void;
}

/**
 * Browser identity state emitted after app-session checks.
 */
export interface IdentityView {
  /**
   * Session state before protected data is mounted.
   */
  readonly phase: "loading" | "signed-out" | "ready";

  /**
   * Host-verified principal, present only when ready.
   */
  readonly principal: BrowserPrincipal | null;

  /**
   * Generic error safe to show to the browser user.
   */
  readonly error: string | null;
}

/**
 * Gates private app state on the current opaque session and cancels stale work.
 */
export class FieldnotesBrowserLifecycle {
  readonly #auth: BrowserAuthPort;

  readonly #firebaseFactory: () => FirebasePopupPort;

  readonly #navigate: (url: URL) => void;

  #firebase: FirebasePopupPort | null = null;

  #abort = new AbortController();

  #generation = 0;

  #signingInAt: number | null = null;

  #closed = false;

  #loggingOut = false;

  /**
   * Connects fixed browser capabilities and public provider configuration.
   *
   * @param config Safe provider settings passed from the server page.
   * @param onView Receives privacy-fenced identity state.
   * @param dependencies Optional app-specific browser test boundaries.
   */
  constructor(
    private readonly config: PublicConfig,
    private readonly onView: (view: IdentityView) => void,
    dependencies: LifecycleDependencies = {},
  ) {
    this.#auth =
      dependencies.auth ??
      new FieldnotesBrowserAuth(
        (request) => fetch(request, { signal: this.#abort.signal }),
        () => document.cookie,
        {
          get: (key) => window.sessionStorage.getItem(key) ?? undefined,
          set: (key, value) => {
            window.sessionStorage.setItem(key, value);
          },
          delete: (key) => {
            window.sessionStorage.removeItem(key);
          },
        },
        window.location.origin,
      );
    this.#firebaseFactory =
      dependencies.firebase ??
      (() => {
        if (config.mode !== "firebase") throw new Error("Firebase is not selected.");
        return new FieldnotesFirebaseBrowser(config.firebase);
      });
    this.#navigate =
      dependencies.navigate ??
      ((url) => {
        window.location.assign(url.href);
      });
  }

  /**
   * Resolves the app session before mounting any private collection.
   *
   * @returns Completion after the initial session check.
   */
  async start(): Promise<void> {
    if (this.#closed || this.#loggingOut) return;
    const current = this.#generation;
    try {
      const principal = await this.#auth.session();
      if (current !== this.#generation) return;
      this.onView({ phase: principal === null ? "signed-out" : "ready", principal, error: null });
    } catch {
      if (current !== this.#generation) return;
      this.onView({
        phase: "signed-out",
        principal: null,
        error: "Session check failed. Please retry.",
      });
    }
  }

  /**
   * Starts direct Google navigation or Firebase popup and host exchange.
   *
   * @returns Completion after navigation start or app-session verification.
   */
  async signIn(): Promise<void> {
    if (this.#closed || this.#loggingOut || this.#signingInAt === this.#generation) return;
    const current = this.#generation;
    this.#signingInAt = current;
    try {
      if (this.config.mode === "google") {
        const url = await this.#auth.startGoogle();
        if (current === this.#generation) this.#navigate(url);
        return;
      }
      await this.signInFirebase(current);
    } catch {
      if (current === this.#generation) {
        try {
          await this.#firebase?.clear();
        } catch {
          /* Host session remains the authority. */
        }
        if (current === this.#generation)
          this.onView({
            phase: "signed-out",
            principal: null,
            error: "Sign-in failed. Please try again.",
          });
      }
    } finally {
      if (this.#signingInAt === current) this.#signingInAt = null;
    }
  }

  /**
   * Performs one Firebase popup exchange for a verified app session.
   *
   * @param current Browser lifecycle generation at sign-in start.
   * @returns Completion after the verified principal is published.
   */
  private async signInFirebase(current: number): Promise<void> {
    const sdk = this.#firebase ?? this.#firebaseFactory();
    this.#firebase = sdk;
    const token = await sdk.googleToken();
    if (current !== this.#generation) return;
    if (!(await this.#auth.exchangeFirebase(token))) throw new Error("Firebase exchange failed.");
    if (current !== this.#generation) return;
    const principal = await this.#auth.session();
    if (principal === null) throw new Error("App session absent.");
    if (current === this.#generation) this.onView({ phase: "ready", principal, error: null });
  }

  /**
   * Clears private data immediately, cancels older work and requests revocation.
   *
   * @returns Completion after logout is reported accurately.
   */
  async logout(): Promise<void> {
    if (this.#closed || this.#loggingOut) return;
    this.#loggingOut = true;
    const current = ++this.#generation;
    this.#auth.clearPendingGoogle();
    this.#abort.abort();
    this.#abort = new AbortController();
    this.onView({ phase: "signed-out", principal: null, error: null });
    try {
      let revoked = false;
      try {
        revoked = await this.#auth.logout();
      } catch {
        /* The host did not confirm revocation. */
      }
      if (!revoked && current === this.#generation) this.logoutFailure();
      try {
        await this.#firebase?.clear();
      } catch {
        /* Private state is already hidden. */
      }
    } finally {
      this.#loggingOut = false;
    }
  }

  /**
   * Notifies the browser of unconfirmed revocation without reopening protected state.
   */
  private logoutFailure(): void {
    this.onView({
      phase: "signed-out",
      principal: null,
      error: "Logout could not be confirmed. Please retry.",
    });
  }

  /**
   * Closes outstanding browser work and releases the Firebase SDK.
   *
   * @returns Completion after browser SDK disposal.
   */
  async close(): Promise<void> {
    this.#closed = true;
    this.#generation++;
    this.#auth.clearPendingGoogle();
    this.#abort.abort();
    await this.#firebase?.close().catch(() => undefined);
    this.#firebase = null;
  }
}
