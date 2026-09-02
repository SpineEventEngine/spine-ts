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

import { providerEnabled } from "./inbox-provider-selection.js";

describe("inbox provider test selection", () => {
  it("selects only the requested provider when both provider environments are available", () => {
    expect(providerEnabled("datastore", "datastore", true)).toBe(true);
    expect(providerEnabled("datastore", "mysql", true)).toBe(false);
    expect(providerEnabled("mysql", "datastore", true)).toBe(false);
    expect(providerEnabled("mysql", "mysql", true)).toBe(true);
  });

  it("does not select an unavailable requested provider", () => {
    expect(providerEnabled("datastore", "datastore", false)).toBe(false);
    expect(providerEnabled("mysql", "mysql", false)).toBe(false);
  });
});
