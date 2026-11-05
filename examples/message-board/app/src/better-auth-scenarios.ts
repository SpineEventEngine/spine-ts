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
  type BetterAuthVerifiedLogin,
} from "@spine-event-engine/auth/better-auth";
import { Time } from "@spine-event-engine/core/time";
import { InMemoryStorageFactory, StorageGroup } from "@spine-event-engine/storage";
import { hashPassword } from "@better-auth/utils/password";

const origin = "http://localhost:3000";
const email = "ada@example.test";

/**
 * Executes selected native Better Auth workflows through public application APIs.
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Groups related selected native login workflows.
export class BetterAuthScenarios {
  /**
   * Creates a complete User and credential Account before native password login.
   *
   * @param secret Application native cookie signing secret.
   * @param password Administrator-selected password to provision and submit.
   * @returns Refusal, session resolution, logout, and maintenance outcomes.
   */
  static async password(secret: string, password: string): Promise<BetterAuthScenarioResult> {
    const factory = new InMemoryStorageFactory();
    let store: PersistentBetterAuthStore | undefined;
    let auth: BetterAuthIntegration | undefined;
    try {
      store = await PersistentBetterAuthStore.create({
        storageFactory: factory,
        group: new StorageGroup("message_board_better_auth"),
        models: ["user", "account", "session"],
      });
      await this.#provisionPassword(store, password);
      auth = await this.#integration(store, secret);
      return await this.#exercise(
        auth,
        store,
        "/auth/sign-in/email",
        this.#loginRequest(password),
        this.#loginRequest("wrong-password-123"),
      );
    } finally {
      await this.#close(factory, store, auth);
    }
  }

  /**
   * Creates native sessions through an application User directory and verified login proof.
   *
   * @param secret Application native cookie signing secret.
   * @param verify Application proof verifier; return only a stable User ID after validation.
   * @param acceptedProof Proof supplied to the accepted local request.
   * @returns Refusal, session resolution, logout, and maintenance outcomes.
   */
  static async external(
    secret: string,
    verify: BetterAuthVerifiedLogin["verify"],
    acceptedProof: string,
  ): Promise<BetterAuthScenarioResult> {
    const factory = new InMemoryStorageFactory();
    let store: PersistentBetterAuthStore | undefined;
    let auth: BetterAuthIntegration | undefined;
    try {
      const user = this.#user();
      store = await PersistentBetterAuthStore.create({
        storageFactory: factory,
        group: new StorageGroup("message_board_external_login"),
        models: ["session"],
        users: { findById: (id) => Promise.resolve(id === user.id ? user : undefined) },
      });
      auth = await this.#integration(store, secret, { verify });
      return await this.#exercise(
        auth,
        store,
        "/auth/sign-in/external",
        this.#externalRequest(acceptedProof),
        this.#externalRequest("unverified"),
      );
    } finally {
      await this.#close(factory, store, auth);
    }
  }

  /**
   * Provisions a complete native credential identity before login traffic.
   *
   * @param store Prepared selected record store.
   * @param password Administrator-selected password.
   */
  static async #provisionPassword(
    store: PersistentBetterAuthStore,
    password: string,
  ): Promise<void> {
    const user = this.#user();
    await store.provision({
      users: [user],
      accounts: [
        {
          userId: user.id,
          accountId: user.id,
          providerId: "credential",
          password: await hashPassword(password),
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      ],
    });
  }

  /**
   * Creates one complete local User value.
   *
   * @returns Stable identity and native required fields.
   */
  static #user() {
    const createdAt = new Date(Time.currentTimeMillis());
    return {
      id: "board-user",
      name: "Ada",
      email,
      emailVerified: true,
      createdAt,
      updatedAt: createdAt,
    };
  }

  /**
   * Closes all acquired resources even when a later close fails.
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
   * Creates the selected native session integration over provisioned records.
   *
   * @param store Prepared selected record store.
   * @param secret Native signing secret.
   * @param login Optional trusted application login verifier.
   * @returns Ready exact routes and authoritative session reader.
   */
  static #integration(
    store: PersistentBetterAuthStore,
    secret: string,
    login?: BetterAuthVerifiedLogin,
  ): Promise<BetterAuthIntegration> {
    return BetterAuthIntegration.create({
      store,
      routePolicy: { maxRequestBytes: 4_096, timeoutMs: 5_000 },
      options: {
        baseURL: origin,
        basePath: "/auth",
        secret,
        trustedOrigins: [origin],
        ...(!login && {
          emailAndPassword: { enabled: true as const, disableSignUp: true as const },
        }),
        account: { accountLinking: { enabled: false } },
        session: { cookieCache: { enabled: false } },
      },
      onPrincipal: (user) => Promise.resolve({ id: user.id }),
      ...(login && { login }),
    });
  }

  /**
   * Checks native refusal, issuance, authoritative read, and strict logout.
   *
   * @param auth Ready native integration.
   * @param store Selected session store for explicit maintenance.
   * @param path Selected exact native login path.
   * @param acceptedRequest Application request with accepted proof.
   * @param refusedRequest Application request with refused proof.
   * @returns Observed workflow outcome.
   */
  static async #exercise(
    auth: BetterAuthIntegration,
    store: PersistentBetterAuthStore,
    path: string,
    acceptedRequest: Request,
    refusedRequest: Request,
  ): Promise<BetterAuthScenarioResult> {
    const login = auth.routes.find((route) => route.path === path);
    const logout = auth.routes.find((route) => route.path === "/auth/sign-out");
    if (login === undefined || logout === undefined)
      throw new Error("Selected native routes were absent.");
    const wrong = await login.onRequest(refusedRequest, new AbortController().signal);
    const accepted = await login.onRequest(acceptedRequest, new AbortController().signal);
    const cookie = accepted.headers.get("set-cookie")?.split(";")[0];
    if (cookie === undefined || accepted.status !== 200)
      throw new Error("Native login was not issued.");
    const credential = { kind: "cookie", value: cookie } as const;
    const resolved = (await auth.sessions.resolve(credential))?.principal.id === "board-user";
    const ended = await logout.onRequest(
      new Request(`${origin}/auth/sign-out`, {
        method: "POST",
        headers: { origin, cookie },
      }),
      new AbortController().signal,
    );
    return {
      refused: wrong.status === 401 && wrong.headers.get("set-cookie") === null,
      resolved,
      loggedOut: ended.status === 200 && (await auth.sessions.resolve(credential)) === undefined,
      removed: await store.purgeExpired(Time.currentTime()),
    };
  }

  /**
   * Forms one exact admitted native password request.
   *
   * @param password Submitted password.
   * @returns Browser request to the selected password route.
   */
  static #loginRequest(password: string): Request {
    return new Request(`${origin}/auth/sign-in/email`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  }

  /**
   * Forms one local request whose proof must be validated by the application.
   *
   * @param proof Untrusted supplied proof.
   * @returns Browser request to the selected external login route.
   */
  static #externalRequest(proof: string): Request {
    return new Request(`${origin}/auth/sign-in/external`, {
      method: "POST",
      headers: { origin, authorization: `Bearer ${proof}` },
    });
  }
}

/**
 * Observed selected native password workflow and explicit maintenance outcome.
 */
export interface BetterAuthScenarioResult {
  /**
   * Wrong password produced a terminal refusal without a session cookie.
   */
  readonly refused: boolean;

  /**
   * The native cookie resolved to the expected application principal.
   */
  readonly resolved: boolean;

  /**
   * Strict logout stopped authoritative resolution.
   */
  readonly loggedOut: boolean;

  /**
   * Expired native records removed by the explicit maintenance call.
   */
  readonly removed: number;
}
