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

import type { ConfiguredOidcProvider } from "@spine-event-engine/auth";

import { ComponentAuthScenarios } from "./component-auth-scenarios.js";

/**

 * A local test-only verified-provider fixture; configure a real adapter for deployment.

 */
const fixtureProvider: ConfiguredOidcProvider = {
  authorizationEndpoint: "https://fixture.example.test/authorize",
  recommendedScopes: ["openid"],
  provider: {
    issuer: "https://fixture.example.test",
    exchangeAuthorizationCode: ({ code }) =>
      Promise.resolve(
        code === "local-code"
          ? { issuer: "https://fixture.example.test", subject: "fixture-user" }
          : undefined,
      ),
  },
};

/**

 * Runs one local component lifecycle and prints only its nonsecret outcome.

 */
const mode = process.argv[2];
if (!["opaque", "signed", "oidc-fixture"].includes(mode ?? ""))
  throw new Error("Choose opaque, signed, or oidc-fixture.");
if (mode === "signed") {
  const result = await ComponentAuthScenarios.signed();
  if (!result.resolved || !result.revoked) throw new Error("Signed lifecycle failed.");
  console.log("Signed credential verified, revoked and explicitly maintained.");
} else {
  const password = process.env.SESSION_SEAL_PASSWORD;
  if (password === undefined) throw new Error("SESSION_SEAL_PASSWORD is required.");
  if (mode === "opaque") {
    const result = await ComponentAuthScenarios.opaque(password);
    if (!result.resolved || !result.revoked) throw new Error("Opaque lifecycle failed.");
    console.log("Opaque credential resolved, logged out and explicitly maintained.");
  } else {
    const result = await ComponentAuthScenarios.oidc(fixtureProvider, password, (url) =>
      Promise.resolve({
        code: "local-code",
        state: new URL(url).searchParams.get("state") ?? "",
        responseIssuer: fixtureProvider.provider.issuer,
      }),
    );
    if (!result.issued || !result.replayRejected || !result.resolved)
      throw new Error("Component OIDC fixture lifecycle failed.");
    console.log("Local OIDC fixture grant consumed once; application session issued.");
  }
}
