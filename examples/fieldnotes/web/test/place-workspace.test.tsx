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

import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { PlaceViewSchema } from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/entities_pb.js";
import { PlaceIdSchema, CoordinatesSchema } from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/types_pb.js";
import { UserIdSchema } from "@spine-event-engine/proto";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PlaceWorkspace } from "../src/place-workspace";

const native = vi.hoisted(() => ({
  error: null as (() => void) | null,
  close: vi.fn(() => Promise.resolve()),
  add: vi.fn(), note: vi.fn(), rename: vi.fn(), move: vi.fn(), delete: vi.fn(),
}));
vi.mock("../src/native-places", () => ({
  FieldnotesNativePlaces: class {
    constructor(_principalId: string, _onChange: unknown, onError: () => void) { native.error = onError; }
    start(): Promise<void> { return Promise.resolve(); }
    close(): Promise<void> { return native.close(); }
    places(): unknown[] { return [place]; }
    commands(): object { return { add: native.add, note: native.note,
      rename: native.rename, move: native.move, delete: native.delete }; }
  },
}));
vi.mock("../src/place-map", () => ({
  PlaceMap: (props: { onPick: (point: { latitude: number; longitude: number }) => void;
    onCenter: (point: { latitude: number; longitude: number }) => void }) =>
    <div role="region" aria-label="Saved places map">
      <button type="button" onClick={() => { props.onPick({ latitude: 41, longitude: -8 }); }}>Pick map point</button>
      <button type="button" onClick={() => { props.onCenter({ latitude: 40, longitude: -7 }); }}>Move map center</button>
    </div>,
}));

const place = create(PlaceViewSchema, {
  id: create(PlaceIdSchema, { value: "lisbon" }),
  author: create(UserIdSchema, { value: "author" }),
  name: "Lisbon", markdown: "Saved **note**",
  coordinates: create(CoordinatesSchema, { latitude: 38.7, longitude: -9.1 }),
  whenCreated: create(TimestampSchema, { seconds: 1n }), revision: 1,
});

it("renders selected place and mobile Sheet editor, then fences a private stream failure", async () => {
  native.note.mockResolvedValue({ kind: "conflict", currentRevision: 2 });
  const privacyFailure = vi.fn();
  const result = render(<PlaceWorkspace principalId="author" onPrivacyFailure={privacyFailure} />);
  await screen.findByRole("button", { name: /Lisbon/ });
  fireEvent.click(screen.getByRole("button", { name: "Places" }));
  const places = screen.getByRole("dialog", { name: "Saved places" });
  fireEvent.change(within(places).getByPlaceholderText("Search places or notes"), {
    target: { value: "Lis" },
  });
  fireEvent.click(within(places).getByRole("button", { name: /Lisbon/ }));
  expect(screen.getByRole("heading", { name: "Lisbon" })).toBeTruthy();
  const details = screen.getByRole("dialog", { name: "Place details" });
  expect(details.textContent).toContain("Saved note");
  const edit = [...details.querySelectorAll("button")].find((button) => button.textContent === "Edit note");
  expect(edit).toBeDefined();
  if (edit === undefined) throw new Error("Mobile note edit action is missing.");
  fireEvent.click(edit);
  const editor = screen.getByRole("dialog", { name: "Edit place" });
  expect(editor.textContent).toContain("One Markdown note");
  fireEvent.change(within(editor).getByRole("textbox", { name: "Markdown editor" }), {
    target: { value: "draft words" },
  });
  fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
  await waitFor(() => { expect(editor.textContent).toContain("Place changed since last edit"); });
  fireEvent.click(within(editor).getByRole("button", { name: "Reapply draft to current version" }));
  fireEvent.click(within(editor).getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Close panel" }));
  act(() => native.error?.());
  expect(privacyFailure).toHaveBeenCalledOnce();
  result.unmount();
  expect(native.close).toHaveBeenCalledOnce();
  act(() => native.error?.());
  expect(privacyFailure).toHaveBeenCalledOnce();
});

it("uses the map center for AddPlace and keeps an explicitly refused form visible", async () => {
  native.add.mockResolvedValue({ kind: "refused" });
  const result = render(<PlaceWorkspace principalId="author" onPrivacyFailure={vi.fn()} />);
  await screen.findByRole("button", { name: /Lisbon/ });
  fireEvent.click(screen.getByRole("button", { name: "Move map center" }));
  const add = screen.getAllByRole("button", { name: "Add a place" })[0];
  if (add === undefined) throw new Error("AddPlace action is missing.");
  fireEvent.click(add);
  fireEvent.change(screen.getByRole("textbox", { name: "Place name" }), {
    target: { value: "Draft new place" },
  });
  expect(screen.getByRole("spinbutton", { name: "Latitude" })).toHaveProperty("value", "40");
  fireEvent.click(screen.getByRole("button", { name: "Pick map point" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => { expect(native.add).toHaveBeenCalledWith("Draft new place", 41, -8, ""); });
  expect(screen.getByText("The place change was refused. Review the fields.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("heading", { name: "No place selected" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Places" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Saved places" })).getByRole("button", {
    name: "Add a place",
  }));
  expect(screen.getByRole("dialog", { name: "Edit place" }).textContent).toContain("Place name");
  result.unmount();
});

it("keeps desktop selection stable during edits and wires rename, move and delete controls", async () => {
  native.rename.mockResolvedValue({ kind: "refused" });
  native.move.mockResolvedValue({ kind: "refused" });
  native.delete.mockResolvedValue({ kind: "refused" });
  const result = render(<PlaceWorkspace principalId="author" onPrivacyFailure={vi.fn()} />);
  await screen.findByRole("button", { name: /Lisbon/ });
  fireEvent.click(screen.getByRole("button", { name: "Pick map point" }));
  expect(screen.getByRole("heading", { name: "No place selected" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Lisbon/ }));
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  expect(screen.getByRole("button", { name: /Lisbon/ })).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByRole("textbox", { name: "Place name" }), { target: { value: "New name" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => { expect(native.rename).toHaveBeenCalledWith("lisbon", "New name", 1); });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Move pin" }));
  fireEvent.click(screen.getByRole("button", { name: "Pick map point" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => { expect(native.move).toHaveBeenCalledWith("lisbon", 41, -8, 1); });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete place" }));
  expect(screen.getByText(/cannot be undone/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Delete place" }));
  await waitFor(() => { expect(native.delete).toHaveBeenCalledWith("lisbon", 1); });
  result.unmount();
});
