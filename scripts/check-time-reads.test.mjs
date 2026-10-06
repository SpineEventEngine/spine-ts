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

import { findTimeBypasses } from "./check-time-reads.mjs";

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
});
