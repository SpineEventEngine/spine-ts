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
 * Parses deployment settings without adding Fieldnotes-specific fallback budgets.
 */
export class FieldnotesHostSettings {
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
