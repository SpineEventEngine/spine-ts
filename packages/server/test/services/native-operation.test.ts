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

import { Code } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { NativeOperation } from "../../src/services/native-operation.js";

describe("native operation lifetime", () => {
  it("rejects work when the peer or host already stopped", () => {
    for (const stopped of ["peer", "host"]) {
      const peer = new AbortController();
      const host = new AbortController();
      (stopped === "peer" ? peer : host).abort();
      const operation = new NativeOperation(peer.signal, host.signal);
      expect(() => {
        operation.check();
      }).toThrow(expect.objectContaining({ code: Code.Canceled }));
      operation.close();
    }
  });

  it("links an already invalidated session and never admits its work", () => {
    const invalidation = new AbortController();
    invalidation.abort();
    const operation = new NativeOperation(
      new AbortController().signal,
      new AbortController().signal,
    );
    operation.link(invalidation.signal);
    expect(() => {
      operation.check();
    }).toThrow(expect.objectContaining({ code: Code.Canceled }));
    operation.close();
  });

  it("propagates later host cancellation and closes an otherwise live operation", () => {
    const host = new AbortController();
    const operation = new NativeOperation(new AbortController().signal, host.signal);
    operation.check();
    host.abort();
    expect(operation.signal.aborted).toBe(true);
    operation.close();

    const independent = new NativeOperation(
      new AbortController().signal,
      new AbortController().signal,
    );
    independent.close();
    expect(independent.signal.aborted).toBe(true);
  });
});
