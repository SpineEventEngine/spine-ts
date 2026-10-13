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
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

vi.mock("../src/studio-flow.js", async () => {
  const React = await import("react");
  return {
    StudioFlow: (props: {
      model: string;
      modelPending: boolean;
      selectModel: (slug: string) => Promise<void>;
      signOut: () => Promise<void>;
    }) =>
      React.createElement(
        "div",
        {},
        React.createElement("output", { "aria-label": "Selected model" }, props.model),
        React.createElement(
          "output",
          { "aria-label": "Model preparation" },
          String(props.modelPending),
        ),
        React.createElement(
          "button",
          { onClick: () => void props.selectModel("model-a") },
          "Model A",
        ),
        React.createElement(
          "button",
          { onClick: () => void props.selectModel("model-b") },
          "Model B",
        ),
        React.createElement(
          "button",
          { onClick: () => void props.selectModel("model-c") },
          "Model C",
        ),
        React.createElement("button", { onClick: () => void props.signOut() }, "Sign out"),
      ),
  };
});

const deferred = <T,>() => Promise.withResolvers<T>();

test("a clicked model displays immediately and only the latest confirmed choice becomes ready", async () => {
  const first = deferred<{ model: string }>();
  const second = deferred<{ model: string }>();
  const failed = deferred<{ model: string }>();
  const retry = deferred<{ model: string }>();
  const afterSignOut = deferred<{ model: string }>();
  const hydration = deferred<{ model: string }>();
  const selections = [first, second, failed, retry, afterSignOut];
  let activeSelection = false;
  const selectModel = vi.fn((clientId: string, model: string) => {
    if (clientId !== "client" || !["model-a", "model-b", "model-c"].includes(model))
      throw new Error("Unexpected model registration.");
    if (activeSelection) return Promise.reject(new Error("Overlapping model registration"));
    const selection = selections.shift();
    if (!selection) throw new Error("No selection response was prepared.");
    activeSelection = true;
    return selection.promise.finally(() => {
      activeSelection = false;
    });
  });
  const signedOut = { accounts: [], planEnabled: false, pendingClientIds: [] };
  Object.defineProperty(window, "releaseNotes", {
    configurable: true,
    value: {
      status: () =>
        Promise.resolve({
          accounts: [{ clientId: "client", subject: "subject", planEnabled: true }],
          selectedClientId: "client",
          planEnabled: true,
          pendingClientIds: [],
        }),
      models: () =>
        Promise.resolve([
          { slug: "model-a", displayName: "Model A" },
          { slug: "model-b", displayName: "Model B" },
          { slug: "model-c", displayName: "Model C" },
        ]),
      currentModel: () => hydration.promise,
      selectModel,
      session: () => Promise.resolve({ drafts: [], generations: {} }),
      signOut: () => Promise.resolve({ status: signedOut, revocationConfirmed: true }),
    },
  });
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => {
    await import("../src/renderer.js");
  });
  await screen.findByRole("button", { name: "Model A" });
  fireEvent.click(screen.getByRole("button", { name: "Model A" }));
  expect(screen.getByLabelText("Selected model").textContent).toBe("model-a");
  expect(screen.getByLabelText("Model preparation").textContent).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Model B" }));
  expect(screen.getByLabelText("Selected model").textContent).toBe("model-b");
  fireEvent.click(screen.getByRole("button", { name: "Model C" }));
  expect(screen.getByLabelText("Selected model").textContent).toBe("model-c");
  expect(selectModel).toHaveBeenCalledTimes(1);
  await act(async () => {
    hydration.resolve({ model: "model-a" });
    await hydration.promise;
  });
  expect(screen.getByLabelText("Selected model").textContent).toBe("model-c");
  await act(async () => {
    first.resolve({ model: "model-a" });
    await first.promise;
  });
  expect(screen.getByLabelText("Selected model").textContent).toBe("model-c");
  expect(screen.getByLabelText("Model preparation").textContent).toBe("true");
  await act(async () => {
    second.resolve({ model: "model-c" });
    await second.promise;
  });
  await waitFor(() => {
    expect(screen.getByLabelText("Model preparation").textContent).toBe("false");
  });
  expect(selectModel.mock.calls.map((call) => call[1])).toEqual(["model-a", "model-c"]);
  fireEvent.click(screen.getByRole("button", { name: "Model A" }));
  expect(screen.getByLabelText("Model preparation").textContent).toBe("true");
  await act(async () => {
    failed.reject(new Error("Unavailable"));
    await failed.promise.catch(() => undefined);
  });
  expect(screen.getByLabelText("Selected model").textContent).toBe("");
  expect(screen.getByText("That model is no longer available to this account.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Model A" }));
  expect(screen.getByLabelText("Selected model").textContent).toBe("model-a");
  expect(screen.queryByText("That model is no longer available to this account.")).toBeNull();
  await act(async () => {
    retry.resolve({ model: "model-a" });
    await retry.promise;
  });
  expect(screen.getByLabelText("Model preparation").textContent).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Model B" }));
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await screen.findByRole("dialog", { name: "Welcome" });
  await act(async () => {
    afterSignOut.resolve({ model: "model-b" });
    await afterSignOut.promise;
  });
  expect(screen.queryByLabelText("Selected model")).toBeNull();
  expect(selectModel).toHaveBeenCalledTimes(5);
});
