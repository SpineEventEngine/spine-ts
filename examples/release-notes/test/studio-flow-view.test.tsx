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
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { DashboardView, StudioTopBar, WizardFrame } from "../src/studio-flow-view.js";

test("dashboard opens a retained release or the new-release wizard", () => {
  const newRelease = vi.fn();
  const openRelease = vi.fn();
  render(
    <>
      <DashboardView
        releases={[{ id: "draft-a", title: "Customer portal", subtitle: "v2.4.0" }]}
        newRelease={newRelease}
        openRelease={openRelease}
      />
      <StudioTopBar signOut={vi.fn()} />
    </>,
  );
  fireEvent.click(screen.getByRole("button", { name: "New release" }));
  fireEvent.click(screen.getByRole("button", { name: /Customer portal/ }));
  expect(newRelease).toHaveBeenCalledTimes(1);
  expect(openRelease).toHaveBeenCalledWith("draft-a");
  expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
});

test("wizard identifies the current step and returns to dashboard", () => {
  const dashboard = vi.fn();
  render(
    <WizardFrame
      step="style"
      dashboard={dashboard}
      heading="Writing style"
      footer={<button>Write</button>}
    >
      <p>Audience</p>
    </WizardFrame>,
  );
  expect(screen.getByText("Style").closest("li")?.getAttribute("aria-current")).toBe("step");
  expect(screen.getByText("Changes").closest("li")?.className).toBe("complete");
  fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
  expect(dashboard).toHaveBeenCalledTimes(1);
});
