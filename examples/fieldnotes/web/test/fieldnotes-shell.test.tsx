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

import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { IdentityView } from "../src/browser-lifecycle";
import { FieldnotesShell } from "../src/fieldnotes-shell";

const identity = vi.hoisted(() => ({
  publish: null as ((view: IdentityView) => void) | null,
  signIn: vi.fn(), logout: vi.fn(), close: vi.fn(),
}));

vi.mock("../src/browser-lifecycle", () => ({
  FieldnotesBrowserLifecycle: class {
    constructor(_config: unknown, publish: (view: IdentityView) => void) { identity.publish = publish; }
    start(): Promise<void> { return Promise.resolve(); }
    signIn(): Promise<void> { identity.signIn(); return Promise.resolve(); }
    logout(): Promise<void> { identity.logout(); return Promise.resolve(); }
    close(): Promise<void> { identity.close(); return Promise.resolve(); }
  },
}));
vi.mock("../src/place-workspace", () => ({
  PlaceWorkspace: (props: { principalId: string; onPrivacyFailure: () => void }) =>
    <div data-testid="private-place-workspace">{props.principalId}
      <button type="button" onClick={props.onPrivacyFailure}>Interrupt private stream</button>
    </div>,
}));

it("mounts private workspace only after identity verification and removes it on stream failure", () => {
  const result = render(<FieldnotesShell config={{ mode: "google" }} />);
  expect(screen.getByRole("status").textContent).toMatch(/checking your session/i);
  expect(screen.queryByTestId("private-place-workspace")).toBeNull();
  act(() => identity.publish?.({ phase: "signed-out", principal: null, error: null }));
  fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
  expect(identity.signIn).toHaveBeenCalledOnce();
  act(() => identity.publish?.({ phase: "ready", principal: { id: "verified-author" }, error: null }));
  expect(screen.getByTestId("private-place-workspace").textContent).toContain("verified-author");
  fireEvent.click(screen.getByRole("button", { name: "Interrupt private stream" }));
  expect(screen.queryByTestId("private-place-workspace")).toBeNull();
  expect(screen.getByRole("alert").textContent).toMatch(/connection interrupted/i);
  result.unmount();
  expect(identity.close).toHaveBeenCalledOnce();
});
