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

import * as oidc from "openid-client";
import { Time } from "@spine-event-engine/core";

import type { CredentialStore, SavedRegistration } from "./credential-store.js";

const issuer = "https://auth.openai.com";
const resource = "https://api.openai.com/v1";
const scope = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
type GrantTokens = Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>;

/**
 * One browser authorization attempt; keep this object in the trusted process.
 */
export interface PendingAuthorization {
  /**
   * Browser authorization URL retained by the trusted process.
   */
  readonly authorizationUrl: string;

  /**
   * Local loopback callback URL.
   */
  readonly redirectUri: string;

  /**
   * CSRF state for the authorization attempt.
   */
  readonly state: string;

  /**
   * Identity token nonce.
   */
  readonly nonce: string;

  /**
   * PKCE verifier.
   */
  readonly verifier: string;

  /**
   * Issued OAuth client identifier.
   */
  readonly clientId?: string;

  /**
   * Sign-out generation captured before browser authorization.
   */
  readonly grantVersion?: number;
}

/**
 * Nonsecret result to show in the account picker.
 */
export interface ConnectedAccount {
  /**
   * Issued OAuth client identifier.
   */
  readonly clientId: string;

  /**
   * Verified account subject.
   */
  readonly subject: string;

  /**
   * Verified account email address.
   */
  readonly email?: string;

  /**
   * Whether this account granted direct plan use.
   */
  readonly planEnabled: boolean;
}

/**
 * Direct ChatGPT plan sign-in and session lifecycle.
 */
export class SiwcSession {
  /**
   * The refreshes value.
   */
  private readonly refreshes = new Map<string, Promise<string>>();

  /**
   * Client identifiers currently being signed out.
   */
  private readonly signingOut = new Set<string>();

  /**
   * Accounts whose local credential clear failed remain unusable.
   */
  private readonly failedClear = new Set<string>();

  /**
   * Tracks grant writes so sign-out clears after any in-flight persistence.
   */
  private readonly grantWrites = new Map<string, Promise<void>>();

  /**
   * Invalidates browser grants created before sign-out.
   */
  private readonly grantVersions = new Map<string, number>();

  /**
   * Initializes the trusted service.
   *
   * @param store The store for this operation.
   * @param transport The transport for this operation.
   */
  constructor(
    private readonly store: CredentialStore,
    private readonly transport: typeof fetch = fetch,
  ) {}

  /**
   * Starts a browser authorization attempt with PKCE.
   *
   * @param redirectUri Local loopback callback URL.
   * @param clientId Issued OAuth client identifier.
   * @returns The begin result.
   */
  async begin(redirectUri: string, clientId?: string): Promise<PendingAuthorization> {
    this.validateRedirectUri(redirectUri);
    const grantVersion = clientId === undefined ? 0 : (this.grantVersions.get(clientId) ?? 0);
    if (clientId !== undefined) this.assertGrantCurrent(clientId, grantVersion, () => true);
    const saved = await this.savedClient(clientId);
    if (clientId !== undefined) this.assertGrantCurrent(clientId, grantVersion, () => true);
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const verifier = oidc.randomPKCECodeVerifier();
    const parameters = await this.authorizationParameters(
      redirectUri,
      clientId,
      state,
      nonce,
      verifier,
    );
    if (clientId !== undefined) this.assertGrantCurrent(clientId, grantVersion, () => true);
    if (clientId === undefined) parameters.set("agent_name_hint", "Release Notes Studio");
    if (saved?.idToken !== undefined) parameters.set("id_token_hint", saved.idToken);
    if (saved?.email !== undefined) parameters.set("login_hint", saved.email);
    return {
      authorizationUrl: `${issuer}/api/accounts/authorize?${parameters.toString()}`,
      redirectUri,
      state,
      nonce,
      verifier,
      ...(clientId === undefined ? {} : { clientId, grantVersion }),
    };
  }

  /**
   * Validates an IPv4 loopback callback URL before browser authorization.
   *
   * @param redirectUri The proposed local callback URL.
   */
  private validateRedirectUri(redirectUri: string): void {
    const callback = new URL(redirectUri);
    if (
      callback.protocol !== "http:" ||
      callback.hostname !== "127.0.0.1" ||
      callback.pathname !== "/auth/callback"
    ) {
      throw new Error("Invalid loopback callback.");
    }
  }

  /**
   * Validates an issued client for reconnect or a pending grant retry.
   *
   * @param clientId The issued client identifier, when reconnecting.
   * @returns The previously verified registration when available.
   */
  private async savedClient(clientId?: string): Promise<SavedRegistration | undefined> {
    if (clientId === undefined) return undefined;
    const saved = await this.store.registration(clientId);
    if (!saved?.subject && !(await this.store.pendingClientIds()).includes(clientId))
      throw new Error("Unknown registration.");
    return saved;
  }

  /**
   * Completes a verified browser authorization attempt.
   *
   * @param pending The pending for this operation.
   * @param callback The callback for this operation.
   * @param isCurrent Whether the desktop authorization attempt remains active.
   * @returns The complete result.
   */
  async complete(
    pending: PendingAuthorization,
    callback: URL,
    isCurrent: () => boolean = () => true,
  ): Promise<ConnectedAccount> {
    const clientId = this.callbackClientId(pending, callback);
    const version = pending.grantVersion ?? this.grantVersions.get(clientId) ?? 0;
    this.assertGrantCurrent(clientId, version, isCurrent);
    if (pending.clientId === undefined) await this.store.stageIssuedClient(clientId);
    const tokens = await oidc.authorizationCodeGrant(
      await this.configuration(clientId),
      callback,
      {
        expectedState: pending.state,
        expectedNonce: pending.nonce,
        pkceCodeVerifier: pending.verifier,
      },
      { resource },
    );
    this.assertGrantCurrent(clientId, version, isCurrent);
    return await this.saveCodeGrant(clientId, tokens, version, isCurrent);
  }

  /**
   * Rejects a canceled or invalidated browser grant.
   *
   * @param clientId The issued client identifier.
   * @param version The browser attempt's sign-out generation.
   * @param isCurrent Whether the desktop attempt remains open.
   */
  private assertGrantCurrent(clientId: string, version: number, isCurrent: () => boolean): void {
    if (
      !isCurrent() ||
      version !== (this.grantVersions.get(clientId) ?? 0) ||
      this.signingOut.has(clientId) ||
      this.failedClear.has(clientId)
    )
      throw new Error("Authorization attempt was canceled.");
  }

  /**
   * Validates and returns the callback client identifier.
   *
   * @param pending The pending for this operation.
   * @param callback The callback for this operation.
   * @returns The callback client id result.
   */
  private callbackClientId(pending: PendingAuthorization, callback: URL): string {
    const expected = new URL(pending.redirectUri);
    if (
      callback.origin !== expected.origin ||
      callback.pathname !== expected.pathname ||
      callback.searchParams.get("state") !== pending.state
    )
      throw new Error("Invalid authorization callback.");
    if (callback.searchParams.has("error")) throw new Error("Authorization was declined.");
    if (!callback.searchParams.get("code")) throw new Error("Authorization code is missing.");
    const issued = callback.searchParams.get("client_id");
    const clientId = pending.clientId ?? issued;
    if (
      !clientId ||
      clientId === "dynamic_agent_client" ||
      (issued && pending.clientId && issued !== pending.clientId)
    ) {
      throw new Error("Issued client ID does not match the registration.");
    }
    return clientId;
  }

  /**
   * Stores the verified account and grant tokens.
   *
   * @param clientId Issued OAuth client identifier.
   * @param tokens The tokens for this operation.
   * @param version The browser attempt's sign-out generation.
   * @param isCurrent Whether the desktop authorization attempt remains active.
   * @returns The save code grant result.
   */
  private async saveCodeGrant(
    clientId: string,
    tokens: GrantTokens,
    version: number,
    isCurrent: () => boolean,
  ): Promise<ConnectedAccount> {
    const claims = tokens.claims();
    if (
      !claims?.sub ||
      claims.iss !== issuer ||
      claims.aud !== clientId ||
      tokens.token_type.toLowerCase() !== "bearer"
    ) {
      throw new Error("Verified account identity is invalid.");
    }
    const previous = await this.store.registration(clientId);
    if (previous?.subject && (previous.subject !== claims.sub || previous.issuer !== claims.iss)) {
      throw new Error("Account registration identity changed.");
    }
    const registration = this.registrationFromGrant(clientId, claims, tokens);
    this.assertGrantCurrent(clientId, version, isCurrent);
    const writing = this.persistGrant(clientId, registration, version, isCurrent);
    this.grantWrites.set(clientId, writing);
    try {
      await writing;
    } finally {
      if (this.grantWrites.get(clientId) === writing) this.grantWrites.delete(clientId);
    }
    return {
      clientId,
      subject: claims.sub,
      ...(registration.email === undefined ? {} : { email: registration.email }),
      planEnabled: registration.scopes?.includes("chatgpt.tokens.use.direct") ?? false,
    };
  }

  /**
   * Persists a grant only while its browser attempt remains valid.
   *
   * @param clientId The issued client identifier.
   * @param registration The verified account grant.
   * @param version The browser attempt's sign-out generation.
   * @param isCurrent Whether the desktop attempt remains open.
   * @returns Completion after persistence or cleanup.
   */
  private async persistGrant(
    clientId: string,
    registration: SavedRegistration,
    version: number,
    isCurrent: () => boolean,
  ): Promise<void> {
    await this.store.save(registration);
    try {
      this.assertGrantCurrent(clientId, version, isCurrent);
    } catch (error) {
      if (!this.signingOut.has(clientId)) await this.clearFenced(clientId);
      throw error;
    }
  }

  /**
   * Builds a saved registration from a verified grant.
   *
   * @param clientId Issued OAuth client identifier.
   * @param claims The claims for this operation.
   * @param tokens The tokens for this operation.
   * @returns The registration from grant result.
   */
  private registrationFromGrant(
    clientId: string,
    claims: NonNullable<ReturnType<GrantTokens["claims"]>>,
    tokens: GrantTokens,
  ): SavedRegistration {
    return {
      clientId,
      issuer: claims.iss,
      subject: claims.sub,
      scopes: tokens.scope?.split(" ").filter(Boolean) ?? [],
      accessToken: tokens.access_token,
      ...(typeof claims.email === "string" ? { email: claims.email } : {}),
      ...(tokens.refresh_token === undefined ? {} : { refreshToken: tokens.refresh_token }),
      ...(tokens.id_token === undefined ? {} : { idToken: tokens.id_token }),
      ...(tokens.expires_in === undefined
        ? {}
        : { expiresAt: Time.currentTimeMillis() + tokens.expires_in * 1000 }),
    };
  }

  /**
   * Builds authorization parameters for the plan grant.
   *
   * @param redirectUri Local loopback callback URL.
   * @param clientId Issued OAuth client identifier.
   * @param state CSRF state for the authorization attempt.
   * @param nonce Identity token nonce.
   * @param verifier PKCE verifier.
   * @returns The authorization parameters result.
   */
  private async authorizationParameters(
    redirectUri: string,
    clientId: string | undefined,
    state: string,
    nonce: string,
    verifier: string,
  ): Promise<URLSearchParams> {
    return new URLSearchParams({
      client_id: clientId ?? "dynamic_agent_client",
      ext_agent_host_id: await this.store.hostId(),
      response_type: "code",
      redirect_uri: redirectUri,
      scope,
      resource,
      state,
      nonce,
      code_challenge_method: "S256",
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    });
  }

  /**
   * Returns a fresh authorized plan access token.
   *
   * @param clientId Issued OAuth client identifier.
   * @param at The at for this operation.
   * @returns The access token result.
   */
  async accessToken(clientId: string, at: number = Time.currentTimeMillis()): Promise<string> {
    this.assertNotSigningOut(clientId);
    const saved = await this.store.registration(clientId);
    this.assertNotSigningOut(clientId);
    if (!saved?.subject || !saved.scopes?.includes("chatgpt.tokens.use.direct")) {
      throw new Error("ChatGPT plan permission is not available.");
    }
    if (saved.accessToken && saved.expiresAt && saved.expiresAt > at + 60_000)
      return saved.accessToken;
    const active = this.refreshes.get(clientId);
    if (active !== undefined) {
      const token = await active;
      this.assertNotSigningOut(clientId);
      return token;
    }
    const refresh = this.refresh(clientId, saved);
    this.refreshes.set(clientId, refresh);
    try {
      const token = await refresh;
      this.assertNotSigningOut(clientId);
      return token;
    } finally {
      this.refreshes.delete(clientId);
    }
  }

  /**
   * Rejects token use while an account is being signed out.
   *
   * @param clientId The issued client identifier.
   */
  private assertNotSigningOut(clientId: string): void {
    if (this.signingOut.has(clientId) || this.failedClear.has(clientId))
      throw new Error("Account sign-out is in progress.");
  }

  /**
   * Fetches the account model catalog.
   *
   * @param clientId Issued OAuth client identifier.
   * @returns The models result.
   */
  async models(clientId: string): Promise<readonly { slug: string; displayName: string }[]> {
    const token = await this.accessToken(clientId);
    const response = await this.transport(`${resource}/models`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error("Account model catalog is unavailable.");
    const body: unknown = await response.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("models" in body) ||
      !Array.isArray(body.models)
    ) {
      throw new Error("Account model catalog is invalid.");
    }
    return body.models.flatMap((model: unknown) => {
      if (
        typeof model !== "object" ||
        model === null ||
        !("slug" in model) ||
        !("display_name" in model) ||
        !("visibility" in model) ||
        model.visibility !== "list" ||
        typeof model.slug !== "string" ||
        typeof model.display_name !== "string"
      )
        return [];
      return [{ slug: model.slug, displayName: model.display_name }];
    });
  }

  /**
   * Clears local credentials after attempting refresh-token revocation.
   *
   * @param clientId Issued OAuth client identifier.
   * @returns The sign out result.
   */
  async signOut(clientId: string): Promise<boolean> {
    if (this.signingOut.has(clientId)) throw new Error("Account sign-out is in progress.");
    this.signingOut.add(clientId);
    this.grantVersions.set(clientId, (this.grantVersions.get(clientId) ?? 0) + 1);
    try {
      await this.refreshes.get(clientId)?.catch(() => undefined);
      await this.grantWrites.get(clientId)?.catch(() => undefined);
      return await this.revokeAndClear(clientId);
    } finally {
      this.signingOut.delete(clientId);
    }
  }

  /**
   * Clears local tokens after attempting remote refresh-token revocation.
   *
   * @param clientId The issued client identifier.
   * @returns Whether remote revocation was confirmed.
   */
  private async revokeAndClear(clientId: string): Promise<boolean> {
    const saved = await this.store.registration(clientId);
    if (saved === undefined) throw new Error("Unknown registration.");
    let revoked = saved.refreshToken === undefined;
    try {
      if (saved.refreshToken !== undefined) {
        await oidc.tokenRevocation(await this.configuration(clientId), saved.refreshToken, {
          token_type_hint: "refresh_token",
        });
        revoked = true;
      }
    } catch {
      revoked = false;
    } finally {
      await this.clearFenced(clientId);
    }
    return revoked;
  }

  /**
   * Marks an account unavailable until encrypted token removal succeeds.
   *
   * @param clientId The issued client identifier.
   * @returns Completion after local credential removal.
   */
  private async clearFenced(clientId: string): Promise<void> {
    this.failedClear.add(clientId);
    await this.store.clearTokens(clientId);
    this.failedClear.delete(clientId);
  }

  /**
   * Updates and verifies the existing account grant.
   *
   * @param clientId Issued OAuth client identifier.
   * @param saved The saved for this operation.
   * @returns The refresh result.
   */
  private async refresh(clientId: string, saved: SavedRegistration): Promise<string> {
    if (!saved.refreshToken) throw new Error("Account sign-in is required.");
    const tokens = await oidc.refreshTokenGrant(
      await this.configuration(clientId),
      saved.refreshToken,
      { resource },
    );
    const claims = tokens.claims();
    if (
      claims !== undefined &&
      (claims.sub !== saved.subject || claims.iss !== saved.issuer || claims.aud !== clientId)
    ) {
      throw new Error("Refreshed account identity changed.");
    }
    const scopes = tokens.scope?.split(" ").filter(Boolean) ?? saved.scopes ?? [];
    if (
      !scopes.includes("chatgpt.tokens.use.direct") ||
      !tokens.refresh_token ||
      tokens.token_type.toLowerCase() !== "bearer" ||
      !tokens.expires_in
    ) {
      throw new Error("Renewed ChatGPT plan permission is invalid.");
    }
    await this.store.save({
      ...saved,
      scopes,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Time.currentTimeMillis() + tokens.expires_in * 1000,
      ...(tokens.id_token === undefined ? {} : { idToken: tokens.id_token }),
    });
    return tokens.access_token;
  }

  /**
   * Creates a signing-verified issued-client configuration.
   *
   * @param clientId Issued OAuth client identifier.
   * @returns The configuration result.
   */
  private async configuration(clientId: string): Promise<oidc.Configuration> {
    const config = await oidc.discovery(
      new URL(issuer),
      clientId,
      { token_endpoint_auth_method: "none" },
      oidc.None(),
      { [oidc.customFetch]: this.transport as oidc.CustomFetch },
    );
    oidc.enableNonRepudiationChecks(config);
    return config;
  }
}
