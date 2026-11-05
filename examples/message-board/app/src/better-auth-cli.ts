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

import { BetterAuthScenarios } from "./better-auth-scenarios.js";

const secret = process.env.BETTER_AUTH_SECRET;
if (secret === undefined) throw new Error("BETTER_AUTH_SECRET is required.");
const mode = process.argv[2];
if (mode !== "password" && mode !== "external-fixture")
  throw new Error("Choose password or external-fixture.");

const result =
  mode === "password"
    ? await BetterAuthScenarios.password(secret, "local-password-123")
    : await BetterAuthScenarios.external(
        secret,
        (request) =>
          Promise.resolve(
            request.headers.get("authorization") === "Bearer local-proof"
              ? "board-user"
              : undefined,
          ),
        "local-proof",
      );
if (!result.refused || !result.resolved || !result.loggedOut)
  throw new Error("Selected native authentication lifecycle failed.");
console.log(`${mode} native session refused invalid proof, resolved and logged out.`);
