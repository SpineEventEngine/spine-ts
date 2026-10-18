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
import type { AiBackendRegistration, AiControl, AiScope, ModelRef } from "@spine-event-engine/ai";

/**
 * Verified OAuth registration persisted by the host application.
 * The session reads and writes this record, while the host chooses encrypted storage.
 */
export interface ChatgptPlanRegistration {
  /**
   * Issued OAuth client identifier used for this grant.
   */
  clientId: string;

  /**
   * Verified identity token issuer.
   */
  issuer: string;

  /**
   * Verified account subject bound to this client.
   */
  subject: string;

  /**
   * Verified email address, when included in the identity token.
   */
  email?: string;

  /**
   * Granted OAuth scopes retained for authorization checks.
   */
  scopes?: string[];

  /**
   * Current access token held only in trusted storage.
   */
  accessToken?: string;

  /**
   * Refresh token held only in trusted storage.
   */
  refreshToken?: string;

  /**
   * Signed identity token retained for reconnect hints.
   */
  idToken?: string;

  /**
   * Provider-issued access-token expiration time in epoch milliseconds.
   */
  expiresAt?: number;
}

/**
 * Trusted persistence operations required by a ChatGPT plan session.
 * The host implements these methods without exposing tokens to its renderer.
 */
export interface ChatgptPlanCredentialStore {
  /**
   * Returns a stable host identifier used during dynamic client registration.
   *
   * @returns Host identifier retained across app restarts.
   */
  hostId(): Promise<string>;

  /**
   * Lists saved account registrations for the trusted account picker.
   *
   * @returns Registrations, including protected grants for trusted processing.
   */
  registrations(): Promise<readonly ChatgptPlanRegistration[]>;

  /**
   * Reads one issued-client registration, including its protected grant.
   *
   * @param clientId Issued OAuth client identifier.
   * @returns Saved registration when the client is known.
   */
  registration(clientId: string): Promise<ChatgptPlanRegistration | undefined>;

  /**
   * Lists issued clients awaiting a completed browser grant.
   *
   * @returns Issued clients that can be offered for reconnect.
   */
  pendingClientIds(): Promise<readonly string[]>;

  /**
   * Persists an issued client before exchanging its authorization code.
   *
   * @param clientId Issued OAuth client identifier.
   * @returns When the client is durable for a browser retry.
   */
  stageIssuedClient(clientId: string): Promise<void>;

  /**
   * Persists a verified registration and its refreshed credentials.
   *
   * @param registration Verified account grant to save atomically.
   * @returns When the registration is durable.
   */
  save(registration: ChatgptPlanRegistration): Promise<void>;

  /**
   * Clears local credentials after sign-out or invalidated persistence.
   *
   * @param clientId Issued OAuth client identifier.
   * @returns When local grant material is cleared.
   */
  clearTokens(clientId: string): Promise<void>;
}

/**
 * Host settings for a ChatGPT plan session.
 * One session coordinates browser grants, refreshes, catalog reads, and model binding.
 */
export interface ChatgptPlanSessionOptions {
  /**
   * Name displayed in the browser authorization prompt.
   */
  readonly agentName: string;

  /**
   * Trusted persistence for verified account grants and issued clients.
   */
  readonly credentials: ChatgptPlanCredentialStore;

  /**
   * Default fetch for OAuth, catalog, and guarded inference unless a model overrides it.
   */
  readonly platformFetch?: typeof fetch;
}

/**
 * Binds one account-visible model to an application deployment reference.
 * Application authorization is rechecked before and after asynchronous credential work.
 */
export interface PlanSessionModelOptions {
  /**
   * Deployment reference registered in the application's Agent registry.
   */
  readonly ref: ModelRef;

  /**
   * Issued client ID of the selected verified account.
   */
  readonly clientId: string;

  /**
   * Exact account-visible model slug selected by the application.
   */
  readonly model: string;

  /**
   * Checks application account and model authorization on every operation.
   *
   * @param scope Current authenticated Agent scope.
   * @param control Cancellation and authority controls for this operation.
   * @returns Whether this application still permits the selected account and model.
   */
  readonly authorizeUse: (scope: AiScope, control: AiControl) => boolean | Promise<boolean>;

  /**
   * Overrides the session fetch for this model's guarded inference transport.
   */
  readonly platformFetch?: typeof fetch;
}

const issuer = "https://auth.openai.com";
const resource = "https://api.openai.com/v1";
const scope = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
type GrantTokens = Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>;
type RefreshTokens = Awaited<ReturnType<typeof oidc.refreshTokenGrant>>;
const hasIssuedAudience = (audience: string | string[], clientId: string): boolean =>
  Array.isArray(audience) ? audience.includes(clientId) : audience === clientId;

/**
 * Allows one caller to stop waiting for shared session work.
 *
 * @param pending Shared session operation.
 * @param signal Caller cancellation signal.
 * @returns The operation result while this caller is still active.
 * @typeParam T Session operation result.
 */
const awaitSession = <T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (signal === undefined) return pending;
  if (signal.aborted) return Promise.reject(new Error("Session operation cancelled."));
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(new Error("Session operation cancelled."));
    };
    signal.addEventListener("abort", abort, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error instanceof Error ? error : new Error("Session operation failed."));
      },
    );
  });
};

/**
 * Rejects malformed or failed catalog responses without returning provider content.
 */
class CatalogFailure extends Error {
  /**
   * Creates the fixed catalog failure visible to callers.
   */
  constructor() {
    super("Account model catalog is unavailable.");
  }
}

const CatalogResponse = {
  /**
   * Reads the complete response body before JSON parsing.
   *
   * @param response Account catalog response.
   * @returns Parsed catalog body.
   */
  async body(response: Response): Promise<unknown> {
    if (!response.body) throw new CatalogFailure();
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let content = "";
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        try {
          content += decoder.decode(part.value, { stream: true });
        } catch {
          throw new CatalogFailure();
        }
      }
      try {
        return JSON.parse(content + decoder.decode()) as unknown;
      } catch {
        throw new CatalogFailure();
      }
    } finally {
      void reader.cancel().catch(() => undefined);
    }
  },

  /**
   * Rejects malformed catalog entries without retaining provider prose.
   *
   * @param body Parsed bounded catalog response.
   * @returns List-visible account models.
   */
  models(body: unknown): readonly { slug: string; displayName: string }[] {
    if (
      typeof body !== "object" ||
      body === null ||
      !("models" in body) ||
      !Array.isArray(body.models)
    )
      throw new CatalogFailure();
    return body.models.flatMap((model: unknown) => {
      if (
        typeof model !== "object" ||
        model === null ||
        !("slug" in model) ||
        !("display_name" in model) ||
        !("visibility" in model) ||
        typeof model.slug !== "string" ||
        typeof model.display_name !== "string"
      )
        throw new CatalogFailure();
      return model.visibility === "list"
        ? [{ slug: model.slug, displayName: model.display_name }]
        : [];
    });
  },
};

/**
 * Browser authorization handle held by the trusted process.
 * Grant verifier, nonce, state, and reconnect details remain private to the session.
 */
export interface PendingAuthorization {
  /**
   * URL passed to the system browser, never to an untrusted renderer.
   */
  readonly authorizationUrl: string;
}

interface AuthorizationState {
  readonly redirectUri: string;
  readonly state: string;
  readonly nonce: string;
  readonly verifier: string;
  readonly clientId?: string;
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
 * Coordinates verified ChatGPT plan grants and discovered model registrations.
 * The application remains responsible for browser UI, encrypted storage, and account selection.
 */
export class ChatgptPlanSession {
  private readonly authorizations = new WeakMap<PendingAuthorization, AuthorizationState>();

  /**
   * Shares one refresh per issued client while allowing each caller to cancel its wait.
   */
  private readonly refreshes = new Map<string, Promise<string>>();

  private readonly refreshControllers = new Map<string, AbortController>();

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
  private readonly grantWrites = new Map<string, Set<Promise<void>>>();

  /**
   * Invalidates browser grants created before sign-out.
   */
  private readonly grantVersions = new Map<string, number>();

  private readonly store: ChatgptPlanCredentialStore;

  private readonly transport: typeof fetch;

  private readonly agentName: string;

  /**
   * Creates a plan session with host-provided credential persistence and transport.
   *
   * @param options Trusted application name, credential store, and optional fetch.
   */
  constructor(options: ChatgptPlanSessionOptions) {
    if (!options.agentName.trim()) throw new TypeError("ChatGPT plan agentName must be nonblank.");
    this.store = options.credentials;
    this.transport = options.platformFetch ?? fetch;
    this.agentName = options.agentName;
  }

  /**
   * Lists verified account identities for a trusted account picker.
   * Token and refresh material remain in the credential store.
   *
   * @returns Connected account identities without token material.
   */
  async accounts(): Promise<readonly ConnectedAccount[]> {
    const registrations = await this.store.registrations();
    return registrations
      .filter((entry) => entry.subject)
      .map((entry) => ({
        clientId: entry.clientId,
        subject: entry.subject,
        ...(entry.email === undefined ? {} : { email: entry.email }),
        planEnabled: !!entry.accessToken && !!entry.scopes?.includes("chatgpt.tokens.use.direct"),
      }));
  }

  /**
   * Lists issued clients with a staged but incomplete browser authorization.
   * Applications can offer reconnect without inspecting stored grants.
   *
   * @returns Issued clients awaiting a verified grant.
   */
  pendingClientIds(): Promise<readonly string[]> {
    return this.store.pendingClientIds();
  }

  /**
   * Creates a registration for an account-visible model and verified subject.
   * Connection callbacks recheck the current grant and application authorization.
   *
   * @param options Selected account, model, deployment, and application policy.
   * @returns A registration for the Spine Agent registry.
   */
  async model(options: PlanSessionModelOptions): Promise<AiBackendRegistration> {
    const saved = await this.store.registration(options.clientId);
    if (!saved?.subject || !saved.scopes?.includes("chatgpt.tokens.use.direct"))
      throw new Error("ChatGPT plan permission is not available.");
    if (!(await this.models(options.clientId)).some((item) => item.slug === options.model))
      throw new Error("Model is not available to this account.");
    const subject = saved.subject;
    const identity = Object.freeze({
      provider: "openai-chatgpt-plan",
      account: `${options.clientId}:${subject}`,
      endpoint: resource,
      model: options.model,
    });
    const isCurrent = async (scope: AiScope, control: AiControl): Promise<boolean> =>
      (await options.authorizeUse(scope, control)) &&
      (await this.store.registration(options.clientId))?.subject === subject;
    const { VercelAx } = await import("./factory.js");
    return VercelAx.chatgptPlanModel({
      ref: options.ref,
      platformFetch: options.platformFetch ?? this.transport,
      resolveIdentity: () => identity,
      authorizeUse: async (scope, expected, control) =>
        expected.provider === identity.provider &&
        expected.account === identity.account &&
        expected.endpoint === identity.endpoint &&
        expected.model === identity.model &&
        (await isCurrent(scope, control)),
      connect: (scope, _expected, control) =>
        this.connectModel(options, identity, isCurrent, scope, control),
    });
  }

  /**
   * Checks application selection around catalog and credential reads.
   *
   * @param options Selected model and issued client.
   * @param identity Verified provider identity for the registration.
   * @param isCurrent Application and subject authorization check.
   * @param scope Current authenticated Agent scope.
   * @param control Cancellation and authority controls.
   * @returns A credential binding for guarded inference.
   */
  private async connectModel(
    options: PlanSessionModelOptions,
    identity: { provider: string; account: string; endpoint: string; model: string },
    isCurrent: (scope: AiScope, control: AiControl) => Promise<boolean>,
    scope: AiScope,
    control: AiControl,
  ) {
    const assertCurrent = async () => {
      if (!(await isCurrent(scope, control)))
        throw new Error("ChatGPT account or model selection changed.");
    };
    await assertCurrent();
    if (
      !(await this.models(options.clientId, control.signal)).some(
        (item) => item.slug === options.model,
      )
    )
      throw new Error("Model is not available to this account.");
    await assertCurrent();
    const accessToken = await this.accessToken(
      options.clientId,
      Time.currentTimeMillis(),
      control.signal,
    );
    await assertCurrent();
    return { accessToken, identity };
  }

  /**
   * Starts a browser authorization attempt with PKCE.
   *
   * @param redirectUri Local loopback callback URL.
   * @param clientId Issued OAuth client identifier.
   * @returns Authorization URL linked to private PKCE state for completion.
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
    if (clientId === undefined) parameters.set("agent_name_hint", this.agentName);
    if (saved?.idToken !== undefined) parameters.set("id_token_hint", saved.idToken);
    if (saved?.email !== undefined) parameters.set("login_hint", saved.email);
    const result: PendingAuthorization = Object.freeze({
      authorizationUrl: `${issuer}/api/accounts/authorize?${parameters.toString()}`,
    });
    this.authorizations.set(result, {
      redirectUri,
      state,
      nonce,
      verifier,
      ...(clientId === undefined ? {} : { clientId, grantVersion }),
    });
    return result;
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
  private async savedClient(clientId?: string): Promise<ChatgptPlanRegistration | undefined> {
    if (clientId === undefined) return undefined;
    const saved = await this.store.registration(clientId);
    if (!saved?.subject && !(await this.store.pendingClientIds()).includes(clientId))
      throw new Error("Unknown registration.");
    return saved;
  }

  /**
   * Completes a verified browser authorization attempt.
   *
   * @param pending Authorization attempt and its private callback expectations.
   * @param callback Browser redirect containing an authorization code and state.
   * @param isCurrent Whether the desktop authorization attempt remains active.
   * @param signal Cancels provider work and invalidates any late grant persistence.
   * @returns Verified account after its grant is persisted.
   */
  async complete(
    pending: PendingAuthorization,
    callback: URL,
    isCurrent: () => boolean = () => true,
    signal?: AbortSignal,
  ): Promise<ConnectedAccount> {
    if (signal?.aborted) throw new Error("Authorization attempt was canceled.");
    const current = () => !signal?.aborted && isCurrent();
    const internal = this.authorizations.get(pending);
    if (!internal) throw new Error("Authorization attempt is unavailable.");
    this.authorizations.delete(pending);
    const clientId = this.callbackClientId(internal, callback);
    const version = internal.grantVersion ?? this.grantVersions.get(clientId) ?? 0;
    this.assertGrantCurrent(clientId, version, current);
    if (internal.clientId === undefined) await this.store.stageIssuedClient(clientId);
    this.assertGrantCurrent(clientId, version, current);
    const configuration = await this.configuration(clientId, signal);
    const tokens = await oidc.authorizationCodeGrant(
      configuration,
      callback,
      {
        expectedState: internal.state,
        expectedNonce: internal.nonce,
        pkceCodeVerifier: internal.verifier,
      },
      { resource },
    );
    this.assertGrantCurrent(clientId, version, current);
    return this.saveCodeGrant(clientId, tokens, version, current);
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
   * @param pending Authorization attempt and its private callback expectations.
   * @param callback Browser redirect containing an authorization code and state.
   * @returns Issued client ID matching the pending grant and callback.
   */
  private callbackClientId(pending: AuthorizationState, callback: URL): string {
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
   * @param tokens Provider tokens returned by the verified grant.
   * @param version The browser attempt's sign-out generation.
   * @param isCurrent Whether the desktop authorization attempt remains active.
   * @returns Connected account derived from the persisted verified grant.
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
      !hasIssuedAudience(claims.aud, clientId) ||
      tokens.token_type.toLowerCase() !== "bearer"
    )
      throw new Error("Verified account identity is invalid.");
    const previous = await this.store.registration(clientId);
    if (previous?.subject && (previous.subject !== claims.sub || previous.issuer !== claims.iss))
      throw new Error("Account registration identity changed.");
    const registration = this.registrationFromGrant(clientId, claims, tokens);
    this.assertGrantCurrent(clientId, version, isCurrent);
    await this.trackGrantWrite(
      clientId,
      this.persistGrant(clientId, registration, version, isCurrent),
    );
    return {
      clientId,
      subject: claims.sub,
      ...(registration.email === undefined ? {} : { email: registration.email }),
      planEnabled: registration.scopes?.includes("chatgpt.tokens.use.direct") ?? false,
    };
  }

  /**
   * Adds a concurrent grant write to the sign-out fence until it settles.
   *
   * @param clientId Issued client receiving the grant.
   * @param writing Active credential-store write.
   * @returns When the write and its post-save fencing have settled.
   */
  private async trackGrantWrite(clientId: string, writing: Promise<void>): Promise<void> {
    const writes = this.grantWrites.get(clientId) ?? new Set<Promise<void>>();
    writes.add(writing);
    this.grantWrites.set(clientId, writes);
    try {
      await writing;
    } finally {
      writes.delete(writing);
      if (writes.size === 0) this.grantWrites.delete(clientId);
    }
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
    registration: ChatgptPlanRegistration,
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
   * @param claims Verified identity claims for the granted account.
   * @param tokens Provider tokens returned by the verified grant.
   * @returns Account registration with provider tokens and optional expiry.
   */
  private registrationFromGrant(
    clientId: string,
    claims: NonNullable<ReturnType<GrantTokens["claims"]>>,
    tokens: GrantTokens,
  ): ChatgptPlanRegistration {
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
   * @returns OAuth parameters with host identity and PKCE challenge.
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
   * @param at Current epoch milliseconds used to assess token expiry.
   * @param signal Cancels this caller's wait for a refresh.
   * @returns Current or refreshed token for the authorized account.
   */
  async accessToken(
    clientId: string,
    at: number = Time.currentTimeMillis(),
    signal?: AbortSignal,
  ): Promise<string> {
    if (signal?.aborted) throw new Error("Session operation cancelled.");
    const version = this.grantVersions.get(clientId) ?? 0;
    this.assertTokenCurrent(clientId, version);
    const saved = await this.store.registration(clientId);
    this.assertTokenCurrent(clientId, version);
    if (!saved?.subject || !saved.scopes?.includes("chatgpt.tokens.use.direct")) {
      throw new Error("ChatGPT plan permission is not available.");
    }
    if (saved.accessToken && saved.expiresAt && saved.expiresAt > at + 60_000) {
      this.assertTokenCurrent(clientId, version);
      return saved.accessToken;
    }
    const token = await awaitSession(this.sharedRefresh(clientId, saved), signal);
    this.assertTokenCurrent(clientId, version);
    return token;
  }

  /**
   * Returns the shared refresh for an issued client and removes it after settlement.
   *
   * @param clientId Issued OAuth client identifier.
   * @param saved Verified grant used to refresh.
   * @returns Shared refreshed token promise.
   */
  private sharedRefresh(clientId: string, saved: ChatgptPlanRegistration): Promise<string> {
    const active = this.refreshes.get(clientId);
    if (active !== undefined) return active;
    const controller = new AbortController();
    this.refreshControllers.set(clientId, controller);
    const refresh = this.refresh(clientId, saved, controller.signal);
    this.refreshes.set(clientId, refresh);
    void refresh
      .finally(() => {
        if (this.refreshes.get(clientId) === refresh) this.refreshes.delete(clientId);
        if (this.refreshControllers.get(clientId) === controller)
          this.refreshControllers.delete(clientId);
      })
      .catch(() => undefined);
    return refresh;
  }

  /**
   * Rejects token use after an account's grant changes or sign-out begins.
   *
   * @param clientId The issued client identifier.
   * @param version Grant generation captured before asynchronous credential reads.
   */
  private assertTokenCurrent(clientId: string, version: number): void {
    if (
      this.signingOut.has(clientId) ||
      this.failedClear.has(clientId) ||
      (this.grantVersions.get(clientId) ?? 0) !== version
    )
      throw new Error("Account sign-out is in progress.");
  }

  /**
   * Fetches the catalog of models visible to this plan account.
   *
   * @param clientId Issued OAuth client identifier.
   * @param signal Cancels token refresh and catalog fetch for this caller.
   * @returns List-visible models after response validation.
   */
  async models(
    clientId: string,
    signal?: AbortSignal,
  ): Promise<readonly { slug: string; displayName: string }[]> {
    const token = await this.accessToken(clientId, Time.currentTimeMillis(), signal);
    const abort = new AbortController();
    const cancel = () => {
      abort.abort();
    };
    if (signal?.aborted) abort.abort();
    else signal?.addEventListener("abort", cancel, { once: true });
    try {
      const response = await this.transport(`${resource}/models`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: abort.signal,
      });
      if (!response.ok) throw new CatalogFailure();
      const body = await CatalogResponse.body(response);
      return CatalogResponse.models(body);
    } catch {
      throw new Error("Account model catalog is unavailable.");
    } finally {
      signal?.removeEventListener("abort", cancel);
      abort.abort();
    }
  }

  /**
   * Clears local credentials after attempting refresh-token revocation.
   *
   * @param clientId Issued OAuth client identifier.
   * @param signal Cancels remote revocation while preserving local token removal.
   * @returns Whether remote refresh-token revocation was confirmed.
   */
  async signOut(clientId: string, signal?: AbortSignal): Promise<boolean> {
    if (this.signingOut.has(clientId)) throw new Error("Account sign-out is in progress.");
    this.signingOut.add(clientId);
    this.grantVersions.set(clientId, (this.grantVersions.get(clientId) ?? 0) + 1);
    const cancelRefresh = () => {
      this.refreshControllers.get(clientId)?.abort();
    };
    if (signal?.aborted) cancelRefresh();
    else signal?.addEventListener("abort", cancelRefresh, { once: true });
    try {
      await this.refreshes.get(clientId)?.catch(() => undefined);
      const writes = this.grantWrites.get(clientId);
      if (writes !== undefined) await Promise.allSettled([...writes]);
      return await this.revokeAndClear(clientId, signal);
    } finally {
      signal?.removeEventListener("abort", cancelRefresh);
      this.signingOut.delete(clientId);
    }
  }

  /**
   * Clears local tokens after attempting remote refresh-token revocation.
   *
   * @param clientId The issued client identifier.
   * @param signal Cancels discovery or revocation transport work.
   * @returns Whether remote revocation was confirmed.
   */
  private async revokeAndClear(clientId: string, signal?: AbortSignal): Promise<boolean> {
    const saved = await this.store.registration(clientId);
    if (saved === undefined) throw new Error("Unknown registration.");
    let revoked = saved.refreshToken === undefined;
    try {
      if (saved.refreshToken !== undefined) {
        await awaitSession(
          oidc.tokenRevocation(await this.configuration(clientId, signal), saved.refreshToken, {
            token_type_hint: "refresh_token",
          }),
          signal,
        );
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
   * @param saved Existing verified registration and refresh token.
   * @param signal Cancels discovery and token refresh network requests.
   * @returns Access token from the verified refreshed grant.
   */
  private async refresh(
    clientId: string,
    saved: ChatgptPlanRegistration,
    signal: AbortSignal,
  ): Promise<string> {
    if (!saved.refreshToken) throw new Error("Account sign-in is required.");
    const tokens = await oidc.refreshTokenGrant(
      await this.configuration(clientId, signal),
      saved.refreshToken,
      { resource },
    );
    const { scopes, refreshToken, expiresIn } = this.validatedRefreshGrant(clientId, saved, tokens);
    await this.store.save({
      ...saved,
      scopes,
      accessToken: tokens.access_token,
      refreshToken,
      expiresAt: Time.currentTimeMillis() + expiresIn * 1000,
      ...(tokens.id_token === undefined ? {} : { idToken: tokens.id_token }),
    });
    return tokens.access_token;
  }

  /**
   * Validates refreshed identity, grant, and token material before persistence.
   *
   * @param clientId Issued OAuth client identifier.
   * @param saved Previous verified registration.
   * @param tokens Provider refresh grant.
   * @returns Verified scopes, rotating refresh token, and provider expiry.
   */
  private validatedRefreshGrant(
    clientId: string,
    saved: ChatgptPlanRegistration,
    tokens: RefreshTokens,
  ): { scopes: string[]; refreshToken: string; expiresIn: number } {
    const claims = tokens.claims();
    if (
      claims !== undefined &&
      (claims.sub !== saved.subject ||
        claims.iss !== saved.issuer ||
        !hasIssuedAudience(claims.aud, clientId))
    ) {
      throw new Error("Refreshed account identity changed.");
    }
    const scopes = tokens.scope?.split(" ").filter(Boolean) ?? saved.scopes ?? [];
    const refreshToken = tokens.refresh_token;
    const expiresIn = tokens.expires_in;
    if (
      !scopes.includes("chatgpt.tokens.use.direct") ||
      !refreshToken ||
      tokens.token_type.toLowerCase() !== "bearer" ||
      !expiresIn
    ) {
      throw new Error("Renewed ChatGPT plan permission is invalid.");
    }
    return { scopes, refreshToken, expiresIn };
  }

  /**
   * Creates a signing-verified issued-client configuration.
   *
   * @param clientId Issued OAuth client identifier.
   * @param signal Replaces the library's discovery timeout with the caller's cancellation.
   * @returns Discovery configuration with provider signature checks enabled.
   */
  private async configuration(clientId: string, signal?: AbortSignal): Promise<oidc.Configuration> {
    const operationSignal = signal ?? new AbortController().signal;
    const scopedFetch: oidc.CustomFetch = (input, init) =>
      awaitSession(
        this.transport(input, {
          ...init,
          body: (init.body ?? null) as BodyInit | null,
          signal: operationSignal,
        }),
        operationSignal,
      );
    const config = await oidc.discovery(
      new URL(issuer),
      clientId,
      { token_endpoint_auth_method: "none" },
      oidc.None(),
      { [oidc.customFetch]: scopedFetch },
    );
    oidc.enableNonRepudiationChecks(config);
    return config;
  }
}
