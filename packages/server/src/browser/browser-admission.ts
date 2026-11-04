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

import type * as http from "node:http";

import type { BrowserAuthRoute, BrowserCredentialAdmission } from "./options.js";

/**
 * Immutable startup admission names and raw request inspection for one browser host.
 */
export class BrowserAdmissionPolicy {
  /**
   * Captured duplicate-sensitive names for the active RPC credential reader.
   */
  readonly reader: BrowserCredentialAdmission;

  /**
   * Captured duplicate-sensitive names indexed by exact authentication route path.
   */
  readonly routes: ReadonlyMap<string, BrowserCredentialAdmission>;

  readonly #csrfHeaders: ReadonlySet<string>;

  readonly #selectedCookies: ReadonlySet<string>;

  /**
   * Stores the validated reader and route names for one listener.
   * @param reader Active RPC credential reader declaration.
   * @param routes Authentication route declarations indexed by exact path.
   */
  private constructor(
    reader: BrowserCredentialAdmission,
    routes: ReadonlyMap<string, BrowserCredentialAdmission>,
  ) {
    this.reader = reader;
    this.routes = routes;
    const all = [reader, ...routes.values()];
    this.#csrfHeaders = new Set(all.flatMap((value) => value.csrfHeaderNames));
    this.#selectedCookies = new Set(
      all.flatMap((value) => [...value.credentialCookieNames, ...value.stateCookieNames]),
    );
  }

  /**
   * Validates and copies every declaration before the first asynchronous startup step.
   * @param reader Active RPC credential reader declaration.
   * @param routes Validated route configurations indexed by pathname.
   * @returns One immutable admission policy for startup and requests.
   */
  static create(
    reader: unknown,
    routes: ReadonlyMap<string, BrowserAuthRoute>,
  ): BrowserAdmissionPolicy {
    const copied = new Map<string, BrowserCredentialAdmission>();
    for (const [path, route] of routes) copied.set(path, AdmissionNames.copy(route.admission));
    return new BrowserAdmissionPolicy(AdmissionNames.copy(reader), copied);
  }

  /**
   * Rejects ambiguous raw headers and returns an immutable duplicate-preserving view.
   * @param request Incoming Node request before WHATWG normalization.
   * @param active Reader or selected route declaration for primary conflict checks.
   * @returns Raw header view or a terminal admission rejection.
   */
  inspect(
    request: http.IncomingMessage,
    active: BrowserCredentialAdmission,
  ):
    | { readonly kind: "admitted"; readonly headers: RawBrowserHeaders }
    | { readonly kind: "rejected"; readonly reason: string } {
    const headers = AdmissionNames.raw(request.rawHeaders);
    for (const name of ["authorization", "origin", ...this.#csrfHeaders])
      if ((headers[name]?.length ?? 0) > 1) return { kind: "rejected", reason: `repeated ${name}` };
    const cookies = AdmissionNames.cookies(headers.cookie ?? [], this.#selectedCookies);
    if ("reason" in cookies) return { kind: "rejected", reason: cookies.reason };
    const primary = active.credentialCookieNames.filter((name) => cookies.present.has(name));
    if (primary.length > 1 || (primary.length > 0 && (headers.authorization?.length ?? 0) > 0))
      return { kind: "rejected", reason: "simultaneous credentials" };
    return { kind: "admitted", headers: AdmissionNames.freeze(headers) };
  }
}

/**
 * Duplicate-preserving lowercase raw HTTP header values.
 */
export type RawBrowserHeaders = Readonly<Record<string, string | readonly string[] | undefined>>;

/**
 * Internal name validation and raw field selection.
 */
const AdmissionNames = Object.freeze({
  /**
   * Copies a complete metadata declaration and validates all three required arrays.
   * @param supplied JavaScript or TypeScript caller metadata.
   * @returns Frozen normalized header names and exact cookie names.
   */
  copy(supplied: unknown): BrowserCredentialAdmission {
    if (typeof supplied !== "object" || supplied === null)
      throw new Error("Browser credential admission metadata is required.");
    const value = supplied as Record<string, unknown>;
    const csrf = AdmissionNames.names(value.csrfHeaderNames, "csrfHeaderNames", true);
    const credential = AdmissionNames.names(
      value.credentialCookieNames,
      "credentialCookieNames",
      false,
    );
    const state = AdmissionNames.names(value.stateCookieNames, "stateCookieNames", false);
    if (credential.some((name) => state.includes(name)))
      throw new Error("Browser credential and state cookie names must be distinct.");
    return Object.freeze({
      csrfHeaderNames: csrf,
      credentialCookieNames: credential,
      stateCookieNames: state,
    });
  },

  /**
   * Validates a complete array without accepting sparse or repeated names.
   * @param supplied Metadata array from a caller.
   * @param label Category used in configuration errors.
   * @param header Whether case-insensitive HTTP header rules apply.
   * @returns Frozen validated names.
   */
  names(supplied: unknown, label: string, header: boolean): readonly string[] {
    if (!Array.isArray(supplied)) throw new Error(`Browser ${label} must be an array.`);
    const names: string[] = [];
    for (let index = 0; index < supplied.length; index += 1) {
      if (!(index in supplied)) throw new Error(`Browser ${label} must not be sparse.`);
      const raw: unknown = supplied[index];
      if (typeof raw !== "string" || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(raw))
        throw new Error(`Browser ${label} contains an invalid name.`);
      const name = header ? raw.toLowerCase() : raw;
      if (header && ["authorization", "origin", "cookie"].includes(name))
        throw new Error(`Browser ${label} contains a reserved header.`);
      if (names.includes(name)) throw new Error(`Browser ${label} contains a duplicate name.`);
      names.push(name);
    }
    return Object.freeze(names);
  },

  /**
   * Collects all Node raw header pairs without losing repeated field values.
   * @param pairs Alternating raw header names and values.
   * @returns Lowercase names mapped to original ordered values.
   */
  raw(pairs: readonly string[]): Record<string, string[]> {
    const result: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
    for (let index = 0; index < pairs.length; index += 2) {
      const name = pairs[index]?.toLowerCase();
      const value = pairs[index + 1];
      if (name === undefined || value === undefined) continue;
      (result[name] ??= []).push(value);
    }
    return result;
  },

  /**
   * Checks raw Cookie pairs before any first-value parser can hide ambiguity.
   * @param fields Original Cookie field values in arrival order.
   * @param selected Names declared by any mounted reader or route.
   * @returns Present selected names or a terminal syntax/duplicate rejection.
   */
  cookies(
    fields: readonly string[],
    selected: ReadonlySet<string>,
  ): { readonly present: ReadonlySet<string> } | { readonly reason: string } {
    const present = new Set<string>();
    for (const field of fields) {
      if (AdmissionNames.invalidField(field)) return { reason: "malformed Cookie field" };
      for (const pair of field.split(";")) {
        const index = pair.indexOf("=");
        if (index <= 0) return { reason: "malformed Cookie pair" };
        const name = pair.slice(0, index).trim();
        const value = pair.slice(index + 1).trim();
        if (!AdmissionNames.validPair(name, value)) return { reason: "malformed Cookie pair" };
        if (!selected.has(name)) continue;
        if (present.has(name)) return { reason: "repeated selected Cookie" };
        present.add(name);
      }
    }
    return { present };
  },

  /**
   * Checks a raw Cookie field for controls and comma-combined ambiguity.
   * @param field Original field value.
   * @returns Whether the field contains a forbidden character.
   */
  invalidField(field: string): boolean {
    for (const character of field) {
      const code = character.charCodeAt(0);
      if (code <= 31 || code === 127 || character === ",") return true;
    }
    return false;
  },

  /**
   * Checks one Cookie pair's raw token name and printable value.
   * @param name Cookie name before decoding.
   * @param value Cookie value before decoding.
   * @returns Whether the pair has valid transport syntax.
   */
  validPair(name: string, value: string): boolean {
    return /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) && /^[\x21-\x7e]*$/.test(value);
  },

  /**
   * Creates immutable header fields and ordered value arrays for the selected reader.
   * @param headers Duplicate-preserving mutable request-local collection.
   * @returns Immutable lowercase header view.
   */
  freeze(headers: Record<string, string[]>): RawBrowserHeaders {
    const result: Record<string, string | readonly string[]> = Object.create(null) as Record<
      string,
      string | readonly string[]
    >;
    for (const [name, values] of Object.entries(headers))
      result[name] = values.length === 1 ? (values[0] ?? "") : Object.freeze([...values]);
    return Object.freeze(result);
  },
});
