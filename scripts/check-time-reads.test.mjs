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

import { findTimeBypasses, findTimeImports, timeReadPolicy } from "./check-time-reads.mjs";

describe("time read bypass check", () => {
  it("finds direct and aliased wall or monotonic clock reads", () => {
    const source = `
      const D = Date;
      const read = Date.now;
      const { now: readAgain } = D;
      const p = performance;
      const { hrtime: high } = process;
      Date.now(); new Date(); Date(); Date(0); D.now(); read(); readAgain(); p.now(); high.bigint(); process.hrtime.bigint();
    `;
    expect(findTimeBypasses(source)).toHaveLength(11);
  });

  it("finds imported timestamp helpers and aliased imports", () => {
    const source = `
      import { timestampNow as stamp } from "some-clock-library";
      import { now } from "some-date-library";
      stamp(); now();
    `;
    expect(findTimeBypasses(source)).toHaveLength(2);
  });

  it("finds clock references, global clock members, imported platform aliases, and bare constructors", () => {
    const source = `
      import { performance as clock } from "node:perf_hooks";
      import { hrtime } from "node:process";
      const options = { now: Date.now };
      const wall = Date["now"];
      globalThis.Date.now(); globalThis.performance.now();
      clock.now(); hrtime.bigint(); new Date;
    `;
    expect(findTimeBypasses(source)).toHaveLength(7);
  });

  it.each([
    "Date.now.bind(Date)",
    "Date.now.call(Date)",
    "Date.now.apply(Date, [])",
    "performance.now.bind(performance)",
    "performance.now.call(performance)",
    "performance.now.apply(performance, [])",
    "process.hrtime.bind(process)",
    "process.hrtime.call(process)",
    "process.hrtime.bigint.bind(process.hrtime)",
    "process.hrtime.bigint.call(process.hrtime)",
  ])("rejects a bound or indirectly invoked clock member: %s", (source) => {
    expect(findTimeBypasses(`${source};`)).not.toEqual([]);
  });

  it("rejects imported current-timestamp helpers when bound or forwarded as callbacks", () => {
    const source = `
      import { timestampNow as stamp } from "some-clock-library";
      stamp.bind(null); stamp.call(null); stamp.apply(null, []);
      setTimeout(stamp, 1);
    `;
    expect(findTimeBypasses(source)).toHaveLength(4);
  });

  it("ignores comments, fixture strings, supplied dates, and timer scheduling", () => {
    const source = `
      // Date.now();
      const fixture = "new Date(); performance.now();";
      const parsed = new Date(input);
      const copy = new Date(parsed.getTime());
      setTimeout(callback, 10);
    `;
    expect(findTimeBypasses(source)).toEqual([]);
  });

  it("reserves Time for runtime TypeScript and spawned application fixtures", () => {
    expect(timeReadPolicy("packages/server/src/delivery/inbox.ts")).toBe("runtime");
    expect(timeReadPolicy("examples/message-board/app/src/system-clock.ts")).toBe("runtime");
    expect(timeReadPolicy("examples/message-board/web/src/relative-time.ts")).toBe("runtime");
    expect(timeReadPolicy("packages/delivery-client/test-fixtures/multi-machine-app.mjs")).toBe(
      "runtime",
    );
    for (const path of [
      "examples/message-board/web/src/post-form.tsx",
      "examples/orders/src/load-runner.ts",
      "scripts/release-get.mjs",
      "examples/message-board/deploy/container/build-local-images.mjs",
      "examples/message-board/web/test/interop/harness.mjs",
      "packages/server/test/repository/entity-delivery-benchmark.test.ts",
    ])
      expect(timeReadPolicy(path)).toBe("platform");
    expect(timeReadPolicy("packages/core/test/time.test.ts")).toBe("test");
  });

  it("rejects Time imports in tooling and TSX without flagging fixture text", () => {
    const source = `
      // import { Time } from "@spine-event-engine/core/time";
      const fixture = 'import { Time } from "@spine-event-engine/core/time"';
      import { Time as SharedClock } from "@spine-event-engine/core/time";
      import { Time } from "@spine-event-engine/core";
      import { Time as SourceClock } from "../packages/core/src/time/index.ts";
      import * as Core from "@spine-event-engine/core";
      Core.Time.currentTime();
      import("@spine-event-engine/core/time");
      require("@spine-event-engine/core/time");
    `;
    expect(findTimeImports(source)).toHaveLength(6);
  });
});
