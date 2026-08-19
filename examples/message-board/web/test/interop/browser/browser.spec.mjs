// Drives two browser tabs through posting, live updates, and reconnect recovery.
import { expect, test } from "@playwright/test";
import { stdout } from "node:process";
import { clearTimeout } from "node:timers";

function cookies(setCookie, url) {
  return JSON.parse(setCookie).map((value) => {
    const [pair, ...attributes] = value.split("; ");
    const [name, cookieValue] = pair.split("=");
    return {
      name,
      value: cookieValue,
      url,
      httpOnly: attributes.includes("HttpOnly"),
      secure: attributes.includes("Secure"),
      sameSite: "Lax",
    };
  });
}

export function captureBrowserFailures(page) {
  const failures = [];
  page.on("requestfailed", (request) =>
    failures.push({
      path: new URL(request.url()).pathname,
      failure: request.failure(),
      headers: safeFailureHeaders(request.headers()),
    }),
  );
  page.on("console", (message) => {
    if (message.type() === "error") failures.push({ console: "browser console error" });
  });
  return failures;
}

test("redacts browser failure secrets while retaining safe transport facts", () => {
  const handlers = new Map();
  const failures = captureBrowserFailures({ on: (name, handler) => handlers.set(name, handler) });
  handlers.get("requestfailed")({
    url: () => "https://gateway.test/path?csrf=secret&token=secret#secret",
    failure: () => ({ errorText: "net::ERR_FAILED" }),
    headers: () => ({
      cookie: "secret",
      authorization: "Bearer secret",
      "x-spine-csrf": "secret",
      "content-type": "application/grpc-web+proto",
      "x-grpc-web": "1",
    }),
  });
  handlers.get("console")({
    type: () => "error",
    text: () => "https://gateway.test/path?csrf=secret Authorization: Bearer secret",
  });
  const text = JSON.stringify(failures);
  expect(text).toContain("content-type");
  expect(text).toContain("browser console error");
  expect(text).not.toMatch(/secret|cookie|authorization|x-spine-csrf|csrf|token/);
});

function safeFailureHeaders(headers) {
  const allowed = ["content-type", "x-grpc-web", "x-user-agent"];
  return Object.fromEntries(
    allowed.flatMap((name) => (headers[name] === undefined ? [] : [[name, headers[name]]])),
  );
}

function captureGrpcWebResponses(page) {
  const responses = [];
  page.on("response", (response) => {
    if (!response.url().includes("/spine.client.SubscriptionService/")) return;
    responses.push({
      path: new URL(response.url()).pathname,
      status: response.status(),
      grpcStatus: response.headers()["grpc-status"],
    });
  });
  return responses;
}

test("runs a CSRF-protected cookie Projection subscription through the real gRPC-Web client and Envoy", async ({
  context,
  page,
}) => {
  await context.addCookies(
    cookies(process.env.E1_COOKIE_SET_COOKIE, process.env.E1_ENVOY_BASE_URL),
  );
  await page.goto(
    `/?baseUrl=${encodeURIComponent(process.env.E1_ENVOY_BASE_URL)}&csrf=${encodeURIComponent(process.env.E1_CSRF)}`,
  );
  const failures = captureBrowserFailures(page);
  await expect.poll(() => page.evaluate(() => Boolean(window.interopClient))).toBe(true);
  try {
    await expect(page.evaluate(() => window.resolveContext())).resolves.toMatchObject({
      actor: "ada",
    });
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)} browser=${JSON.stringify(failures)}`,
    );
  }
  await page.evaluate(() => window.post());
  await expect
    .poll(() => page.evaluate(async () => (await window.read()).message.length))
    .toBeGreaterThan(0);
  await expect(page.evaluate(() => window.subscribe())).resolves.toMatchObject({ done: false });
});

test("keeps a passive viewer alive for three sequential writer updates through Envoy and Gateway", async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "focused Chromium passive-viewer regression");
  const viewer = await browser.newContext({ ignoreHTTPSErrors: true });
  const writer = await browser.newContext({ ignoreHTTPSErrors: true });
  let viewerPage;
  try {
    await viewer.addCookies(
      cookies(process.env.E1_COOKIE_SET_COOKIE, process.env.E1_ENVOY_BASE_URL),
    );
    await writer.addCookies(
      cookies(process.env.E1_COOKIE_SET_COOKIE, process.env.E1_ENVOY_BASE_URL),
    );
    viewerPage = await viewer.newPage();
    const writerPage = await writer.newPage();
    const viewerUrl = `/?baseUrl=${encodeURIComponent(process.env.E1_ENVOY_BASE_URL)}&csrf=${encodeURIComponent(process.env.E1_CSRF)}&actor=ada&messageIdPrefix=passive-viewer`;
    const writerUrl = `/?baseUrl=${encodeURIComponent(process.env.E1_ENVOY_BASE_URL)}&csrf=${encodeURIComponent(process.env.E1_CSRF)}&actor=ada&messageIdPrefix=passive-viewer`;
    await viewerPage.goto(viewerUrl);
    await writerPage.goto(writerUrl);
    const failures = captureBrowserFailures(viewerPage);
    const grpcWeb = captureGrpcWebResponses(viewerPage);
    stdout.write("PASSIVE_VIEWER_PRECONDITION\n");
    try {
      await viewerPage.evaluate(() => window.startPassiveSubscription());
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)} browser=${JSON.stringify(failures)}`,
      );
    }
    const identities = [];
    for (let update = 0; update < 3; update += 1) {
      stdout.write(`BROWSER_PASSIVE_ITERATOR_WAIT ${update + 1}\n`);
      const next = viewerPage.evaluate(() => window.nextPassiveUpdate());
      await writerPage.evaluate(() => window.post());
      let received;
      let rejectTimeout;
      const timedOut = new Promise((_, reject) => {
        rejectTimeout = () => reject(new Error(`passive update ${update + 1} timeout`));
      });
      const timeout = setTimeout(rejectTimeout, 5_000);
      try {
        received = await Promise.race([next, timedOut]);
      } catch (error) {
        stdout.write(
          `BROWSER_PASSIVE_TIMEOUT ${JSON.stringify({ update: update + 1, grpcWeb, failures })}\n`,
        );
        throw error;
      } finally {
        clearTimeout(timeout);
      }
      expect(received.done).toBe(false);
      identities.push(received.identity);
      stdout.write(
        `PASSIVE_VIEWER_UPDATE ${JSON.stringify({ update: update + 1, identity: received.identity, grpcWeb })}\n`,
      );
    }
    expect(new Set(identities).size).toBe(3);
  } finally {
    await viewerPage?.evaluate(() => window.stopPassiveSubscription()).catch(() => undefined);
    await writer.close();
    await viewer.close();
  }
});

test("uses the explicit Connect browser client for resolver composition, Post, and authoritative Read", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "focused Chromium Connect smoke");
  await page.goto(
    `/?baseUrl=${encodeURIComponent(process.env.E1_ENVOY_BASE_URL)}&protocol=connect`,
  );
  await expect.poll(() => page.evaluate(() => window.interopProtocol)).toBe("connect");
  const resolverRequestHeaders = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/spine.auth.AuthenticationService/ResolveContext"))
      resolverRequestHeaders.push(request.headers());
  });
  await expect(page.evaluate(() => window.resolveContext())).resolves.toMatchObject({
    actor: "ada",
  });
  expect(resolverRequestHeaders).toContainEqual(
    expect.objectContaining({
      "connect-protocol-version": "1",
      "content-type": "application/json",
    }),
  );
  await expect(page.evaluate(() => window.post())).resolves.toBeDefined();
  await expect
    .poll(() => page.evaluate(async () => (await window.read()).message.length))
    .toBeGreaterThan(0);
});

test("rejects invalid, expired, and CSRF-invalid browser credentials before Post", async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "focused Chromium security matrix");
  const invalid = await browser.newContext({ ignoreHTTPSErrors: true });
  const invalidPage = await invalid.newPage();
  await invalidPage.goto(
    `/?baseUrl=${encodeURIComponent(process.env.E1_ENVOY_BASE_URL)}&auth=invalid`,
  );
  await expect(invalidPage.evaluate(() => window.resolveContext())).rejects.toThrow();
  await invalid.close();

  const expired = await browser.newContext({ ignoreHTTPSErrors: true });
  await expired.addCookies(
    cookies(process.env.E1_EXPIRED_COOKIE_SET_COOKIE, process.env.E1_ENVOY_BASE_URL),
  );
  const expiredPage = await expired.newPage();
  await expiredPage.goto(
    `/?baseUrl=${encodeURIComponent(process.env.E1_ENVOY_BASE_URL)}&csrf=${encodeURIComponent(process.env.E1_CSRF)}`,
  );
  await expect(expiredPage.evaluate(() => window.resolveContext())).rejects.toThrow();
  await expired.close();

  const csrf = await browser.newContext({ ignoreHTTPSErrors: true });
  await csrf.addCookies(cookies(process.env.E1_COOKIE_SET_COOKIE, process.env.E1_ENVOY_BASE_URL));
  const csrfPage = await csrf.newPage();
  await csrfPage.goto(
    `/?baseUrl=${encodeURIComponent(process.env.E1_ENVOY_BASE_URL)}&csrf=invalid`,
  );
  await expect(csrfPage.evaluate(() => window.resolveContext())).rejects.toThrow();
  await csrf.close();
});

test("rejects a credentialed request from a real non-allowlisted browser Origin", async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "focused Chromium security matrix");
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto(
    `https://localhost:4175/?baseUrl=${encodeURIComponent(process.env.E1_ENVOY_BASE_URL)}&csrf=${encodeURIComponent(process.env.E1_CSRF)}`,
  );
  await expect(page.evaluate(() => window.resolveContext())).rejects.toThrow();
  await context.close();
});

test("prevents Bert from activating or cancelling Ada's public subscription", async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "focused Chromium security matrix");
  const ada = await browser.newContext({ ignoreHTTPSErrors: true });
  await ada.addCookies(cookies(process.env.E1_COOKIE_SET_COOKIE, process.env.E1_ENVOY_BASE_URL));
  const adaPage = await ada.newPage();
  await adaPage.goto(
    `/?baseUrl=${encodeURIComponent(process.env.E1_ENVOY_BASE_URL)}&csrf=${encodeURIComponent(process.env.E1_CSRF)}&actor=ada`,
  );
  const wire = await adaPage.evaluate(() => window.createPublicSubscription());

  const bert = await browser.newContext({ ignoreHTTPSErrors: true });
  await bert.addCookies(cookies(process.env.E1_COOKIE_B_SET_COOKIE, process.env.E1_ENVOY_BASE_URL));
  const bertPage = await bert.newPage();
  await bertPage.goto(
    `/?baseUrl=${encodeURIComponent(process.env.E1_ENVOY_BASE_URL)}&csrf=${encodeURIComponent(process.env.E1_CSRF_B)}&actor=bert`,
  );
  await expect(
    bertPage.evaluate((bytes) => window.activatePublicSubscription(bytes), wire),
  ).rejects.toThrow();
  await expect(
    bertPage.evaluate((bytes) => window.cancelPublicSubscription(bytes), wire),
  ).rejects.toThrow();
  await adaPage.evaluate((bytes) => window.cancelPublicSubscription(bytes), wire);
  await bert.close();
  await ada.close();
});

test("releases the native subscription after an abrupt browser disconnect", async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "focused Chromium security matrix");
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await context.addCookies(
    cookies(process.env.E1_COOKIE_SET_COOKIE, process.env.E1_ENVOY_BASE_URL),
  );
  const page = await context.newPage();
  await page.goto(
    `/?baseUrl=${encodeURIComponent(process.env.E1_ENVOY_BASE_URL)}&csrf=${encodeURIComponent(process.env.E1_CSRF)}`,
  );
  await expect(page.evaluate(() => window.startActiveSubscription())).resolves.toBe(true);
  await page.close();
  await context.close();
  stdout.write("FORCED_VIEWER_DISCONNECT\n");
});

test("rejects unauthorized board and fabricated actor or tenant before public operations", async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "focused Chromium security matrix");
  for (const suffix of ["board=board-b", "actor=mallory", "tenant=fabricated"]) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    await context.addCookies(
      cookies(process.env.E1_COOKIE_SET_COOKIE, process.env.E1_ENVOY_BASE_URL),
    );
    const page = await context.newPage();
    await page.goto(
      `/?baseUrl=${encodeURIComponent(process.env.E1_ENVOY_BASE_URL)}&csrf=${encodeURIComponent(process.env.E1_CSRF)}&${suffix}`,
    );
    await expect(page.evaluate(() => window.post())).rejects.toThrow();
    await expect(page.evaluate(() => window.read())).rejects.toThrow();
    await expect(page.evaluate(() => window.createPublicSubscription())).rejects.toThrow();
    await context.close();
  }
});
