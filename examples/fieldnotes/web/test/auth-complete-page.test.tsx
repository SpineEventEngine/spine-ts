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

// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import CompletePage from "../src/app/auth/complete/page";

const completion = vi.hoisted(() => ({ completeGoogle: vi.fn<(fragment: string) => Promise<boolean>>() }));
vi.mock("../src/browser-auth", () => ({
  FieldnotesBrowserAuth: class {
    completeGoogle(fragment: string): Promise<boolean> {
      return completion.completeGoogle(fragment);
    }
  },
}));

afterEach(cleanup);

it("removes a one-use grant from browser history before showing a generic failed completion", async () => {
  window.history.replaceState(null, "", "/auth/complete#one-use-grant");
  completion.completeGoogle.mockImplementation(() => {
    expect(window.location.hash).toBe("");
    return Promise.resolve(false);
  });
  render(<CompletePage />);
  expect(screen.getByRole("status").textContent).toMatch(/completing sign-in/i);
  await waitFor(() => { expect(screen.getByText(/Sign-in failed/)).toBeTruthy(); });
  expect(completion.completeGoogle).toHaveBeenCalledWith("#one-use-grant");
  expect(screen.getByRole("link", { name: "Return to sign in" }).getAttribute("href")).toBe("/");
});

it("shows the same retry page when the private grant exchange is interrupted", async () => {
  window.history.replaceState(null, "", "/auth/complete#grant=interrupted");
  completion.completeGoogle.mockRejectedValueOnce(new Error("private host disconnected"));
  render(<CompletePage />);
  await waitFor(() => { expect(screen.getByText(/Sign-in failed/)).toBeTruthy(); });
  expect(window.location.hash).toBe("");
  expect(screen.queryByText(/private host disconnected/)).toBeNull();
});
