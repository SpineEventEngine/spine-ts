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

import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";

import {
  OidcFlow,
  OpaqueSessions,
  PersistentOidcFlowStore,
  PersistentOpaqueSessionStore,
  PersistentTokenRevocations,
  SignedSessions,
  type ConfiguredOidcProvider,
  type OidcFlowCallbackInput,
} from "@spine-event-engine/auth";
import { Time } from "@spine-event-engine/core/time";
import { InMemoryStorageFactory, StorageGroup } from "@spine-event-engine/storage";

/**
 * Executes three selected component authentication workflows through public APIs.
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Groups the three complete component workflows.
export class ComponentAuthScenarios {
  /**
   * Executes persistent opaque issue, resolution, logout and maintenance.
   *
   * @param password Application-supplied iron-session password.
   * @returns Credential lifecycle and maintenance outcome.
   */
  static async opaque(password: string): Promise<SessionScenarioResult> {
    const factory = new InMemoryStorageFactory();
    let store: PersistentOpaqueSessionStore | undefined;
    let sessions: OpaqueSessions | undefined;
    try {
      store = await PersistentOpaqueSessionStore.create({
        storageFactory: factory,
        group: new StorageGroup("message_board_opaque"),
      });
      sessions = await OpaqueSessions.create({
        store,
        scope: "message-board-browser",
        password,
        clock: { now: Time.currentTimeMillis },
        ttlMilliseconds: 3_600_000,
      });
      const issued = await sessions.issue({ id: "board-user" });
      if (issued.kind !== "created") throw new Error("Opaque session was not issued.");
      const resolved = (await sessions.resolve(issued.credential))?.principal.id === "board-user";
      await sessions.logout(issued.credential);
      const revoked = (await sessions.resolve(issued.credential)) === undefined;
      return { resolved, revoked, removed: await sessions.purgeExpired(Time.currentTime()) };
    } finally {
      await this.#close(factory, store, sessions);
    }
  }

  /**
   * Executes signed issue, verification, revocation and maintenance.
   *
   * @returns Credential lifecycle and maintenance outcome.
   */
  static async signed(): Promise<SessionScenarioResult> {
    const factory = new InMemoryStorageFactory();
    let store: PersistentTokenRevocations | undefined;
    let sessions: SignedSessions | undefined;
    try {
      store = await PersistentTokenRevocations.create({
        storageFactory: factory,
        group: new StorageGroup("message_board_revocations"),
        issuer: "message-board",
        audience: "board-client",
      });
      const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      sessions = new SignedSessions({
        issuer: "message-board",
        audience: "board-client",
        activeKey: { kid: "local-key", privateKey },
        revocation: store,
      });
      const issued = await sessions.issue({ id: "board-user" });
      if (issued.kind !== "issued") throw new Error("Signed session was not issued.");
      const resolved = (await sessions.resolve(issued.credential))?.principal.id === "board-user";
      const logout = await sessions.logout(issued.credential);
      const revoked =
        logout.kind === "revoked" && (await sessions.resolve(issued.credential)) === undefined;
      return { resolved, revoked, removed: await store.purgeExpired(Time.currentTime()) };
    } finally {
      await this.#close(factory, store, sessions);
    }
  }

  /**
   * Executes component OIDC start, callback, grant exchange and maintenance.
   *
   * @param provider Verified provider adapter selected by the application.
   * @param password Application-supplied session seal password.
   * @param handoff Browser or application callback that visits the authorization URL and returns its callback parameters.
   * @returns Grant, session and maintenance outcomes.
   */
  static async oidc(
    provider: ConfiguredOidcProvider,
    password: string,
    handoff: (authorizationUrl: string) => Promise<OidcFlowCallbackInput>,
  ): Promise<OidcScenarioResult> {
    const factory = new InMemoryStorageFactory();
    let store: PersistentOidcFlowStore | undefined;
    let sessions: OpaqueSessions | undefined;
    let flow: OidcFlow | undefined;
    try {
      store = await PersistentOidcFlowStore.create({
        storageFactory: factory,
        group: new StorageGroup("message_board_oidc"),
        flowId: "message-board-login",
      });
      sessions = await OpaqueSessions.create({
        scope: "message-board-oidc-session",
        password,
        clock: { now: Time.currentTimeMillis },
        ttlMilliseconds: 3_600_000,
      });
      flow = this.#flow(provider, sessions, store);
      return await this.#exchange(flow, sessions, handoff);
    } finally {
      await this.#close(factory, store, sessions, flow);
    }
  }

  /**
   * Closes all resources created by a local scenario, including partial setup.
   *
   * @param factory Local storage factory.
   * @param store Optional prepared component store.
   * @param sessions Optional session strategy.
   * @param flow Optional OIDC flow.
   */
  static async #close(
    factory: InMemoryStorageFactory,
    store?: { close(): Promise<void> },
    sessions?: { close(): Promise<void> },
    flow?: OidcFlow,
  ): Promise<void> {
    try {
      await flow?.close();
    } finally {
      try {
        await sessions?.close();
      } finally {
        try {
          await store?.close();
        } finally {
          await factory.close();
        }
      }
    }
  }

  /**
   * Binds a selected provider and application session strategy to the flow.
   *
   * @param provider Verified provider adapter.
   * @param sessions Application session strategy.
   * @param store Prepared transaction and grant store.
   * @returns Configured one-use component flow.
   */
  static #flow(
    provider: ConfiguredOidcProvider,
    sessions: OpaqueSessions,
    store: PersistentOidcFlowStore,
  ): OidcFlow {
    return new OidcFlow({
      authorizationEndpoint: provider.authorizationEndpoint,
      callbackUri: "https://board.example.test/auth/callback",
      clientId: "message-board-client",
      scopes: provider.recommendedScopes,
      allowedPostLoginRedirects: ["https://board.example.test/board"],
      provider: provider.provider,
      store,
      identityMapping: {
        resolve: (identity) =>
          Promise.resolve({
            externalIdentity: identity,
            principal: { id: identity.subject },
          }),
      },
      sessionIssuer: {
        issue: async (principal, signal) => {
          const result = await sessions.issue(principal, signal);
          return result.kind === "created"
            ? { credential: result.credential, session: result.session }
            : undefined;
        },
      },
    });
  }

  /**
   * Completes one component flow using an injected verified provider adapter.
   *
   * @param flow Configured application flow.
   * @param sessions Selected application session strategy.
   * @param handoff Browser or application callback after visiting the authorization URL.
   * @returns Observed issuance, replay refusal and maintenance results.
   */
  static async #exchange(
    flow: OidcFlow,
    sessions: OpaqueSessions,
    handoff: (authorizationUrl: string) => Promise<OidcFlowCallbackInput>,
  ): Promise<OidcScenarioResult> {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const started = await flow.start({
      browserCodeChallenge: challenge,
      postLoginRedirect: "https://board.example.test/board",
    });
    if (started.kind !== "started") throw new Error("OIDC transaction was not persisted.");
    const callback = await handoff(started.authorizationUrl);
    const granted = await flow.callback(callback);
    if (granted.kind !== "granted")
      throw new Error(`Verified callback was not granted: ${granted.reason}.`);
    const replayRejected = (await flow.callback(callback)).kind === "rejected";
    const exchanged = await flow.exchange({ grant: granted.grant, browserCodeVerifier: verifier });
    if (exchanged.kind !== "issued") throw new Error("Application session was not issued.");
    const resolved = (await sessions.resolve(exchanged.credential)) !== undefined;
    return {
      issued: true,
      replayRejected,
      resolved,
      removed: await flow.purgeExpired(Time.currentTime()),
    };
  }
}

/**
 * Observed credential lifecycle and explicit maintenance outcome.
 */
export interface SessionScenarioResult {
  /**
   * Whether the newly issued credential resolved to the expected principal.
   */
  readonly resolved: boolean;

  /**
   * Whether logout stopped later resolution.
   */
  readonly revoked: boolean;

  /**
   * Number of expired records removed by the explicit maintenance call.
   */
  readonly removed: number;
}

/**
 * Observed component OIDC transition and explicit maintenance outcome.
 */
export interface OidcScenarioResult {
  /**
   * Whether the grant issued an application session.
   */
  readonly issued: boolean;

  /**
   * Whether the consumed callback state refused a replay.
   */
  readonly replayRejected: boolean;

  /**
   * Whether the issued credential resolves to the mapped principal.
   */
  readonly resolved: boolean;

  /**
   * Transaction and grant rows removed by explicit maintenance.
   */
  readonly removed: { readonly transactions: number; readonly grants: number };
}
