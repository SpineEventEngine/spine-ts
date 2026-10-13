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

/**
 * A registration's verified identity and renewable grant for this app process.
 */
export interface SavedRegistration {
  /**
   * Issued OAuth client identifier.
   */
  clientId: string;

  /**
   * Verified identity issuer.
   */
  issuer: string;

  /**
   * Verified account subject.
   */
  subject: string;

  /**
   * Verified account email address.
   */
  email?: string;

  /**
   * Granted OAuth scopes.
   */
  scopes?: string[];

  /**
   * Authorized access token.
   */
  accessToken?: string;

  /**
   * Rotating refresh token.
   */
  refreshToken?: string;

  /**
   * Verified identity token used as a login hint.
   */
  idToken?: string;

  /**
   * Access token expiry time.
   */
  expiresAt?: number;
}

const copyRegistration = (registration: SavedRegistration): SavedRegistration => ({
  ...registration,
  ...(registration.scopes === undefined ? {} : { scopes: [...registration.scopes] }),
});

/**
 * Keeps OAuth grants and the host identifier in this process only.
 */
export class CredentialStore {
  private readonly id = `urn:uuid:${randomUUID()}`;

  private readonly grants = new Map<string, SavedRegistration>();

  private readonly pending = new Set<string>();

  /**
   * Returns the identifier used for OAuth registrations in this app process.
   *
   * @returns Process-local host identifier.
   */
  hostId(): Promise<string> {
    return Promise.resolve(this.id);
  }

  /**
   * Lists detached copies of verified registrations.
   *
   * @returns Current in-memory registrations.
   */
  registrations(): Promise<readonly SavedRegistration[]> {
    return Promise.resolve([...this.grants.values()].map(copyRegistration));
  }

  /**
   * Returns a detached copy of one verified registration.
   *
   * @param clientId Issued OAuth client identifier.
   * @returns Current registration, if present.
   */
  registration(clientId: string): Promise<SavedRegistration | undefined> {
    const registration = this.grants.get(clientId);
    return Promise.resolve(registration === undefined ? undefined : copyRegistration(registration));
  }

  /**
   * Lists issued clients awaiting a grant in this process.
   *
   * @returns Pending issued client identifiers.
   */
  pendingClientIds(): Promise<readonly string[]> {
    return Promise.resolve([...this.pending]);
  }

  /**
   * Stores a verified registration and consumes its pending client ID.
   *
   * @param registration Verified OAuth identity and grant.
   * @returns Completion after retaining the grant in this process.
   */
  save(registration: SavedRegistration): Promise<void> {
    this.grants.clear();
    this.grants.set(registration.clientId, copyRegistration(registration));
    this.pending.clear();
    return Promise.resolve();
  }

  /**
   * Records an issued client while this process retries browser authorization.
   *
   * @param clientId Issued OAuth client identifier.
   * @returns Completion after staging the client in this process.
   */
  stageIssuedClient(clientId: string): Promise<void> {
    this.pending.add(clientId);
    return Promise.resolve();
  }

  /**
   * Removes all in-session account grants and pending retries after sign-out.
   *
   * @param clientId Issued OAuth client identifier.
   * @returns Completion after clearing the in-session grant and pending clients.
   */
  clearTokens(clientId: string): Promise<void> {
    this.grants.delete(clientId);
    this.pending.clear();
    return Promise.resolve();
  }
}
