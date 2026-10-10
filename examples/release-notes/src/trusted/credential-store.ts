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
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";

/**
 * Encodes trusted-process data with an OS-protected key.
 */
export interface CredentialCipher {
  /**
   * Encodes credential text with OS-backed storage.
   *
   * @param value The value for this operation.
   * @returns The encrypt result.
   */
  encrypt(value: string): Uint8Array;

  /**
   * Decodes credential text with OS-backed storage.
   *
   * @param value The value for this operation.
   * @returns The decrypt result.
   */
  decrypt(value: Uint8Array): string;
}

/**
 * A registration's verified identity and optional renewable session.
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

interface SavedCredentials {
  /**
   * The host id value.
   */
  hostId: string;

  /**
   * The registrations value.
   */
  registrations: SavedRegistration[];

  /**
   * The pending client ids value.
   */
  pendingClientIds?: string[];
}

/**
 * Atomic encrypted storage for local account registrations.
 */
export class CredentialStore {
  /**
   * The file value.
   */
  private readonly file: string;

  /**
   * The updates value.
   */
  private updates: Promise<void> = Promise.resolve();

  /**
   * Initializes the trusted service.
   *
   * @param directory The directory for this operation.
   * @param cipher The cipher for this operation.
   */
  constructor(
    directory: string,
    private readonly cipher: CredentialCipher,
  ) {
    this.file = join(directory, "credentials.bin");
  }

  /**
   * Returns the persistent installation identifier.
   *
   * @returns The host id result.
   */
  async hostId(): Promise<string> {
    const existing = await this.read();
    if (existing !== undefined) return existing.hostId;
    const hostId = `urn:uuid:${randomUUID()}`;
    await this.update((current) => ({ ...current, hostId }));
    return (await this.read())?.hostId ?? hostId;
  }

  /**
   * Lists the saved account registrations.
   *
   * @returns The registrations result.
   */
  async registrations(): Promise<readonly SavedRegistration[]> {
    return (await this.read())?.registrations ?? [];
  }

  /**
   * Returns a saved account registration.
   *
   * @param clientId Issued OAuth client identifier.
   * @returns The registration result.
   */
  async registration(clientId: string): Promise<SavedRegistration | undefined> {
    return (await this.registrations()).find((entry) => entry.clientId === clientId);
  }

  /**
   * Lists issued clients awaiting a verified authorization grant.
   *
   * @returns Issued client identifiers retained for browser retry.
   */
  async pendingClientIds(): Promise<readonly string[]> {
    return (await this.read())?.pendingClientIds ?? [];
  }

  /**
   * Stores an account registration.
   *
   * @param registration The registration for this operation.
   * @returns The save result.
   */
  async save(registration: SavedRegistration): Promise<void> {
    await this.update((current) => ({
      ...current,
      registrations: [
        ...current.registrations.filter((entry) => entry.clientId !== registration.clientId),
        registration,
      ],
      pendingClientIds: (current.pendingClientIds ?? []).filter(
        (id) => id !== registration.clientId,
      ),
    }));
  }

  /**
   * Persists an issued client identifier before token exchange.
   *
   * @param clientId Issued OAuth client identifier.
   * @returns The stage issued client result.
   */
  async stageIssuedClient(clientId: string): Promise<void> {
    await this.update((current) => ({
      ...current,
      pendingClientIds: [...new Set([...(current.pendingClientIds ?? []), clientId])],
    }));
  }

  /**
   * Clears local tokens while retaining the issued client mapping.
   *
   * @param clientId Issued OAuth client identifier.
   * @returns The clear tokens result.
   */
  async clearTokens(clientId: string): Promise<void> {
    await this.update((current) => ({
      ...current,
      registrations: current.registrations.map((entry) =>
        entry.clientId === clientId
          ? {
              clientId: entry.clientId,
              issuer: entry.issuer,
              subject: entry.subject,
              ...(entry.email === undefined ? {} : { email: entry.email }),
            }
          : entry,
      ),
    }));
  }

  /**
   * Updates the encrypted credential file atomically.
   *
   * @param change The change for this operation.
   * @returns The update result.
   */
  private async update(change: (current: SavedCredentials) => SavedCredentials): Promise<void> {
    const next = this.updates.then(async () => {
      const current = (await this.read()) ?? {
        hostId: `urn:uuid:${randomUUID()}`,
        registrations: [],
      };
      const value = this.cipher.encrypt(JSON.stringify(change(current)));
      const directory = this.file.slice(0, this.file.lastIndexOf("/"));
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        const handle = await open(temporary, "wx", 0o600);
        try {
          await handle.writeFile(value);
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temporary, this.file);
      } finally {
        await rm(temporary, { force: true });
      }
    });
    this.updates = next.catch(() => undefined);
    await next;
  }

  /**
   * Reads the encrypted credential file.
   *
   * @returns The read result.
   */
  private async read(): Promise<SavedCredentials | undefined> {
    let bytes: Uint8Array;
    try {
      bytes = await readFile(this.file);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    }
    return JSON.parse(this.cipher.decrypt(bytes)) as SavedCredentials;
  }
}
