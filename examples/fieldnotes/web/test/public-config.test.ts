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

import { expect, it } from "vitest";
import { FieldnotesPublicConfig } from "../src/public-config";

it("selects direct Google without publishing the server client secret", () => {
  expect(
    FieldnotesPublicConfig.parse(
      {
        FIELDNOTES_AUTH_MODE: "google",
        FIELDNOTES_GOOGLE_CLIENT_SECRET: "private",
      },
      true,
    ),
  ).toEqual({ mode: "google" });
});

it("requires explicit Firebase browser values and rejects emulator in production", () => {
  const values = {
    FIELDNOTES_AUTH_MODE: "firebase",
    FIELDNOTES_FIREBASE_API_KEY: "browser-key",
    FIELDNOTES_FIREBASE_AUTH_DOMAIN: "demo-fieldnotes.firebaseapp.com",
    FIELDNOTES_FIREBASE_PROJECT_ID: "demo-fieldnotes",
    FIELDNOTES_FIREBASE_EMULATOR_URL: "http://127.0.0.1:9099",
  };
  expect(FieldnotesPublicConfig.parse(values, false)).toEqual({
    mode: "firebase",
    firebase: {
      apiKey: "browser-key",
      authDomain: "demo-fieldnotes.firebaseapp.com",
      projectId: "demo-fieldnotes",
      emulatorUrl: "http://127.0.0.1:9099",
    },
  });
  expect(() => FieldnotesPublicConfig.parse(values, true)).toThrow();
  expect(() =>
    FieldnotesPublicConfig.parse({ ...values, FIELDNOTES_FIREBASE_API_KEY: "" }, false),
  ).toThrow();
  expect(() => FieldnotesPublicConfig.parse({ FIELDNOTES_AUTH_MODE: "other" }, false)).toThrow();
});
