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
import { BackendMembershipKernel } from "../src/internal/backend-membership-kernel.js";

describe("BackendMembershipKernel", () => {
  it("rewrites only the immediate child definition for each member", async () => {
    const received: string[] = [];
    const kernel = new BackendMembershipKernel({
      create: () =>
        Promise.resolve({
          close: () => Promise.resolve(),
          forward: () => Promise.resolve(new Uint8Array()),
          subscribe: (definition: Uint8Array) => {
            received.push(new TextDecoder().decode(definition));
            return Promise.resolve(definition);
          },
          activate: () => Promise.resolve(),
          dispose: () => Promise.resolve(),
        }),
      memberKey: (member: { readonly id: string }) => member.id,
      sameMember: () => true,
      definitionKey: (definition: Uint8Array) => new TextDecoder().decode(definition),
      childDefinition: (definition: Uint8Array, member: { readonly id: string }) =>
        new TextEncoder().encode(`${new TextDecoder().decode(definition)}/${member.id}`),
      childSize: (child: Uint8Array) => child.byteLength,
    });

    await kernel.reconcile([{ id: "a" }, { id: "b" }]);
    await kernel.subscribe(new TextEncoder().encode("logical"), new AbortController().signal);

    expect(received).toEqual(["logical/a", "logical/b"]);
    await kernel.close();
  });
});
