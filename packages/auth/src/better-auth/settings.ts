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

import type { BetterAuthRoutePolicy, SupportedBetterAuthOptions } from "./integration.js";
import type { genericOAuth, GenericOAuthOptions } from "./generic-oauth.js";

/**
 * Captures the bounded native profile synchronously before engine initialization.
 */
// Static checks keep the selected native configuration validation together.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class BetterAuthSettings {
  /**
   * Validates and copies the required host body and deadline policy.
   *
   * @param input Application route policy, including JavaScript callers.
   * @returns Immutable valid bounds.
   */
  static routePolicy(input: unknown): BetterAuthRoutePolicy {
    const value = this.record(input, "routePolicy", ["maxRequestBytes", "timeoutMs"]);
    if (
      !Number.isSafeInteger(value.maxRequestBytes) ||
      (value.maxRequestBytes as number) < 1 ||
      (value.maxRequestBytes as number) > 4_194_304
    )
      throw new RangeError("Invalid routePolicy.maxRequestBytes.");
    if (
      !Number.isSafeInteger(value.timeoutMs) ||
      (value.timeoutMs as number) < 1 ||
      (value.timeoutMs as number) > 2_147_483_647
    )
      throw new RangeError("Invalid routePolicy.timeoutMs.");
    return Object.freeze({
      maxRequestBytes: value.maxRequestBytes as number,
      timeoutMs: value.timeoutMs as number,
    });
  }

  /**
   * Validates every admitted native option and detaches mutable caller values.
   *
   * @param input Native options, including JavaScript values.
   * @returns Detached options with required safe native settings.
   */
  static options(input: unknown): SupportedBetterAuthOptions {
    const value = this.record(input, "Better Auth options", [
      "baseURL",
      "basePath",
      "secret",
      "secrets",
      "trustedOrigins",
      "session",
      "emailAndPassword",
      "account",
      "verification",
      "advanced",
      "rateLimit",
      "plugins",
    ]);
    this.urlsAndSecrets(value);
    this.session(value.session);
    this.password(value.emailAndPassword);
    this.account(value.account);
    this.verification(value.verification);
    this.advanced(value.advanced);
    this.rate(value.rateLimit);
    const plugins = this.plugins(value.plugins);
    const withoutPlugins = { ...value };
    delete withoutPlugins.plugins;
    const captured = this.copy(withoutPlugins) as SupportedBetterAuthOptions;
    return {
      ...captured,
      ...(plugins === undefined ? {} : { plugins }),
      session: { ...captured.session, cookieCache: { enabled: false } },
      verification: { disableCleanup: true },
      advanced: { ...captured.advanced, database: { validateSchema: false } },
    };
  }

  /**
   * Copies only supported native provider configuration, ignoring caller code.
   *
   * @param input Caller plugins or absence.
   * @returns Structural plugin views with detached provider configuration.
   */
  static plugins(input: unknown): SupportedBetterAuthOptions["plugins"] {
    if (input === undefined) return undefined;
    if (!Array.isArray(input)) throw new TypeError("Unsupported Better Auth plugins.");
    return input.map((entry) => this.plugin(entry));
  }

  /**
   * Captures one admitted native plugin without executing caller callbacks.
   *
   * @param entry Candidate native plugin object.
   * @returns Detached selected plugin configuration.
   */
  static plugin(entry: unknown): ReturnType<typeof genericOAuth> {
    const plugin = this.record(entry, "Better Auth plugin", [
      "id",
      "version",
      "init",
      "hooks",
      "options",
      "$ERROR_CODES",
    ]);
    if (plugin.id !== "generic-oauth") throw new TypeError("Unsupported Better Auth plugin.");
    const options = this.record(plugin.options, "generic OAuth options", ["config"]);
    if (!Array.isArray(options.config) || options.config.length === 0)
      throw new TypeError("Generic OAuth providers are required.");
    const ids = new Set<string>();
    for (const item of options.config) this.providerConfig(item, ids);
    return { id: "generic-oauth", options: this.copy(options) as GenericOAuthOptions };
  }

  /**
   * Validates one bounded discovery provider before detaching its options.
   *
   * @param item Candidate provider configuration.
   * @param ids Identifiers already admitted in this plugin.
   */
  static providerConfig(item: unknown, ids: Set<string>): void {
    const provider = this.record(item, "generic OAuth provider", [
      "providerId",
      "discoveryUrl",
      "clientId",
      "clientSecret",
      "tokenEndpointAuth",
      "authentication",
      "scopes",
      "redirectURI",
      "pkce",
      "requireIdTokenVerification",
      "disableSignUp",
      "overrideUserInfo",
      "requireEmailVerification",
    ]);
    this.provider(provider, ids);
  }

  /**
   * Checks one discovery-based OIDC provider without invoking caller callbacks.
   *
   * @param value Provider configuration.
   * @param ids Provider identifiers already admitted in this plugin.
   */
  static provider(value: Record<string, unknown>, ids: Set<string>): void {
    if (
      typeof value.providerId !== "string" ||
      value.providerId.length === 0 ||
      ids.has(value.providerId)
    )
      throw new TypeError("Invalid generic OAuth providerId.");
    ids.add(value.providerId);
    this.url(value.discoveryUrl, "discoveryUrl", false);
    if (typeof value.clientId !== "string" || value.clientId.length === 0)
      throw new TypeError("Invalid generic OAuth clientId.");
    if (
      value.clientSecret !== undefined &&
      (typeof value.clientSecret !== "string" || value.clientSecret.length === 0)
    )
      throw new TypeError("Invalid generic OAuth clientSecret.");
    if (value.redirectURI !== undefined) this.url(value.redirectURI, "redirectURI", false);
    if (
      value.scopes !== undefined &&
      (!Array.isArray(value.scopes) ||
        value.scopes.some((scope) => typeof scope !== "string" || scope.length === 0))
    )
      throw new TypeError("Invalid generic OAuth scopes.");
    this.providerSecurity(value);
    this.providerAuth(value);
  }

  /**
   * Checks native OIDC verification and forbids native user mutation.
   *
   * @param value Discovery-based provider configuration.
   */
  static providerSecurity(value: Record<string, unknown>): void {
    if (
      value.pkce !== true ||
      value.requireIdTokenVerification !== true ||
      value.disableSignUp !== true ||
      value.overrideUserInfo !== false
    )
      throw new TypeError("Generic OAuth security flags are required.");
    if (
      value.requireEmailVerification !== undefined &&
      typeof value.requireEmailVerification !== "boolean"
    )
      throw new TypeError("Invalid generic OAuth email policy.");
  }

  /**
   * Checks supported token endpoint authentication combinations.
   *
   * @param value Discovery-based provider configuration.
   */
  static providerAuth(value: Record<string, unknown>): void {
    const method =
      value.tokenEndpointAuth === undefined
        ? undefined
        : this.record(value.tokenEndpointAuth, "tokenEndpointAuth", ["method"]).method;
    if (
      method !== undefined &&
      !["none", "client_secret_basic", "client_secret_post"].includes(method as string)
    )
      throw new TypeError("Unsupported generic OAuth client authentication.");
    if (
      value.authentication !== undefined &&
      !["basic", "post"].includes(value.authentication as string)
    )
      throw new TypeError("Unsupported generic OAuth legacy authentication.");
    if (method !== undefined && value.authentication !== undefined)
      throw new TypeError("Conflicting generic OAuth client authentication.");
    if (
      (method === "client_secret_basic" ||
        method === "client_secret_post" ||
        value.authentication !== undefined) &&
      value.clientSecret === undefined
    )
      throw new TypeError("Generic OAuth client secret is required.");
  }

  /**
   * Validates public service URL, native route prefix, origins and active secrets.
   *
   * @param value Top-level native option values.
   */
  static urlsAndSecrets(value: Record<string, unknown>): void {
    this.url(value.baseURL, "baseURL", false);
    if (
      value.basePath !== undefined &&
      (typeof value.basePath !== "string" ||
        !/^\/[a-zA-Z0-9/_-]+$/u.test(value.basePath) ||
        value.basePath.endsWith("/"))
    )
      throw new TypeError("Invalid Better Auth basePath.");
    if (!Array.isArray(value.trustedOrigins) || value.trustedOrigins.length === 0)
      throw new TypeError("trustedOrigins is required.");
    for (const origin of value.trustedOrigins) this.url(origin, "trustedOrigins", true);
    if (value.secret !== undefined) this.secret(value.secret);
    if (value.secrets !== undefined) {
      if (!Array.isArray(value.secrets) || value.secrets.length === 0)
        throw new TypeError("Invalid Better Auth secrets.");
      const versions = new Set<number>();
      for (const entry of value.secrets) {
        const item = this.record(entry, "Better Auth secret", ["version", "value"]);
        if (
          !Number.isSafeInteger(item.version) ||
          (item.version as number) < 0 ||
          versions.has(item.version as number)
        )
          throw new TypeError("Invalid Better Auth secret version.");
        versions.add(item.version as number);
        this.secret(item.value);
      }
    }
    if (value.secret === undefined && value.secrets === undefined)
      throw new TypeError("Better Auth secret is required.");
  }

  /**
   * Validates a canonical HTTP service URL or exact origin.
   *
   * @param input URL string.
   * @param label Configuration field.
   * @param originOnly Whether the input must equal its origin.
   */
  static url(input: unknown, label: string, originOnly: boolean): void {
    if (typeof input !== "string") throw new TypeError(`Invalid Better Auth ${label}.`);
    let parsed: URL;
    try {
      parsed = new URL(input);
    } catch {
      throw new TypeError(`Invalid Better Auth ${label}.`);
    }
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (originOnly && parsed.origin !== input)
    )
      throw new TypeError(`Invalid Better Auth ${label}.`);
  }

  /**
   * Rejects empty or short native signing secrets.
   *
   * @param input Candidate secret value.
   */
  static secret(input: unknown): void {
    if (typeof input !== "string" || input.length < 32)
      throw new TypeError("Better Auth secret must contain at least 32 characters.");
  }

  /**
   * Checks the selected session lifetime and disabled cookie cache.
   *
   * @param input Native session options or absence.
   */
  static session(input: unknown): void {
    if (input === undefined) return;
    const value = this.record(input, "session", [
      "expiresIn",
      "updateAge",
      "disableSessionRefresh",
      "freshAge",
      "cookieCache",
    ]);
    for (const field of ["expiresIn", "updateAge", "freshAge"])
      if (
        value[field] !== undefined &&
        (!Number.isSafeInteger(value[field]) || (value[field] as number) < 0)
      )
        throw new TypeError(`Invalid session.${field}.`);
    if (
      value.disableSessionRefresh !== undefined &&
      typeof value.disableSessionRefresh !== "boolean"
    )
      throw new TypeError("Invalid session.disableSessionRefresh.");
    if (value.cookieCache !== undefined) {
      const cache = this.record(value.cookieCache, "session.cookieCache", ["enabled"]);
      if (cache.enabled !== false) throw new TypeError("Native cookie caching must be disabled.");
    }
  }

  /**
   * Checks provisioned password login and callable native hash functions.
   *
   * @param input Password options or absence.
   */
  static password(input: unknown): void {
    if (input === undefined) return;
    const value = this.record(input, "emailAndPassword", [
      "enabled",
      "disableSignUp",
      "minPasswordLength",
      "maxPasswordLength",
      "password",
    ]);
    if (value.enabled !== true || value.disableSignUp !== true)
      throw new TypeError("Selected password login requires enabled and disableSignUp.");
    for (const field of ["minPasswordLength", "maxPasswordLength"])
      if (
        value[field] !== undefined &&
        (!Number.isSafeInteger(value[field]) || (value[field] as number) < 1)
      )
        throw new TypeError(`Invalid emailAndPassword.${field}.`);
    if (value.password !== undefined) {
      const password = this.record(value.password, "password", ["hash", "verify"]);
      for (const field of ["hash", "verify"])
        if (password[field] !== undefined && typeof password[field] !== "function")
          throw new TypeError(`Invalid password.${field}.`);
    }
  }

  /**
   * Rejects automatic Account changes and linking.
   *
   * @param input Native Account options or absence.
   */
  static account(input: unknown): void {
    if (input === undefined) return;
    const value = this.record(input, "account", ["updateAccountOnSignIn", "accountLinking"]);
    if (value.updateAccountOnSignIn !== undefined && value.updateAccountOnSignIn !== false)
      throw new TypeError("Account updates are unsupported.");
    if (value.accountLinking !== undefined) {
      const linking = this.record(value.accountLinking, "accountLinking", ["enabled"]);
      if (linking.enabled !== false) throw new TypeError("Account linking must be disabled.");
    }
  }

  /**
   * Checks that verification cleanup remains application invoked.
   *
   * @param input Native Verification options or absence.
   */
  static verification(input: unknown): void {
    if (input === undefined) return;
    if (this.record(input, "verification", ["disableCleanup"]).disableCleanup !== true)
      throw new TypeError("Automatic verification cleanup is unsupported.");
  }

  /**
   * Validates native cookie names, attributes and disabled schema validation.
   *
   * @param input Native advanced options or absence.
   */
  static advanced(input: unknown): void {
    if (input === undefined) return;
    const value = this.record(input, "advanced", [
      "cookiePrefix",
      "cookies",
      "defaultCookieAttributes",
      "useSecureCookies",
      "database",
    ]);
    if (
      value.cookiePrefix !== undefined &&
      (typeof value.cookiePrefix !== "string" || !/^[a-zA-Z0-9_.-]+$/u.test(value.cookiePrefix))
    )
      throw new TypeError("Invalid cookiePrefix.");
    if (value.useSecureCookies !== undefined && value.useSecureCookies !== true)
      throw new TypeError("Insecure native cookie override is unsupported.");
    if (
      value.database !== undefined &&
      this.record(value.database, "database", ["validateSchema"]).validateSchema !== false
    )
      throw new TypeError("Native schema validation must be disabled.");
    if (value.defaultCookieAttributes !== undefined)
      this.cookieAttributes(value.defaultCookieAttributes);
    if (value.cookies !== undefined) this.cookieRoles(value.cookies);
  }

  /**
   * Checks supported native cookie roles and their browser attributes.
   *
   * @param input Configured cookie roles.
   */
  static cookieRoles(input: unknown): void {
    const cookies = this.record(input, "cookies", [
      "session_token",
      "session_data",
      "account_data",
      "dont_remember",
      "state",
    ]);
    for (const entry of Object.values(cookies)) {
      const cookie = this.record(entry, "cookie role", ["name", "attributes"]);
      if (
        cookie.name !== undefined &&
        (typeof cookie.name !== "string" || !/^[a-zA-Z0-9_.-]+$/u.test(cookie.name))
      )
        throw new TypeError("Invalid native cookie name.");
      if (cookie.attributes !== undefined) this.cookieAttributes(cookie.attributes);
    }
  }

  /**
   * Rejects unsafe or unsupported native cookie attribute values.
   *
   * @param input Cookie attributes.
   */
  static cookieAttributes(input: unknown): void {
    const value = this.record(input, "cookie attributes", [
      "domain",
      "expires",
      "httpOnly",
      "maxAge",
      "path",
      "secure",
      "sameSite",
      "partitioned",
      "prefix",
    ]);
    if (
      value.httpOnly === false ||
      value.secure === false ||
      (value.path !== undefined && value.path !== "/")
    )
      throw new TypeError("Unsafe native cookie attributes.");
    if (
      value.domain !== undefined &&
      (typeof value.domain !== "string" || value.domain.length === 0)
    )
      throw new TypeError("Invalid native cookie domain.");
    this.cookieExpiry(value);
    this.cookiePolicy(value);
  }

  /**
   * Checks optional native cookie expiry and maximum age.
   *
   * @param value Cookie attributes after shape validation.
   */
  static cookieExpiry(value: Record<string, unknown>): void {
    if (
      value.expires !== undefined &&
      (!(value.expires instanceof Date) || !Number.isFinite(value.expires.getTime()))
    )
      throw new TypeError("Invalid native cookie expiry.");
    if (
      value.maxAge !== undefined &&
      (!Number.isSafeInteger(value.maxAge) || (value.maxAge as number) < 0)
    )
      throw new TypeError("Invalid native cookie maxAge.");
  }

  /**
   * Checks optional SameSite, partitioning and prefix values.
   *
   * @param value Cookie attributes after shape validation.
   */
  static cookiePolicy(value: Record<string, unknown>): void {
    if (
      value.sameSite !== undefined &&
      !["Strict", "Lax", "None", "strict", "lax", "none"].includes(value.sameSite as string)
    )
      throw new TypeError("Invalid native SameSite policy.");
    if (value.partitioned !== undefined && typeof value.partitioned !== "boolean")
      throw new TypeError("Invalid native partitioned attribute.");
    if (value.prefix !== undefined && !["host", "secure"].includes(value.prefix as string))
      throw new TypeError("Invalid native cookie prefix.");
  }

  /**
   * Checks the selected process-local native rate policy without calling callbacks.
   *
   * @param input Rate options or absence.
   */
  static rate(input: unknown): void {
    if (input === undefined) return;
    const value = this.record(input, "rateLimit", [
      "enabled",
      "window",
      "max",
      "customRules",
      "storage",
    ]);
    if (value.enabled !== undefined && typeof value.enabled !== "boolean")
      throw new TypeError("Invalid rateLimit.enabled.");
    if (value.storage !== undefined && value.storage !== "memory")
      throw new TypeError("Unsupported rateLimit.storage.");
    for (const field of ["window", "max"])
      if (
        value[field] !== undefined &&
        (!Number.isSafeInteger(value[field]) || (value[field] as number) < 1)
      )
        throw new TypeError(`Invalid rateLimit.${field}.`);
    if (value.customRules !== undefined) {
      const rules = this.record(value.customRules, "customRules");
      for (const rule of Object.values(rules)) {
        if (rule === false || typeof rule === "function") continue;
        const entry = this.record(rule, "rate rule", ["window", "max"]);
        if (
          !Number.isSafeInteger(entry.window) ||
          (entry.window as number) < 1 ||
          !Number.isSafeInteger(entry.max) ||
          (entry.max as number) < 1
        )
          throw new TypeError("Invalid native rate rule.");
      }
    }
  }

  /**
   * Rejects unknown fields and non-record JavaScript values.
   *
   * @param input Candidate option group.
   * @param label Group named in errors.
   * @param allowed Explicit field allowlist; omitted for dynamic path maps.
   * @returns Checked record.
   */
  static record(
    input: unknown,
    label: string,
    allowed?: readonly string[],
  ): Record<string, unknown> {
    if (typeof input !== "object" || input === null || Array.isArray(input))
      throw new TypeError(`Invalid ${label}.`);
    const value = input as Record<string, unknown>;
    if (allowed !== undefined && Object.keys(value).some((key) => !allowed.includes(key)))
      throw new TypeError(`Unsupported ${label} field.`);
    return value;
  }

  /**
   * Copies nested native input while retaining explicit callback identities.
   *
   * @param input Validated option value.
   * @returns Detached value with dates copied.
   */
  static copy(input: unknown): unknown {
    if (input instanceof Date) return new Date(input);
    if (Array.isArray(input)) return input.map((value) => this.copy(value));
    if (typeof input !== "object" || input === null) return input;
    return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, this.copy(value)]));
  }
}
