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
import { fromBinary } from "@bufbuild/protobuf";
import { TypeUrls } from "@spine-event-engine/core";
import { SubscriptionSchema } from "@spine-event-engine/proto/client";
import { MessagePostedSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/events_pb.js";
import { MessageAlreadyPostedSchema } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/rejections_pb.js";

test("posts and reads a real MessageBoard Projection through the local gateway", async ({
  page,
}, testInfo) => {
  const protocols: string[] = [];
  if (testInfo.project.name === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    cdp.on("Network.responseReceived", ({ response }) => {
      if (response.url.includes("QueryService/Execute")) protocols.push(response.protocol ?? "");
    });
  }
  await page.goto("/");
  await expect(page).toHaveTitle("Message Board");
  await expect(page.getByRole("heading", { name: "Message Board" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Updating live");
  const statistics = page.getByRole("region", { name: "Board statistics" });
  await expect(statistics).toContainText(/No visible activity yet|\d+ messages/);
  const previousCount = Number(
    (await statistics.textContent())?.match(/(\d+) messages/)?.[1] ?? "0",
  );

  await page.getByRole("textbox", { name: "Message" }).press("ControlOrMeta+Enter");
  await expect(page.getByText("Enter a username.")).toBeVisible();
  await expect(page.getByText("Enter a message.")).toBeVisible();

  const usernameInput = page.getByRole("textbox", { name: "Username" });
  await expect(usernameInput).toBeFocused();
  await expect(usernameInput).toHaveAttribute("aria-invalid", "true");

  const username = `visitor-${String(Date.now())}`;
  const message = `browser acceptance ${String(Date.now())}`;
  await usernameInput.fill(username);
  await page.getByRole("textbox", { name: "Message" }).fill(message);
  await page.getByRole("button", { name: "Post message" }).click();

  const messages = page.getByRole("list", { name: "Messages" });
  const posted = messages.getByRole("article").filter({ hasText: message });
  await expect(posted.getByText("Anonymous")).toBeVisible();
  await expect(posted.getByText(username)).toHaveCount(0);
  await expect(posted.getByText(message)).toBeVisible();
  await expect(posted.getByText("just now")).toBeVisible();
  await expect(messages.getByRole("listitem").last()).toContainText(message);
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Post message" })).toBeEnabled();
  await expect
    .poll(async () => Number((await statistics.textContent())?.match(/(\d+) messages/)?.[1] ?? "0"))
    .toBeGreaterThan(previousCount);
  if (testInfo.project.name === "chromium") expect(protocols).toContain("h2");
});

test("keeps live updates connected beyond the former local timeout", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "This timed acceptance is required only in Chromium.",
  );
  test.setTimeout(90_000);

  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText("Updating live");
  await page.waitForTimeout(61_000);
  await expect(page.getByRole("status")).toHaveText("Updating live");

  const sender = await page.context().newPage();
  try {
    await sender.goto("/");
    await expect(sender.getByRole("status")).toHaveText("Updating live");
    const username = `boundary-${String(Date.now())}`;
    const message = `after former boundary ${String(Date.now())}`;
    await sender.getByRole("textbox", { name: "Username" }).fill(username);
    await sender.getByRole("textbox", { name: "Message" }).fill(message);
    await sender.getByRole("button", { name: "Post message" }).click();
    await expect(page.getByRole("list", { name: "Messages" }).getByText(message)).toBeVisible();
    await expect(sender.getByRole("button", { name: "Post message" })).toBeEnabled();
  } finally {
    await sender.close();
  }
});

test("keeps two stock browser tabs live through alternating posts after the former timeout", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "This timed acceptance is required only in Chromium.",
  );
  const stabilityObservationMilliseconds = Number(
    process.env.MESSAGE_BOARD_STABILITY_OBSERVATION_MS ?? 36_000,
  );
  test.setTimeout(stabilityObservationMilliseconds + 90_000);

  const sender = await page.context().newPage();
  const protocols: { readonly url: string; readonly protocol: string }[] = [];
  for (const browserPage of [page, sender]) {
    const cdp = await browserPage.context().newCDPSession(browserPage);
    await cdp.send("Network.enable");
    cdp.on("Network.responseReceived", ({ response }) => {
      if (response.url.includes("/spine."))
        protocols.push({ url: response.url, protocol: response.protocol ?? "" });
    });
  }
  const failures: string[] = [];
  const cancellationTargets: { readonly id: string; readonly type: string }[] = [];
  const postedType = TypeUrls.derive(MessagePostedSchema);
  const rejectedType = TypeUrls.derive(MessageAlreadyPostedSchema);
  const expectPostCancellation = async (prior: ReadonlySet<string>): Promise<void> => {
    await expect
      .poll(() => {
        const recent = cancellationTargets.filter((target) => !prior.has(target.id));
        return [postedType, rejectedType].map(
          (type) =>
            new Set(recent.filter((target) => target.type === type).map((target) => target.id))
              .size,
        );
      })
      .toEqual([1, 1]);
  };
  for (const browserPage of [page, sender]) {
    browserPage.on("console", (message) => {
      if (message.type() === "error") failures.push(`console: ${message.text()}`);
    });
    browserPage.on("response", (response) => {
      if (response.status() === 404) failures.push(`404: ${response.url()}`);
      if (response.status() === 401) failures.push(`401: ${response.url()}`);
      if (response.status() >= 500)
        failures.push(`${String(response.status())}: ${response.url()}`);
      if (response.url().endsWith("/spine.client.SubscriptionService/Cancel")) {
        const body = response.request().postDataBuffer();
        const contentType = response.request().headers()["content-type"] ?? "";
        if (body === null) {
          failures.push("Cancel request had no body");
          return;
        }
        try {
          const bytes = contentType.includes("grpc-web") ? body.subarray(5) : body;
          const subscription = fromBinary(SubscriptionSchema, bytes);
          cancellationTargets.push({
            id: subscription.id?.value ?? "",
            type: subscription.topic?.target?.type ?? "",
          });
        } catch {
          failures.push("Cancel request could not be decoded");
        }
      }
    });
  }
  try {
    await page.goto("/");
    await sender.goto("/");
    await expect(page.getByRole("status")).toHaveText("Updating live");
    await expect(sender.getByRole("status")).toHaveText("Updating live");
    cancellationTargets.length = 0;

    for (let sequence = 1; sequence <= 8; sequence += 1) {
      const prior = new Set(cancellationTargets.map((target) => target.id));
      const writer = sequence % 2 === 0 ? sender : page;
      const message = `alternating live message ${String(sequence)} ${String(Date.now())}`;
      await writer.getByRole("textbox", { name: "Username" }).fill(`writer-${String(sequence)}`);
      await writer.getByRole("textbox", { name: "Message" }).fill(message);
      await writer.getByRole("button", { name: "Post message" }).click();
      await expect(page.getByRole("list", { name: "Messages" }).getByText(message)).toBeVisible({
        timeout: 15_000,
      });
      await expect(sender.getByRole("list", { name: "Messages" }).getByText(message)).toBeVisible({
        timeout: 15_000,
      });
      await expectPostCancellation(prior);
    }

    await page.waitForTimeout(stabilityObservationMilliseconds);
    const prior = new Set(cancellationTargets.map((target) => target.id));
    const message = `after former timeout ${String(Date.now())}`;
    await sender.getByRole("textbox", { name: "Username" }).fill("post-timeout-writer");
    await sender.getByRole("textbox", { name: "Message" }).fill(message);
    await sender.getByRole("button", { name: "Post message" }).click();
    await expect(page.getByRole("list", { name: "Messages" }).getByText(message)).toBeVisible({
      timeout: 15_000,
    });
    await expect(sender.getByRole("list", { name: "Messages" }).getByText(message)).toBeVisible({
      timeout: 15_000,
    });
    await expectPostCancellation(prior);
    await expect(page.getByRole("status")).toHaveText("Updating live");
    await expect(sender.getByRole("status")).toHaveText("Updating live");
    expect(new Set(cancellationTargets.map((target) => target.id)).size).toBe(18);
    expect(
      cancellationTargets.every(
        (target) =>
          target.id.length > 0 && (target.type === postedType || target.type === rejectedType),
      ),
    ).toBe(true);
    expect(failures).toEqual([]);
    for (const path of [
      "QueryService/Execute",
      "SubscriptionService/Activate",
      "CommandService/Post",
    ])
      expect(protocols.some(({ url, protocol }) => url.includes(path) && protocol === "h2")).toBe(
        true,
      );
    expect(protocols.every(({ protocol }) => protocol === "h2")).toBe(true);
  } finally {
    await sender.close();
  }
});
