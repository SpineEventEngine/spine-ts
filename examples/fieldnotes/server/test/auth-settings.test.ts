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

import { describe, expect, it } from "vitest";
import { FieldnotesAuthenticationSettings } from "../src/host-settings.js";

describe("Fieldnotes authentication settings", () => {
  it("requires one explicit provider mode and its trusted configuration", () => {
    const parse = (values: Record<string, string | undefined>, production = true) =>
      new FieldnotesAuthenticationSettings().parse(values, production);
    expect(() => parse({})).toThrow("FIELDNOTES_AUTH_MODE");
    expect(() => parse({ FIELDNOTES_AUTH_MODE: "unknown" })).toThrow("FIELDNOTES_AUTH_MODE");
    expect(
      parse({
        FIELDNOTES_AUTH_MODE: "google",
        FIELDNOTES_GOOGLE_CLIENT_ID: "client-id",
        FIELDNOTES_GOOGLE_CLIENT_SECRET: "client-secret",
      }),
    ).toEqual({ mode: "google", clientId: "client-id", clientSecret: "client-secret" });
    expect(() => parse({ FIELDNOTES_AUTH_MODE: "google" })).toThrow("FIELDNOTES_GOOGLE_CLIENT_ID");
    expect(
      parse({
        FIELDNOTES_AUTH_MODE: "firebase",
        FIELDNOTES_FIREBASE_PROJECT_ID: "project-id",
        FIELDNOTES_FIREBASE_RECENT_LOGIN_MS: "300000",
      }),
    ).toEqual({ mode: "firebase", projectId: "project-id", recentLoginMilliseconds: 300_000 });
    expect(() =>
      parse({ FIELDNOTES_AUTH_MODE: "firebase", FIELDNOTES_FIREBASE_PROJECT_ID: "project-id" }),
    ).toThrow("FIELDNOTES_FIREBASE_RECENT_LOGIN_MS");
    expect(() =>
      parse({
        FIELDNOTES_AUTH_MODE: "firebase",
        FIELDNOTES_FIREBASE_PROJECT_ID: "project-id",
        FIELDNOTES_FIREBASE_RECENT_LOGIN_MS: "0",
      }),
    ).toThrow("FIELDNOTES_FIREBASE_RECENT_LOGIN_MS");
  });

  it("refuses Firebase emulator configuration in production", () => {
    const values = {
      FIELDNOTES_AUTH_MODE: "firebase",
      FIELDNOTES_FIREBASE_PROJECT_ID: "demo-fieldnotes",
      FIELDNOTES_FIREBASE_RECENT_LOGIN_MS: "300000",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
    };
    expect(() => new FieldnotesAuthenticationSettings().parse(values, true)).toThrow(
      "FIREBASE_AUTH_EMULATOR_HOST",
    );
    expect(new FieldnotesAuthenticationSettings().parse(values, false)).toMatchObject({
      mode: "firebase",
      projectId: "demo-fieldnotes",
    });
  });
});
