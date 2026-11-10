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

import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FieldnotesHostSettings } from "../src/host-settings.js";

describe("Fieldnotes host settings", () => {
  const complete = () => ({
    FIELDNOTES_POSTGRES_URL: "postgres://localhost/fieldnotes",
    FIELDNOTES_PUBLIC_ORIGIN: "https://localhost:3000",
    FIELDNOTES_SESSION_PASSWORD: randomBytes(32).toString("base64url"),
    FIELDNOTES_CSRF_SECRET_BASE64: randomBytes(32).toString("base64"),
    FIELDNOTES_READER_PROOF_SECRET_BASE64: randomBytes(32).toString("base64"),
    FIELDNOTES_SESSION_TTL_MS: "3600000",
    FIELDNOTES_AUTH_ROUTE_TIMEOUT_MS: "10000",
    FIELDNOTES_AUTH_ROUTE_MAX_BYTES: "65536",
  });

  it("requires durable placement, HTTPS, stable keys and explicit lifetime budgets", () => {
    expect(new FieldnotesHostSettings().parse(complete())).toMatchObject({
      publicOrigin: "https://localhost:3000",
      sessionTtlMilliseconds: 3_600_000,
      authRouteTimeoutMs: 10_000,
      authRouteMaxBytes: 65_536,
    });
    for (const key of Object.keys(complete())) {
      const values: Record<string, string | undefined> = complete();
      values[key] = undefined;
      expect(() => new FieldnotesHostSettings().parse(values), key).toThrow();
    }
    expect(() =>
      new FieldnotesHostSettings().parse({
        ...complete(),
        FIELDNOTES_PUBLIC_ORIGIN: "http://localhost:3000",
      }),
    ).toThrow();
    expect(() =>
      new FieldnotesHostSettings().parse({ ...complete(), FIELDNOTES_SESSION_TTL_MS: "0" }),
    ).toThrow();
    expect(() =>
      new FieldnotesHostSettings().parse({ ...complete(), FIELDNOTES_CSRF_SECRET_BASE64: "short" }),
    ).toThrow();
  });

  it("requires a concrete proxy-facing gateway port for the process launch", () => {
    const parser = new FieldnotesHostSettings();
    expect(parser.gatewayPort({ FIELDNOTES_GATEWAY_PORT: "4311" })).toBe(4311);
    for (const value of [undefined, "", "0", "65536", "not-a-port"])
      expect(() => parser.gatewayPort({ FIELDNOTES_GATEWAY_PORT: value })).toThrow(
        "FIELDNOTES_GATEWAY_PORT",
      );
  });
});
