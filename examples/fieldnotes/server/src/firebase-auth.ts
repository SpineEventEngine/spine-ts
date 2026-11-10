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

import { randomUUID } from "node:crypto";
import { applicationDefault, deleteApp, initializeApp, type App } from "firebase-admin/app";
import { AuthErrorCode, FirebaseAuthError, getAuth } from "firebase-admin/auth";
import type { AuthenticatedPrincipal } from "@spine-event-engine/auth";
import { Time } from "@spine-event-engine/core";

/**
 * Verified Firebase claim fields needed by the Fieldnotes exchange.
 */
export interface FieldnotesFirebaseClaims {
  /**
   * Stable user identifier within the selected Firebase project.
   */
  readonly uid: string;

  /**
   * Token audience supplied by Admin verification.
   */
  readonly aud: string;

  /**
   * Token issuer supplied by Admin verification.
   */
  readonly iss: string;

  /**
   * Authentication time in Unix seconds.
   */
  readonly auth_time: number;

  /**
   * Firebase sign-in provider asserted in the token.
   */
  readonly firebase?: { readonly sign_in_provider?: string };
}

/**
 * Narrow official Admin verification surface for explicit test injection.
 */
export interface FieldnotesFirebaseVerifier {
  /**
   * Verifies signature, expiry, project and revocation through Admin.
   *
   * @param token Browser Firebase ID token.
   * @param checkRevoked Whether Admin checks server-side revocation.
   * @returns Verified claims.
   */
  verifyIdToken(token: string, checkRevoked: boolean): Promise<FieldnotesFirebaseClaims>;
}

/**
 * Maps one verified recent Google sign-in to a project-qualified principal.
 */
export class FieldnotesFirebaseIdentity {
  /**
   * Binds one explicit Firebase project and recent-login policy.
   *
   * @param projectId Exact accepted project.
   * @param recentLoginMilliseconds Maximum accepted login age.
   * @param verifier Official Admin verification or explicit test substitute.
   * @param now Trusted current Unix milliseconds.
   */
  constructor(
    private readonly projectId: string,
    private readonly recentLoginMilliseconds: number,
    private readonly verifier: FieldnotesFirebaseVerifier,
    private readonly now: () => number = Time.currentTimeMillis,
  ) {
    if (
      !projectId ||
      !Number.isSafeInteger(recentLoginMilliseconds) ||
      recentLoginMilliseconds <= 0
    )
      throw new Error("Firebase project and recent-login policy are required.");
  }

  /**
   * Verifies a browser ID token before exposing any application principal.
   * Ambiguous Admin argument errors remain operational failures because key fetch can share that code.
   *
   * @param token Browser Firebase ID token.
   * @returns Project-qualified principal, or undefined for rejected identity.
   */
  async verify(token: string): Promise<AuthenticatedPrincipal | undefined> {
    if (!token) return undefined;
    let claims: FieldnotesFirebaseClaims;
    try {
      claims = await this.verifier.verifyIdToken(token, true);
    } catch (error) {
      if (
        error instanceof FirebaseAuthError &&
        [
          AuthErrorCode.INVALID_ID_TOKEN,
          AuthErrorCode.ID_TOKEN_EXPIRED,
          AuthErrorCode.ID_TOKEN_REVOKED,
          AuthErrorCode.USER_DISABLED,
          AuthErrorCode.USER_NOT_FOUND,
        ].some((code) => error.code === `auth/${code}`)
      )
        return undefined;
      throw error;
    }
    const now = this.now();
    const login = claims.auth_time * 1_000;
    if (
      !claims.uid ||
      claims.aud !== this.projectId ||
      claims.iss !== `https://securetoken.google.com/${this.projectId}` ||
      claims.firebase?.sign_in_provider !== "google.com" ||
      !Number.isSafeInteger(claims.auth_time) ||
      !Number.isSafeInteger(now) ||
      login > now ||
      now - login > this.recentLoginMilliseconds
    )
      return undefined;
    return { id: JSON.stringify(["firebase-google", this.projectId, claims.uid]) };
  }
}

/**
 * Creates and releases one explicitly configured Firebase Admin application.
 */
export class FieldnotesFirebaseAdmin {
  /**
   * Opens official Admin verification with application default credentials.
   *
   * @param projectId Exact accepted Firebase project.
   * @returns Open verifier and its application lifetime.
   */
  static async open(projectId: string): Promise<FieldnotesFirebaseAdmin> {
    const app = initializeApp(
      { credential: applicationDefault(), projectId },
      `fieldnotes-${randomUUID()}`,
    );
    try {
      return new FieldnotesFirebaseAdmin(app, getAuth(app));
    } catch (error) {
      await deleteApp(app);
      throw error;
    }
  }

  /**
   * Uses the official Admin verifier for this application.
   */
  readonly verifier: FieldnotesFirebaseVerifier;

  /**
   * Binds an initialized Admin application to its verifier.
   *
   * @param app Initialized official Admin application.
   * @param verifier Official token verification service.
   */
  private constructor(
    private readonly app: App,
    verifier: FieldnotesFirebaseVerifier,
  ) {
    this.verifier = verifier;
  }

  /**
   * Closes this Admin application after the host stops requests.
   *
   * @returns Completion after Admin resources close.
   */
  close(): Promise<void> {
    return deleteApp(this.app);
  }
}
