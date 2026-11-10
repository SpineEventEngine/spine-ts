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

import { expect, test } from "@playwright/test";

/**
 * Reads the fixture's observed upstream stream-cancellation count.
 *
 * @param value Untrusted JSON fixture response.
 * @returns Recorded interrupted stream count.
 */
function interruptionCount(value: unknown): number {
  if (
    typeof value !== "object" ||
    value === null ||
    !("interruptedStreams" in value) ||
    typeof value.interruptedStreams !== "number"
  )
    throw new Error("Fixture interruption count is unavailable.");
  return value.interruptedStreams;
}

test.afterEach(async () => {
  const response = await fetch("http://127.0.0.1:45110/test/shutdown", { method: "POST" });
  expect(response.status).toBe(204);
});

test("direct Google fixture signs into the private workspace through Next and native host", async ({
  page,
}, testInfo) => {
  const workerErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("Worker failed to load"))
      workerErrors.push(message.text());
  });
  const workerResponse = page.waitForResponse((response) =>
    /^\/_next\/static\/media\/maplibre-gl-worker\.[^/]+\.mjs$/.test(
      new URL(response.url()).pathname,
    ),
  );
  await page.route("https://accounts.google.com/o/oauth2/v2/auth**", async (route) => {
    const provider = new URL(route.request().url());
    const registration = new URL("http://127.0.0.1:45110/test/authorize");
    for (const key of ["state", "nonce", "code_challenge"])
      registration.searchParams.set(key, provider.searchParams.get(key) ?? "");
    const response = await fetch(registration);
    if (!response.ok) throw new Error("Local signed OIDC fixture refused authorization.");
    const result: unknown = await response.json();
    if (
      typeof result !== "object" ||
      result === null ||
      !("callback" in result) ||
      typeof result.callback !== "string"
    )
      throw new Error("OIDC fixture callback missing.");
    await route.fulfill({ status: 302, headers: { location: result.callback }, body: "" });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("signed-out.png"), fullPage: true });
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByRole("heading", { name: "Saved places" })).toBeVisible();
  await expect(page.getByText("No places yet.", { exact: false })).toBeVisible();
  const navigationProtocol = await page.evaluate(
    () =>
      (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming)
        .nextHopProtocol,
  );
  expect(navigationProtocol).toBe("h2");
  const network = await page.context().newCDPSession(page);
  await network.send("Network.enable");
  const commandProtocols: string[] = [];
  network.on("Network.responseReceived", (event: unknown) => {
    if (typeof event !== "object" || event === null || !("response" in event)) return;
    const response = event.response;
    if (
      typeof response !== "object" ||
      response === null ||
      !("url" in response) ||
      typeof response.url !== "string" ||
      !("protocol" in response) ||
      typeof response.protocol !== "string"
    )
      return;
    if (new URL(response.url).pathname.includes("CommandService/Post"))
      commandProtocols.push(response.protocol);
  });
  expect((await workerResponse).status()).toBe(200);
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await expect(page.locator(".map-canvas")).toHaveAttribute("data-map-loaded", "true");
  await expect(page.locator(".map-fallback")).toHaveCount(0);
  expect(workerErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("desktop-workspace.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Places" })).toBeVisible();
  await page.getByRole("button", { name: "Places" }).click();
  await expect(page.getByRole("dialog", { name: "Saved places" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mobile-places.png"), fullPage: true });
  await page.getByRole("button", { name: "Close panel" }).click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("button", { name: "Add a place" }).first().click();
  await page.getByLabel("Place name").fill("Riverside");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Riverside" })).toBeVisible();
  expect(commandProtocols).toContain("h2");
  await expect(
    page.locator(".desktop-place-panel .place-row", { hasText: "Riverside" }),
  ).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Select Riverside" })).toHaveCount(1);
  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("Place name").fill("Riverside walk");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Riverside walk" })).toBeVisible();
  await page.getByRole("button", { name: "Move pin" }).click();
  await page.getByRole("spinbutton", { name: "Latitude" }).fill("38.73");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("38.73000, -9.14000")).toBeVisible();
  const externalImages: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).hostname === "attacker.example") externalImages.push(request.url());
  });
  await page.getByRole("button", { name: "Edit note" }).click();
  await page
    .getByRole("textbox", { name: "Markdown editor" })
    .fill("A **private note** ![hidden](https://attacker.example/pixel)");
  await expect(page.getByText("Image omitted: hidden")).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.locator(".desktop-place-panel .safe-markdown strong", { hasText: "private note" }),
  ).toBeVisible();
  expect(externalImages).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("populated-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Details" }).click();
  const details = page.getByRole("dialog", { name: "Place details" });
  await expect(details.getByRole("heading", { name: "Riverside walk" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mobile-details.png"), fullPage: true });
  await details.getByRole("button", { name: "Edit note" }).click();
  const mobileEditor = page.getByRole("dialog", { name: "Edit place" });
  await expect(mobileEditor.getByRole("textbox", { name: "Markdown editor" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mobile-editor.png"), fullPage: true });
  await mobileEditor.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Close panel" }).click();
  await page.setViewportSize({ width: 1280, height: 800 });
  const second = await page.context().newPage();
  await second.goto("/");
  await second.locator(".desktop-place-panel .place-row", { hasText: "Riverside walk" }).click();
  await expect(second.getByRole("heading", { name: "Riverside walk" })).toBeVisible();
  await page.getByRole("button", { name: "Edit note" }).click();
  await page.getByRole("textbox", { name: "Markdown editor" }).fill("My unsaved revision");
  await second.getByRole("button", { name: "Rename" }).click();
  await second.getByLabel("Place name").fill("Riverside after another tab");
  await second.getByRole("button", { name: "Save", exact: true }).click();
  await expect(second.getByRole("heading", { name: "Riverside after another tab" })).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator('.edit-panel [role="status"]')).toContainText(
    "Place changed since last edit",
  );
  await expect(page.getByRole("textbox", { name: "Markdown editor" })).toHaveValue(
    "My unsaved revision",
  );
  await page.screenshot({ path: testInfo.outputPath("conflict-draft.png"), fullPage: true });
  await page.getByRole("button", { name: "Reapply draft to current version" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.locator(".desktop-place-panel .safe-markdown", { hasText: "My unsaved revision" }),
  ).toBeVisible();
  const beforeClose: unknown = await (
    await fetch("http://127.0.0.1:45110/test/cancellation")
  ).json();
  await second.close();
  await expect
    .poll(async () => {
      const response = await fetch("http://127.0.0.1:45110/test/cancellation");
      const observed: unknown = await response.json();
      return interruptionCount(observed);
    })
    .toBeGreaterThan(interruptionCount(beforeClose));
  await page.getByRole("button", { name: "Delete place" }).click();
  await expect(page.getByText("cannot be undone", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Delete place" }).last().click();
  await expect(page.locator(".desktop-place-panel .place-row")).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Saved places" })).toHaveCount(0);
  await network.detach();
});
