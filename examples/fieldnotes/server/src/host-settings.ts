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
 * Required, explicit settings for one persistent Fieldnotes host launch.
 */
export interface FieldnotesSettings {
  /**
   * PostgreSQL database provisioned outside this application.
   */
  readonly postgresUrl: string;

  /**
   * HTTPS public origin used by the same-origin browser proxy.
   */
  readonly publicOrigin: string;

  /**
   * Stable iron-session password retained across restarts.
   */
  readonly sessionPassword: string;

  /**
   * Stable secret for credential-bound CSRF cookies.
   */
  readonly csrfSecret: Uint8Array;

  /**
   * Separate stable secret for private native reader proof.
   */
  readonly readerProofSecret: Uint8Array;

  /**
   * Explicit app-session lifetime in milliseconds.
   */
  readonly sessionTtlMilliseconds: number;

  /**
   * Explicit deadline for each bounded auth callback.
   */
  readonly authRouteTimeoutMs: number;

  /**
   * Explicit maximum request bytes for each auth callback.
   */
  readonly authRouteMaxBytes: number;
}

/**
 * Trusted provider configuration selected for one host launch.
 */
export type FieldnotesAuthentication =
  | {
      /**
       * Selects direct Google OIDC authorization.
       */
      readonly mode: "google";

      /**
       * Google web application OAuth client identifier.
       */
      readonly clientId: string;

      /**
       * Google web application OAuth client secret.
       */
      readonly clientSecret: string;
    }
  | {
      /**
       * Selects Google sign-in through Firebase Authentication.
       */
      readonly mode: "firebase";

      /**
       * Exact Firebase project accepted by Admin verification.
       */
      readonly projectId: string;

      /**
       * Explicit maximum age of a Firebase Google login.
       */
      readonly recentLoginMilliseconds: number;
    };

/**
 * Parses the provider selected for a durable Fieldnotes launch.
 */
export class FieldnotesAuthenticationSettings {
  /**
   * Validates exact provider settings and excludes emulator credentials in production.
   *
   * @param environment Deployment environment values.
   * @param production Whether this launch uses production identity verification.
   * @returns One explicit provider configuration.
   */
  parse(
    environment: Readonly<Record<string, string | undefined>>,
    production: boolean,
  ): FieldnotesAuthentication {
    if (production && environment.FIREBASE_AUTH_EMULATOR_HOST !== undefined)
      throw new Error("FIREBASE_AUTH_EMULATOR_HOST is forbidden in production.");
    const mode = this.required(environment, "FIELDNOTES_AUTH_MODE");
    if (mode === "google")
      return {
        mode,
        clientId: this.required(environment, "FIELDNOTES_GOOGLE_CLIENT_ID"),
        clientSecret: this.required(environment, "FIELDNOTES_GOOGLE_CLIENT_SECRET"),
      };
    if (mode === "firebase") {
      const recent = Number(this.required(environment, "FIELDNOTES_FIREBASE_RECENT_LOGIN_MS"));
      if (!Number.isSafeInteger(recent) || recent <= 0)
        throw new Error("FIELDNOTES_FIREBASE_RECENT_LOGIN_MS must be a positive safe integer.");
      return {
        mode,
        projectId: this.required(environment, "FIELDNOTES_FIREBASE_PROJECT_ID"),
        recentLoginMilliseconds: recent,
      };
    }
    throw new Error("FIELDNOTES_AUTH_MODE must be google or firebase.");
  }

  /**
   * Returns an exact nonempty deployment setting.
   *
   * @param environment Deployment environment values.
   * @param name Required variable name.
   * @returns Nonempty setting.
   */
  private required(
    environment: Readonly<Record<string, string | undefined>>,
    name: string,
  ): string {
    const value = environment[name];
    if (value === undefined || value.length === 0)
      throw new Error(`Missing required configuration: ${name}.`);
    return value;
  }
}

/**
 * Parses deployment settings without adding Fieldnotes-specific fallback budgets.
 */
export class FieldnotesHostSettings {
  /**
   * Parses the required concrete listener port used by the Next-facing proxy.
   *
   * @param environment Deployment environment values.
   * @returns Port from 1 through 65535.
   */
  gatewayPort(environment: Readonly<Record<string, string | undefined>>): number {
    const port = this.positive(environment, "FIELDNOTES_GATEWAY_PORT");
    if (port > 65_535) throw new Error("FIELDNOTES_GATEWAY_PORT must be at most 65535.");
    return port;
  }

  /**
   * Parses all required durable placement, origin, secret, and policy inputs.
   *
   * @param environment Deployment environment values.
   * @returns Parsed settings for host assembly.
   */
  parse(environment: Readonly<Record<string, string | undefined>>): FieldnotesSettings {
    const postgresUrl = this.required(environment, "FIELDNOTES_POSTGRES_URL");
    const publicOrigin = this.required(environment, "FIELDNOTES_PUBLIC_ORIGIN");
    const database = new URL(postgresUrl);
    const origin = new URL(publicOrigin);
    if (!["postgres:", "postgresql:"].includes(database.protocol))
      throw new Error("Fieldnotes requires a PostgreSQL URL.");
    if (origin.protocol !== "https:" || origin.origin !== publicOrigin)
      throw new Error("Fieldnotes requires a canonical HTTPS public origin.");
    return {
      postgresUrl,
      publicOrigin,
      sessionPassword: this.required(environment, "FIELDNOTES_SESSION_PASSWORD"),
      csrfSecret: this.secret(environment, "FIELDNOTES_CSRF_SECRET_BASE64"),
      readerProofSecret: this.secret(environment, "FIELDNOTES_READER_PROOF_SECRET_BASE64"),
      sessionTtlMilliseconds: this.positive(environment, "FIELDNOTES_SESSION_TTL_MS"),
      authRouteTimeoutMs: this.positive(environment, "FIELDNOTES_AUTH_ROUTE_TIMEOUT_MS"),
      authRouteMaxBytes: this.positive(environment, "FIELDNOTES_AUTH_ROUTE_MAX_BYTES"),
    };
  }

  /**
   * Returns one nonempty configuration value.
   *
   * @param environment Deployment settings.
   * @param name Exact variable name.
   * @returns The required nonempty value.
   */
  private required(
    environment: Readonly<Record<string, string | undefined>>,
    name: string,
  ): string {
    const value = environment[name];
    if (value === undefined || value.length === 0)
      throw new Error(`Missing required configuration: ${name}.`);
    return value;
  }

  /**
   * Parses a positive safe integer required by a deployment policy.
   *
   * @param environment Deployment settings.
   * @param name Exact variable name.
   * @returns The declared positive policy value.
   */
  private positive(
    environment: Readonly<Record<string, string | undefined>>,
    name: string,
  ): number {
    const value = Number(this.required(environment, name));
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error(`${name} must be a positive safe integer.`);
    return value;
  }

  /**
   * Parses a canonical Base64 key with at least 256 bits.
   *
   * @param environment Deployment settings.
   * @param name Exact variable name.
   * @returns A detached key buffer.
   */
  private secret(
    environment: Readonly<Record<string, string | undefined>>,
    name: string,
  ): Uint8Array {
    const value = this.required(environment, name);
    const decoded = Buffer.from(value, "base64");
    if (decoded.length < 32 || decoded.toString("base64") !== value)
      throw new Error(`${name} must be canonical Base64 with at least 32 bytes.`);
    return new Uint8Array(decoded);
  }
}
