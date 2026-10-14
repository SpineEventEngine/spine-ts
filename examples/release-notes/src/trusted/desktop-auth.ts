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
import type { ConnectedAccount, ChatgptPlanSession } from "@spine-event-engine/ai-vercel-ax";

type SessionPort = Pick<
  ChatgptPlanSession,
  "begin" | "complete" | "models" | "signOut" | "accounts" | "pendingClientIds"
>;

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
   * Active loopback listener for the current browser grant.
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
   * Cancels the active OAuth request when native window shutdown begins.
   */
  private signInAbort: AbortController | undefined;

  /**
   * Cancels remote revocation requests when the native window closes.
   */
  private readonly signOutAborts = new Set<AbortController>();

  /**
   * Whether shutdown has permanently disabled new sign-in attempts.
   */
  private closed = false;

  /**
   * Initializes the trusted service.
   *
   * @param session Trusted plan session used for account and grant operations.
   * @param openExternal Opens the authorization URL in the system browser.
   * @param openCallback Opens the local browser callback listener.
   */
  constructor(
    private readonly session: SessionPort,
    private readonly openExternal: (url: string) => Promise<void>,
    private readonly openCallback: () => Promise<LoopbackListener> = openLoopback,
  ) {}

  /**
   * Retries the latest unfinished issued-client registration when present.
   *
   * @returns Renderer-safe account status after browser authorization.
   */
  async signInOrResume(): Promise<DesktopAuthStatus> {
    const staged = (await this.session.pendingClientIds()).at(-1);
    return this.signIn(staged);
  }

  /**
   * Opens the browser and completes local authorization.
   *
   * @param clientId Issued OAuth client identifier.
   * @returns Account status after a verified grant is selected.
   */
  async signIn(clientId?: string): Promise<DesktopAuthStatus> {
    if (this.closed || this.signingIn) throw new Error("Sign-in is unavailable.");
    this.signingIn = true;
    const abort = new AbortController();
    this.signInAbort = abort;
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
        abort.signal,
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
        if (this.signInAbort === abort) this.signInAbort = undefined;
      }
    }
  }

  /**
   * Checks whether the desktop authentication service closed.
   *
   * @returns Whether shutdown has begun.
   */
  private isClosed(): boolean {
    return this.closed;
  }

  /**
   * Returns the renderer-safe account status.
   *
   * @returns Connected accounts, pending clients, and current selection without credentials.
   */
  async status(): Promise<DesktopAuthStatus> {
    const pendingClientIds = await this.session.pendingClientIds();
    const accounts = await this.session.accounts();
    const selected = accounts.find((account) => account.clientId === this.selectedClientId);
    return {
      ...(selected === undefined ? {} : { selectedClientId: selected.clientId }),
      planEnabled: selected?.planEnabled ?? false,
      pendingClientIds,
      accounts,
    };
  }

  /**
   * Fetches the account model catalog.
   *
   * @param clientId Issued OAuth client identifier.
   * @returns Models available to the selected account.
   */
  async models(clientId: string): ReturnType<SessionPort["models"]> {
    if (clientId !== this.selectedClientId) throw new Error("Account selection changed.");
    return this.session.models(clientId);
  }

  /**
   * Clears local credentials after attempting refresh-token revocation.
   *
   * @param clientId Issued OAuth client identifier.
   * @returns Updated account status and whether remote revocation was confirmed.
   */
  async signOut(
    clientId: string,
  ): Promise<{ status: DesktopAuthStatus; revocationConfirmed: boolean }> {
    if (clientId !== this.selectedClientId) throw new Error("Account selection changed.");
    const abort = new AbortController();
    this.signOutAborts.add(abort);
    try {
      const revocationConfirmed = await this.session.signOut(clientId, abort.signal);
      this.selectedClientId = undefined;
      return { status: await this.status(), revocationConfirmed };
    } finally {
      this.signOutAborts.delete(abort);
    }
  }

  /**
   * Closes the active authorization callback.
   *
   * @returns When the pending callback listener has closed.
   */
  async close(): Promise<void> {
    this.closed = true;
    this.signInAbort?.abort();
    for (const abort of this.signOutAborts) abort.abort();
    const listener = this.pending ?? (await this.starting?.catch(() => undefined));
    await listener?.close();
  }
}
