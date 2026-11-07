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
  OidcFlow,
  OpaqueSessions,
  PersistentOidcFlowStore,
  createGoogleProvider,
  type ApplicationSessionIssuer,
  type ApplicationSessionIssue,
  type ConfiguredOidcProvider,
  type IdentityMapping,
} from "@spine-event-engine/auth";
import { StorageGroup, type StorageFactory } from "@spine-event-engine/storage";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { FieldnotesAuthentication } from "./host-settings.js";

/**
 * Selects the direct-Google settings needed to open one durable OIDC flow.
 */
type GoogleSettings = Extract<FieldnotesAuthentication, { readonly mode: "google" }>;

/**
 * Maps only the configured verified Google issuer to a distinct app principal.
 */
export class FieldnotesGoogleIdentity implements IdentityMapping {
  /**
   * Binds the exact trusted OIDC issuer.
   *
   * @param issuer Configured provider issuer.
   */
  constructor(private readonly issuer: string) {}

  /**
   * Resolves a verified issuer/subject without email linking.
   *
   * @param identity Verified external identity.
   * @param signal Flow cancellation.
   * @returns Provider-qualified application identity.
   */
  resolve(
    identity: { readonly issuer: string; readonly subject: string },
    signal: AbortSignal,
  ): Promise<
    | { readonly externalIdentity: typeof identity; readonly principal: { readonly id: string } }
    | undefined
  > {
    signal.throwIfAborted();
    if (identity.issuer !== this.issuer || !identity.subject) return Promise.resolve(undefined);
    return Promise.resolve({
      externalIdentity: identity,
      principal: { id: JSON.stringify(["google-oidc", this.issuer, identity.subject]) },
    });
  }
}

/**
 * Adapts durable opaque sessions to the OIDC grant-issuance seam.
 */
export class FieldnotesSessionIssuer implements ApplicationSessionIssuer {
  /**
   * Binds the same sessions instance as the browser gateway.
   *
   * @param sessions Persistent app sessions.
   */
  constructor(private readonly sessions: OpaqueSessions) {}

  /**
   * Creates one session and compensates if cancellation races its completion.
   *
   * @param principal Verified application principal.
   * @param signal Flow cancellation signal.
   * @returns Issued session or an ordinary decline.
   */
  async issue(
    principal: { readonly id: string },
    signal: AbortSignal,
  ): Promise<ApplicationSessionIssue | undefined> {
    const created = await this.sessions.issue(principal, signal);
    if (created.kind !== "created") return undefined;
    if (signal.aborted) {
      await this.sessions.logout(created.credential);
      signal.throwIfAborted();
    }
    return { credential: created.credential, session: created.session };
  }
}

/**
 * Holds the durable direct-Google flow and its separate persistent store.
 */
export class FieldnotesDirectOidc {
  /**
   * Complete one-use authorization-code and grant flow.
   */
  readonly flow: OidcFlow;

  /**
   * Binds a ready flow and its persistent store for ordered release.
   *
   * @param flow Ready Google OIDC flow.
   * @param store Its persistent transaction and grant store.
   */
  private constructor(
    flow: OidcFlow,
    private readonly store: PersistentOidcFlowStore,
  ) {
    this.flow = flow;
  }

  /**
   * Creates durable flow state after Google discovery or explicit local test injection.
   *
   * @param settings Trusted Google client configuration.
   * @param publicOrigin Exact HTTPS browser origin.
   * @param factory Shared domain/session storage factory.
   * @param sessions Shared opaque app sessions.
   * @param injectedProvider Test-only verified provider.
   * @returns Ready persistent direct-Google flow.
   */
  static async open(
    settings: GoogleSettings,
    publicOrigin: string,
    factory: StorageFactory,
    sessions: OpaqueSessions,
    injectedProvider?: ConfiguredOidcProvider,
  ): Promise<FieldnotesDirectOidc> {
    const provider =
      injectedProvider ??
      (await createGoogleProvider({
        clientId: settings.clientId,
        clientSecret: settings.clientSecret,
        clientAuthentication: "client_secret_basic",
      }));
    if (provider === undefined) throw new Error("Google OIDC discovery failed.");
    const store = await PersistentOidcFlowStore.create({
      storageFactory: factory,
      group: new StorageGroup("fieldnotes-oidc"),
      flowId: "fieldnotes-google",
    });
    try {
      const flow = this.createFlow(settings, publicOrigin, provider, sessions, store);
      return new FieldnotesDirectOidc(flow, store);
    } catch (error) {
      await store.close();
      throw error;
    }
  }

  /**
   * Connects the trusted provider, exact redirects and durable collaborators.
   *
   * @param settings Trusted Google client.
   * @param publicOrigin Exact HTTPS browser origin.
   * @param provider Verified provider configuration.
   * @param sessions Shared application sessions.
   * @param store Prepared persistent flow state.
   * @returns Bounded OIDC flow.
   */
  private static createFlow(
    settings: GoogleSettings,
    publicOrigin: string,
    provider: ConfiguredOidcProvider,
    sessions: OpaqueSessions,
    store: PersistentOidcFlowStore,
  ): OidcFlow {
    return new OidcFlow({
      authorizationEndpoint: provider.authorizationEndpoint,
      callbackUri: `${publicOrigin}/auth/google/callback`,
      clientId: settings.clientId,
      scopes: provider.recommendedScopes,
      allowedPostLoginRedirects: [`${publicOrigin}/auth/complete`],
      provider: provider.provider,
      identityMapping: new FieldnotesGoogleIdentity(provider.provider.issuer),
      sessionIssuer: new FieldnotesSessionIssuer(sessions),
      store,
    });
  }

  /**
   * Removes expired transactions and grants at a caller-supplied trusted cutoff.
   *
   * @param cutoff Current-or-earlier expiry cutoff.
   * @returns Removed transaction and grant counts.
   */
  purgeExpired(cutoff: Timestamp): Promise<{ transactions: number; grants: number }> {
    return this.store.purgeExpired(cutoff);
  }

  /**
   * Stops flow work before closing its persistent handles.
   *
   * @returns Completion after both layers close.
   */
  async close(): Promise<void> {
    const errors: unknown[] = [];
    try {
      await this.flow.close();
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.store.close();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0) throw new AggregateError(errors, "Fieldnotes Google flow close failed.");
  }
}
