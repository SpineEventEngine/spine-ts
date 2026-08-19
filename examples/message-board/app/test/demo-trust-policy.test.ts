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

/**
 * Keeps the public demonstration board free of browser-session credentials.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();

describe("Message Board public-demo trust policy", () => {
  it("uses the Gateway public-demo extension instead of any Message Board session credential", () => {
    const sources = [
      "examples/message-board/app/src/deployment-config.ts",
      "examples/message-board/app/src/index.ts",
      "examples/message-board/app/src/gateway-entry.ts",
      "examples/message-board/app/src/combined-server.ts",
      "examples/message-board/web/src/local-entry.tsx",
    ] as const;
    const forbidden = [
      "SignedSessions",
      "BrowserSession",
      "message-board-local-fixture",
      "MESSAGE_BOARD_SESSION_",
    ] as const;

    for (const source of sources) {
      const text = readFileSync(join(repositoryRoot, source), "utf8");
      for (const token of forbidden) expect(text, `${source}: ${token}`).not.toContain(token);
    }

    expect(existsSync(join(repositoryRoot, "examples/message-board/app/src/local-session.ts"))).toBe(
      false,
    );
    expect(
      readFileSync(join(repositoryRoot, "examples/message-board/app/src/public-board-admission.ts"), "utf8"),
    ).toContain("PublicBoardAdmission");
  });

  it("documents purpose-named startup modules, launchers, and every supported mode", () => {
    for (const source of [
      "examples/message-board/app/src/single-process-app.ts",
      "examples/message-board/app/src/multi-process-coordinator.ts",
      "examples/message-board/app/src/multi-process-replica.ts",
      "examples/message-board/scripts/start-local-single-process.sh",
      "examples/message-board/scripts/start-local-multi-process.sh",
    ]) expect(existsSync(join(repositoryRoot, source)), source).toBe(true);
    const readme = readFileSync(join(repositoryRoot, "examples/message-board/README.md"), "utf8");
    for (const mode of ["local single-process", "local multi-process", "combined container", "Kubernetes cluster"])
      expect(readme).toContain(mode);
  });
});
