// Drives two credential-free browser tabs through the public Message Board Gateway.
import { expect, test } from "@playwright/test";
import { stdout } from "node:process";
import { clearTimeout } from "node:timers";

export function captureBrowserFailures(page) {
  const failures = [];
  page.on("requestfailed", (request) =>
    failures.push({ path: new URL(request.url()).pathname, failure: request.failure() }),
  );
  page.on("console", (message) => {
    if (message.type() === "error") failures.push({ console: "browser console error" });
  });
  return failures;
}

test("keeps browser diagnostics to a safe transport reason", () => {
  const handlers = new Map();
  const failures = captureBrowserFailures({ on: (name, handler) => handlers.set(name, handler) });
  handlers.get("requestfailed")({
    url: () => "https://gateway.test/path?private=ignored",
    failure: () => ({ errorText: "net::ERR_FAILED" }),
  });
  expect(JSON.stringify(failures)).toContain("/path");
  expect(JSON.stringify(failures)).not.toContain("private");
});

test("runs the public demo command, query, and subscription through Envoy", async ({ page }) => {
  await page.goto(`/?baseUrl=${encodeURIComponent(process.env.E1_ENVOY_BASE_URL)}`);
  const failures = captureBrowserFailures(page);
  await expect.poll(() => page.evaluate(() => Boolean(window.interopClient))).toBe(true);
  try {
    await page.evaluate(() => window.post());
    await expect
      .poll(() => page.evaluate(async () => (await window.read()).message.length))
      .toBeGreaterThan(0);
    await expect(page.evaluate(() => window.subscribe())).resolves.toMatchObject({ done: false });
  } catch (error) {
    throw new Error(`${String(error)} browser=${JSON.stringify(failures)}`);
  }
});

test("keeps a passive public viewer alive for three sequential writer updates", async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "two-tab stream lifecycle is covered by Chromium",
  );
  const viewer = await browser.newContext({ ignoreHTTPSErrors: true });
  const writer = await browser.newContext({ ignoreHTTPSErrors: true });
  let viewerPage;
  try {
    viewerPage = await viewer.newPage();
    const writerPage = await writer.newPage();
    const url = `/?baseUrl=${encodeURIComponent(process.env.E1_ENVOY_BASE_URL)}&actor=ada&messageIdPrefix=passive-viewer`;
    await viewerPage.goto(url);
    await writerPage.goto(url);
    const failures = captureBrowserFailures(viewerPage);
    stdout.write("PASSIVE_VIEWER_PRECONDITION\n");
    await viewerPage.evaluate(() => window.startPassiveSubscription());
    const identities = [];
    for (let update = 0; update < 3; update += 1) {
      const next = viewerPage.evaluate(() => window.nextPassiveUpdate());
      await writerPage.evaluate(() => window.post());
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`passive update ${update + 1} timeout`)), 5_000),
      );
      let received;
      try {
        received = await Promise.race([next, timeout]);
      } catch (error) {
        throw new Error(`${String(error)} browser=${JSON.stringify(failures)}`);
      } finally {
        clearTimeout(timeout);
      }
      expect(received.done).toBe(false);
      identities.push(received.identity);
      stdout.write(`PASSIVE_VIEWER_UPDATE ${update + 1}\n`);
    }
    expect(new Set(identities).size).toBe(3);
  } finally {
    await viewerPage?.evaluate(() => window.stopPassiveSubscription()).catch(() => undefined);
    await writer.close();
    await viewer.close();
  }
});

test("rejects a non-allowlisted browser origin before Gateway admission", async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const page = await context.newPage();
    await page.goto(
      `https://localhost:4175/?baseUrl=${encodeURIComponent(process.env.E1_ENVOY_BASE_URL)}`,
    );
    await expect(page.evaluate(() => window.post())).rejects.toThrow();
  } finally {
    await context.close();
  }
});
