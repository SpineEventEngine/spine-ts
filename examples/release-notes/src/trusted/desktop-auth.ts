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

import { openLoopback, type LoopbackListener } from "./loopback.js";
import type { CredentialStore } from "./credential-store.js";
import type { ConnectedAccount, SiwcSession } from "./siwc-session.js";

type SessionPort = Pick<SiwcSession, "begin" | "complete" | "models" | "signOut">;
type StorePort = Pick<CredentialStore, "registrations" | "pendingClientIds">;

/**
 * Renderer-visible account state contains no credentials or browser hints.
 */
export interface DesktopAuthStatus {
  /**
   * Selected issued client identifier.
   */
  readonly selectedClientId?: string;

  /**
   * Whether this account granted direct plan use.
   */
  readonly planEnabled: boolean;

  /**
   * Issued client identifiers ready for browser authorization retry.
   */
  readonly pendingClientIds: readonly string[];

  /**
   * Renderer-safe connected account list.
   */
  readonly accounts: readonly {
    readonly clientId: string;
    readonly subject: string;
    readonly email?: string;
    readonly planEnabled: boolean;
  }[];
}

/**
 * Coordinates one system-browser sign-in in the trusted process.
 */
export class DesktopAuth {
  /**
   * Selected issued client identifier.
   */
  private selectedClientId: string | undefined;

  /**
   * The pending value.
   */
  private pending: LoopbackListener | undefined;

  /**
   * Listener creation in progress before the browser may open.
   */
  private starting: Promise<LoopbackListener> | undefined;

  /**
   * Reserves the single browser sign-in before the first await.
   */
  private signingIn = false;

  /**
   * The closed value.
   */
  private closed = false;

  /**
   * Initializes the trusted service.
   *
   * @param session The session for this operation.
   * @param store The store for this operation.
   * @param openExternal The open external for this operation.
   * @param openCallback Opens the local browser callback listener.
   */
  constructor(
    private readonly session: SessionPort,
    private readonly store: StorePort,
    private readonly openExternal: (url: string) => Promise<void>,
    private readonly openCallback: () => Promise<LoopbackListener> = openLoopback,
  ) {}

  /**
   * Opens the browser and completes local authorization.
   *
   * @param clientId Issued OAuth client identifier.
   * @returns The sign in result.
   */
  async signIn(clientId?: string): Promise<DesktopAuthStatus> {
    if (this.closed || this.signingIn) throw new Error("Sign-in is unavailable.");
    this.signingIn = true;
    let listener: LoopbackListener | undefined;
    try {
      this.starting = this.openCallback();
      listener = await this.starting;
      this.pending = listener;
      if (this.isClosed()) throw new Error("Sign-in was canceled.");
      const attempt = await this.session.begin(listener.redirectUri, clientId);
      if (this.isClosed()) throw new Error("Sign-in was canceled.");
      await this.openExternal(attempt.authorizationUrl);
      const callback = await listener.wait();
      const account: ConnectedAccount = await this.session.complete(
        attempt,
        callback,
        () => !this.closed && this.pending === listener,
      );
      if (this.isClosed()) throw new Error("Sign-in was canceled.");
      this.selectedClientId = account.clientId;
      return await this.status();
    } finally {
      try {
        await listener?.close();
      } finally {
        if (this.pending === listener) this.pending = undefined;
        this.starting = undefined;
        this.signingIn = false;
      }
    }
  }

  /**
   * Checks whether the desktop authentication service closed.
   *
   * @returns The is closed result.
   */
  private isClosed(): boolean {
    return this.closed;
  }

  /**
   * Returns the renderer-safe account status.
   *
   * @returns The status result.
   */
  async status(): Promise<DesktopAuthStatus> {
    const pendingClientIds = await this.store.pendingClientIds();
    const accounts = (await this.store.registrations())
      .filter((registration) => registration.subject)
      .map((registration) => ({
        clientId: registration.clientId,
        subject: registration.subject,
        ...(registration.email === undefined ? {} : { email: registration.email }),
        planEnabled:
          !!registration.accessToken &&
          !!registration.scopes?.includes("chatgpt.tokens.use.direct"),
      }));
    const selected = accounts.find((account) => account.clientId === this.selectedClientId);
    return {
      ...(selected === undefined ? {} : { selectedClientId: selected.clientId }),
      planEnabled: selected?.planEnabled ?? false,
      pendingClientIds,
      accounts,
    };
  }

  /**
   * Sets a verified account for plan use.
   *
   * @param clientId Issued OAuth client identifier.
   * @returns The select account result.
   */
  async selectAccount(clientId: string): Promise<DesktopAuthStatus> {
    const account = (await this.status()).accounts.find(
      (candidate) => candidate.clientId === clientId,
    );
    if (account === undefined) throw new Error("Unknown account registration.");
    this.selectedClientId = clientId;
    return this.status();
  }

  /**
   * Fetches the account model catalog.
   *
   * @param clientId Issued OAuth client identifier.
   * @returns The models result.
   */
  async models(clientId: string): ReturnType<SessionPort["models"]> {
    if (clientId !== this.selectedClientId) throw new Error("Account selection changed.");
    return this.session.models(clientId);
  }

  /**
   * Clears local credentials after attempting refresh-token revocation.
   *
   * @param clientId Issued OAuth client identifier.
   * @returns The sign out result.
   */
  async signOut(
    clientId: string,
  ): Promise<{ status: DesktopAuthStatus; revocationConfirmed: boolean }> {
    if (clientId !== this.selectedClientId) throw new Error("Account selection changed.");
    const revocationConfirmed = await this.session.signOut(clientId);
    this.selectedClientId = undefined;
    return { status: await this.status(), revocationConfirmed };
  }

  /**
   * Closes the active authorization callback.
   *
   * @returns The close result.
   */
  async close(): Promise<void> {
    this.closed = true;
    const listener = this.pending ?? (await this.starting?.catch(() => undefined));
    await listener?.close();
  }
}
