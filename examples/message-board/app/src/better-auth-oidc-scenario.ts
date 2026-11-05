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
  BetterAuthIntegration,
  PersistentBetterAuthStore,
  genericOAuth,
} from "@spine-event-engine/auth/better-auth";
import { Time } from "@spine-event-engine/core/time";
import { InMemoryStorageFactory, StorageGroup } from "@spine-event-engine/storage";

const origin = "http://localhost:3000";

/**
 * Exercises one administrator-prelinked native OIDC account through exact routes.
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Groups the selected native OIDC scenario steps.
export class BetterAuthOidcScenario {
  /**
   * Starts provider authorization, accepts its callback, and checks native logout.
   *
   * @param secret Native cookie signing secret.
   * @param discoveryUrl Trusted provider metadata URL.
   * @param handoff Application/browser visit that returns the provider callback URL.
   * @returns Resolution, replay refusal, logout, and maintenance outcomes.
   */
  static async prelinked(
    secret: string,
    discoveryUrl: string,
    handoff: (authorizationUrl: string) => Promise<URL>,
  ): Promise<BetterAuthOidcResult> {
    const factory = new InMemoryStorageFactory();
    let store: PersistentBetterAuthStore | undefined;
    let auth: BetterAuthIntegration | undefined;
    try {
      store = await PersistentBetterAuthStore.create({
        storageFactory: factory,
        group: new StorageGroup("message_board_prelinked_oidc"),
        models: ["user", "account", "session", "verification"],
      });
      await this.#provision(store);
      auth = await this.#integration(store, secret, discoveryUrl);
      return await this.#exercise(auth, store, handoff);
    } finally {
      await this.#close(factory, store, auth);
    }
  }

  /**
   * Provisions the complete User and immutable provider Account before sign-in.
   *
   * @param store Prepared selected record store.
   */
  static async #provision(store: PersistentBetterAuthStore): Promise<void> {
    const createdAt = new Date(Time.currentTimeMillis());
    await store.provision({
      users: [
        {
          id: "board-user",
          name: "Ada",
          email: "ada@example.test",
          emailVerified: true,
          createdAt,
          updatedAt: createdAt,
        },
      ],
      accounts: [
        {
          userId: "board-user",
          accountId: "board-subject",
          providerId: "company",
          createdAt,
          updatedAt: createdAt,
        },
      ],
    });
  }

  /**
   * Closes all acquired resources after success or partial setup.
   *
   * @param factory Local storage factory.
   * @param store Optional selected record store.
   * @param auth Optional native integration.
   */
  static async #close(
    factory: InMemoryStorageFactory,
    store?: PersistentBetterAuthStore,
    auth?: BetterAuthIntegration,
  ): Promise<void> {
    try {
      await auth?.close();
    } finally {
      try {
        await store?.close();
      } finally {
        await factory.close();
      }
    }
  }

  /**
   * Initializes only the selected native generic OAuth profile.
   *
   * @param store Prepared native selected-record store.
   * @param secret Native signing secret.
   * @param discoveryUrl Trusted provider metadata URL.
   * @returns Ready exact native routes.
   */
  static #integration(
    store: PersistentBetterAuthStore,
    secret: string,
    discoveryUrl: string,
  ): Promise<BetterAuthIntegration> {
    return BetterAuthIntegration.create({
      store,
      routePolicy: { maxRequestBytes: 4_096, timeoutMs: 5_000 },
      options: {
        baseURL: origin,
        basePath: "/auth",
        secret,
        trustedOrigins: [origin],
        account: { accountLinking: { enabled: false } },
        plugins: [
          genericOAuth({
            config: [
              {
                providerId: "company",
                discoveryUrl,
                clientId: "board-client",
                tokenEndpointAuth: { method: "none" },
                pkce: true,
                requireIdTokenVerification: true,
                disableSignUp: true,
                overrideUserInfo: false,
              },
            ],
          }),
        ],
      },
      onPrincipal: (user) => Promise.resolve({ id: user.id }),
    });
  }

  /**
   * Uses the actual redirect URL and state cookie before one native callback.
   *
   * @param auth Ready native route collection and session resolver.
   * @param store Selected record store for explicit maintenance.
   * @param handoff Application/browser callback after visiting authorization.
   * @returns Observed session and one-use state outcomes.
   */
  static async #exercise(
    auth: BetterAuthIntegration,
    store: PersistentBetterAuthStore,
    handoff: (authorizationUrl: string) => Promise<URL>,
  ): Promise<BetterAuthOidcResult> {
    const logout = auth.routes.find((route) => route.path === "/auth/sign-out");
    if (logout === undefined) throw new Error("Native sign-out route was absent.");
    const { accepted, replay } = await this.#callback(auth, handoff);
    const sessionCookie = this.#sessionCookie(auth, accepted);
    const credential = { kind: "cookie", value: sessionCookie } as const;
    const resolved = (await auth.sessions.resolve(credential))?.principal.id === "board-user";
    const ended = await logout.onRequest(
      new Request(`${origin}/auth/sign-out`, {
        method: "POST",
        headers: { origin, cookie: sessionCookie },
      }),
      new AbortController().signal,
    );
    return {
      resolved,
      replayRejected: replay.status === 401,
      loggedOut: ended.status === 200 && (await auth.sessions.resolve(credential)) === undefined,
      removed: await store.purgeExpired(Time.currentTime()),
    };
  }

  /**
   * Starts native authorization, then returns the one-use callback outcomes.
   *
   * @param auth Ready native route collection.
   * @param handoff Browser visit returning the provider callback URL.
   * @returns First and repeated native callback responses.
   */
  static async #callback(
    auth: BetterAuthIntegration,
    handoff: (authorizationUrl: string) => Promise<URL>,
  ): Promise<{ accepted: Response; replay: Response }> {
    const start = auth.routes.find((route) => route.path === "/auth/sign-in/social");
    const callback = auth.routes.find((route) => route.path === "/auth/callback/company");
    if (start === undefined || callback === undefined)
      throw new Error("Selected native OIDC routes were absent.");
    const started = await start.onRequest(
      new Request(`${origin}/auth/sign-in/social`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ provider: "company", callbackURL: `${origin}/board` }),
      }),
      new AbortController().signal,
    );
    if (started.status !== 200) throw new Error("Native OIDC start failed.");
    const { url } = (await started.json()) as { url: string };
    const stateCookie = started.headers
      .getSetCookie()
      .map((line) => line.split(";", 1).join(""))
      .join("; ");
    const callbackUrl = await handoff(url);
    const request = () => new Request(callbackUrl, { headers: { cookie: stateCookie } });
    return {
      accepted: await callback.onRequest(request(), new AbortController().signal),
      replay: await callback.onRequest(request(), new AbortController().signal),
    };
  }

  /**
   * Selects the configured primary credential cookie from a successful callback.
   *
   * @param auth Native cookie admission declaration.
   * @param response Native callback response.
   * @returns Primary credential name and value.
   */
  static #sessionCookie(auth: BetterAuthIntegration, response: Response): string {
    if (response.status !== 302) throw new Error("Native OIDC callback was not accepted.");
    const names = auth.credentials.admission.credentialCookieNames;
    const cookie = response.headers
      .getSetCookie()
      .map((line) => line.split(";", 1).join(""))
      .find((line) => names.some((name) => line.startsWith(`${name}=`)));
    if (cookie === undefined) throw new Error("Native OIDC session cookie was absent.");
    return cookie;
  }
}

/**
 * Observed prelinked native OIDC workflow and explicit maintenance outcome.
 */
export interface BetterAuthOidcResult {
  /**
   * The native credential resolved to the prelinked User's principal.
   */
  readonly resolved: boolean;

  /**
   * A repeated state callback was terminally rejected.
   */
  readonly replayRejected: boolean;

  /**
   * Strict logout stopped authoritative session resolution.
   */
  readonly loggedOut: boolean;

  /**
   * Expired selected records removed by explicit maintenance.
   */
  readonly removed: number;
}
