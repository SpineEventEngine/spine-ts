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

import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, vi } from "vitest";

const roots = vi.hoisted(() => [] as Root[]);

vi.mock("react-dom/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom/client")>();
  return {
    ...actual,
    createRoot: (...args: Parameters<typeof actual.createRoot>) => {
      const root = actual.createRoot(...args);
      roots.push(root);
      return root;
    },
  };
});

/**
 * Starts the real renderer and verifies that its React root is tracked for teardown.
 */
export async function mountRenderer(): Promise<void> {
  await import("../src/renderer.js");
  if (roots.length !== 1) throw new Error("Renderer did not create one tracked React root.");
}

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
});
