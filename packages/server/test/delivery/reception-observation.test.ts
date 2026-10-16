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

import { receptionObservation } from "../../src/delivery/reception-observation.js";

describe("managed reception observation", () => {
  it("keeps exact handler failures local to concurrent and nested attempts", async () => {
    const first = receptionObservation.create();
    const second = receptionObservation.create();
    const nested = receptionObservation.create();
    const firstError = new Error("first handler");
    const secondError = "second handler";
    const releaseFirst = Promise.withResolvers<undefined>();
    const enteredFirst = Promise.withResolvers<undefined>();

    const firstRun = receptionObservation.run(first, async () => {
      first.entered = true;
      receptionObservation.markManaged();
      enteredFirst.resolve(undefined);
      await releaseFirst.promise;
      receptionObservation.recordHandlerFailure(firstError);
      receptionObservation.run(nested, () => {
        nested.entered = true;
        receptionObservation.markManaged();
        receptionObservation.recordHandlerFailure(secondError);
      });
    });
    await enteredFirst.promise;
    receptionObservation.run(second, () => {
      second.entered = true;
      receptionObservation.markManaged();
      receptionObservation.recordHandlerFailure(secondError);
    });
    releaseFirst.resolve(undefined);
    await firstRun;

    expect(receptionObservation.isReceptorFailure(first, firstError)).toBe(true);
    expect(receptionObservation.isReceptorFailure(first, secondError)).toBe(false);
    expect(receptionObservation.isReceptorFailure(second, secondError)).toBe(true);
    expect(receptionObservation.isReceptorFailure(second, firstError)).toBe(false);
    expect(receptionObservation.isReceptorFailure(nested, secondError)).toBe(true);
    expect(receptionObservation.isReceptorFailure(nested, firstError)).toBe(false);
  });
});
