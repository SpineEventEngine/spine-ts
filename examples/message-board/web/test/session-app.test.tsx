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
import { BrowserSession, Client } from "@spine-event-engine/client-web";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionBoardApp } from "../src/session-app.js";

vi.mock("../src/index.js", () => ({ MessageBoardApp: () => null }));

describe("signed reader selection", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("closes a pending credential and ignores its late completion after unmount", async () => {
    const deferred = Promise.withResolvers<void>();
    vi.spyOn(BrowserSession.prototype, "reauthenticate").mockImplementation(() => deferred.promise);
    vi.spyOn(BrowserSession.prototype, "context", "get").mockReturnValue({ actor: "ada" });
    const close = vi.spyOn(BrowserSession.prototype, "close");
    const forConnect = vi.spyOn(Client, "forConnect");
    const mounted = render(
      createElement(SessionBoardApp, { url: "http://127.0.0.1:8090", mode: "signed" }),
    );
    fireEvent.change(screen.getByLabelText("Issued bearer credential"), {
      target: { value: "issued-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use credential" }));
    await waitFor(() => expect(BrowserSession.prototype.reauthenticate).toHaveBeenCalledOnce());
    mounted.unmount();
    await waitFor(() => expect(close).toHaveBeenCalled());
    deferred.resolve();
    await Promise.resolve();
    expect(forConnect).not.toHaveBeenCalled();
  });

  it("hides the previous reader while a replacement credential is pending or fails", async () => {
    const replacement = Promise.withResolvers<void>();
    const reauthenticate = vi
      .spyOn(BrowserSession.prototype, "reauthenticate")
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => replacement.promise);
    vi.spyOn(BrowserSession.prototype, "context", "get").mockReturnValue({ actor: "ada" });
    const clientClose = vi.fn(async () => undefined);
    vi.spyOn(Client, "forConnect").mockReturnValue({
      onBehalfOf: () => ({}),
      close: clientClose,
    } as never);
    render(createElement(SessionBoardApp, { url: "http://127.0.0.1:8090", mode: "signed" }));
    const input = screen.getByLabelText("Issued bearer credential");
    fireEvent.change(input, { target: { value: "first" } });
    fireEvent.click(screen.getByRole("button", { name: "Use credential" }));
    await waitFor(() => expect(screen.getByText("Signed in as ada")).toBeTruthy());
    fireEvent.change(input, { target: { value: "replacement" } });
    fireEvent.click(screen.getByRole("button", { name: "Use credential" }));
    await waitFor(() => expect(reauthenticate).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Signed in as ada")).toBeNull();
    await waitFor(() => expect(clientClose).toHaveBeenCalledOnce());
    replacement.reject(new Error("invalid"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.queryByText("Signed in as ada")).toBeNull();
  });
});
