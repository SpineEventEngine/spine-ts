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

/**
 * Safe browser configuration selected by the server without any Admin or OIDC secret.
 */
export type PublicConfig =
  | {
      /**
       * Uses direct Google OIDC.
       */
      readonly mode: "google";
    }
  | {
      /**
       * Uses Firebase browser sign-in with host token verification.
       */
      readonly mode: "firebase";

      /**
       * Public Firebase browser initialization values.
       */
      readonly firebase: {
        /**
         * Public Firebase web API key.
         */
        readonly apiKey: string;

        /**
         * Public Firebase authentication domain.
         */
        readonly authDomain: string;

        /**
         * Public Firebase project identifier.
         */
        readonly projectId: string;

        /**
         * Explicit development-only Firebase Auth emulator origin.
         */
        readonly emulatorUrl?: string;
      };
    };

/**
 * Selects the one configured browser sign-in mode from server-only deployment values.
 */
export const FieldnotesPublicConfig = {
  /**
   * Returns only nonsecret values required for the chosen browser identity SDK.
   *
   * @param environment Explicit deployment values.
   * @param production Whether emulator configuration must be refused.
   * @returns Serializable public browser configuration.
   */
  parse(
    environment: Readonly<Record<string, string | undefined>>,
    production: boolean,
  ): PublicConfig {
    const mode = environment.FIELDNOTES_AUTH_MODE;
    if (mode === "google") return { mode };
    if (mode !== "firebase") throw new Error("Fieldnotes authentication mode is required.");
    const apiKey = this.required(environment.FIELDNOTES_FIREBASE_API_KEY);
    const authDomain = this.required(environment.FIELDNOTES_FIREBASE_AUTH_DOMAIN);
    const projectId = this.required(environment.FIELDNOTES_FIREBASE_PROJECT_ID);
    const emulatorUrl = environment.FIELDNOTES_FIREBASE_EMULATOR_URL;
    if (emulatorUrl !== undefined) {
      const url = new URL(emulatorUrl);
      if (
        production ||
        url.protocol !== "http:" ||
        url.hostname !== "127.0.0.1" ||
        url.origin !== emulatorUrl
      )
        throw new Error("Firebase browser emulator requires a development loopback origin.");
    }
    return {
      mode,
      firebase: {
        apiKey,
        authDomain,
        projectId,
        ...(emulatorUrl === undefined ? {} : { emulatorUrl }),
      },
    };
  },

  /**
   * Validates a browser Firebase value without supplying a deployment default.
   *
   * @param value Configured public value.
   * @returns Nonempty value.
   */
  required(value: string | undefined): string {
    if (!value) throw new Error("Firebase browser configuration is required.");
    return value;
  },
};
