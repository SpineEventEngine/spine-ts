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

import { expect, test } from "vitest";

import { openLoopback } from "../src/trusted/loopback.js";

test("loopback listener accepts one callback at the exact local path and closes", async () => {
  const listener = await openLoopback();
  const rejected = await fetch(listener.redirectUri.replace("/auth/callback", "/wrong"));
  expect(rejected.status).toBe(404);
  const response = await fetch(`${listener.redirectUri}?code=example&state=secret`);
  expect(response.status).toBe(200);
  expect(await response.text()).not.toContain("secret");
  const callback = await listener.wait();
  expect(callback.searchParams.get("code")).toBe("example");
  await expect(fetch(listener.redirectUri)).rejects.toThrow();
});

test("closing a pending loopback attempt releases its port and rejects the wait", async () => {
  const listener = await openLoopback();
  const result = listener.wait();
  await listener.close();
  await expect(result).rejects.toThrow();
  await expect(fetch(listener.redirectUri)).rejects.toThrow();
});
