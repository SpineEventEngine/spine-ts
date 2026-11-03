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

  it("allows a verified retry after a credential without an actor fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(BrowserSession.prototype, "reauthenticate").mockResolvedValue(undefined);
    vi.spyOn(BrowserSession.prototype, "context", "get")
      .mockReturnValueOnce(undefined)
      .mockReturnValue({ actor: "ada" });
    const forConnect = vi.spyOn(Client, "forConnect").mockReturnValue({
      onBehalfOf: () => ({}),
      close: vi.fn(async () => undefined),
    } as never);
    render(createElement(SessionBoardApp, { url: "http://127.0.0.1:8090", mode: "signed" }));
    const input = screen.getByLabelText("Issued bearer credential");
    fireEvent.change(input, { target: { value: "invalid" } });
    fireEvent.click(screen.getByRole("button", { name: "Use credential" }));
    await screen.findByText("Credential is invalid or the session is unavailable.");
    expect(warn).toHaveBeenCalledWith(
      "Message Board credential validation failed.",
      expect.any(Error),
    );
    expect(forConnect).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "valid" } });
    fireEvent.click(screen.getByRole("button", { name: "Use credential" }));
    await screen.findByText("Signed in as ada");
    expect(forConnect).toHaveBeenCalledOnce();
  });

  it("selects a public board and closes its client on unmount", async () => {
    const close = vi.fn(async () => undefined);
    const forConnect = vi.spyOn(Client, "forConnect").mockReturnValue({
      onBehalfOf: () => ({}),
      close,
    } as never);
    const mounted = render(
      createElement(SessionBoardApp, { url: "http://127.0.0.1:8090", mode: "public" }),
    );
    expect(forConnect).toHaveBeenCalledWith("http://127.0.0.1:8090");
    expect(
      screen.getByText("Public reader: author names are hidden in board results."),
    ).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Board" }), {
      target: { value: "announcements" },
    });
    expect((screen.getByRole("combobox", { name: "Board" }) as HTMLSelectElement).value).toBe(
      "announcements",
    );
    mounted.unmount();
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
  });
});
