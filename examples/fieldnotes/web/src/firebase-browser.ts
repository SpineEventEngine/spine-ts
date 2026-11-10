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

import { initializeApp, deleteApp, type FirebaseApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  inMemoryPersistence,
  setPersistence,
  signInWithPopup,
  signOut,
  type Auth,
} from "firebase/auth";
import type { PublicConfig } from "./public-config";

/**
 * Firebase browser settings selected by the Fieldnotes server page.
 */
type FirebasePublic = Extract<PublicConfig, { mode: "firebase" }>["firebase"];

/**
 * Uses the official Firebase browser SDK only to obtain a Google ID token.
 */
export class FieldnotesFirebaseBrowser {
  readonly #app: FirebaseApp;

  readonly #auth: Auth;

  /**
   * Sets up one browser app and the explicitly configured local emulator.
   *
   * @param settings Public Firebase project and optional development emulator.
   */
  constructor(settings: FirebasePublic) {
    this.#app = initializeApp(
      {
        apiKey: settings.apiKey,
        authDomain: settings.authDomain,
        projectId: settings.projectId,
      },
      "fieldnotes-browser",
    );
    this.#auth = getAuth(this.#app);
    if (settings.emulatorUrl !== undefined)
      connectAuthEmulator(this.#auth, settings.emulatorUrl, { disableWarnings: true });
  }

  /**
   * Opens the actual Google popup and returns a fresh ID token for host exchange.
   *
   * @returns Firebase-issued Google user ID token.
   */
  async googleToken(): Promise<string> {
    await setPersistence(this.#auth, inMemoryPersistence);
    const result = await signInWithPopup(this.#auth, new GoogleAuthProvider());
    return result.user.getIdToken();
  }

  /**
   * Clears the SDK's in-memory identity after app logout or failed exchange.
   *
   * @returns Completion after best-effort SDK sign-out.
   */
  async clear(): Promise<void> {
    await signOut(this.#auth).catch(() => undefined);
  }

  /**
   * Closes the Firebase app when the browser shell is disposed.
   *
   * @returns Completion after the SDK app closes.
   */
  async close(): Promise<void> {
    await this.clear();
    await deleteApp(this.#app);
  }
}
