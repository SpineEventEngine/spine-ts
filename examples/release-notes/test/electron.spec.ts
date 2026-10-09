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

import { resolve } from "node:path";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect, test } from "@playwright/test";

const directory = resolve(fileURLToPath(new URL("..", import.meta.url)));
const electronPath = createRequire(import.meta.url)("electron") as string;

test("desktop shell opens one isolated window with account controls", async () => {
  const app = await electron.launch({ executablePath: electronPath, args: [directory] });
  try {
    const window = await app.firstWindow();
    await expect(window.getByRole("button", { name: "Continue with ChatGPT" })).toBeVisible();
    expect(await window.evaluate(() => typeof process)).toBe("undefined");
    expect(await window.evaluate(() => typeof window.localStorage.getItem("access_token"))).toBe(
      "object",
    );
  } finally {
    await app.close();
  }
});

test("packaged macOS app opens the same isolated account shell", async () => {
  const executablePath = (await readFile(resolve(directory, "out/app-path.txt"), "utf8")).trim();
  const app = await electron.launch({ executablePath });
  try {
    const window = await app.firstWindow();
    await expect(window.getByRole("button", { name: "Continue with ChatGPT" })).toBeVisible();
    expect(await window.evaluate(() => typeof process)).toBe("undefined");
  } finally {
    await app.close();
  }
});
