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
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PlaceDetails, PlaceEditor, SavedPlacesList } from "../src/place-panels";
import type { WorkspaceView } from "../src/workspace-state";

const place = create(PlaceViewSchema, {
  id: create(PlaceIdSchema, { value: "place-1" }),
  author: create(UserIdSchema, { value: "author" }),
  name: "Lisbon", markdown: "Saved **words** ![secret](https://attacker.example/pixel)",
  coordinates: create(CoordinatesSchema, { latitude: 38.7, longitude: -9.1 }),
  revision: 4, whenCreated: create(TimestampSchema, { seconds: 1n }),
});

const view: WorkspaceView = {
  places: [place], selected: place, mode: "view", search: "", saving: false, feedback: null,
  draft: { name: "Lisbon", latitude: 38.7, longitude: -9.1, markdown: place.markdown },
};

afterEach(cleanup);

it("shows one private place in the list and saved detail without loading its image", () => {
  render(<><SavedPlacesList view={view} onSearch={vi.fn()} onSelect={vi.fn()} onAdd={vi.fn()} />
    <PlaceDetails place={place} onEdit={vi.fn()} onAdd={vi.fn()} /></>);
  expect(screen.getByRole("button", { name: /Lisbon/ })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Lisbon" })).toBeTruthy();
  expect(document.querySelector("img")).toBeNull();
  expect(document.body.textContent).toContain("Image omitted: secret");
});

it("keeps one Markdown editor and shows the newer saved value before deliberate reapply", () => {
  const editing = { ...view, mode: "note" as const, feedback: "Place changed since last edit.",
    draft: { ...view.draft, markdown: "My unsaved ![draft](https://attacker.example/draft)" } };
  render(<PlaceEditor view={editing} onChange={vi.fn()} onSave={vi.fn()} onCancel={vi.fn()} onReapply={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Reapply/ })).toBeTruthy();
  expect(document.body.textContent).toContain("Current saved note");
  expect(document.querySelector("img")).toBeNull();
});

it("offers a first-place action and lets a local search be cleared", () => {
  const add = vi.fn();
  const search = vi.fn();
  const empty = { ...view, places: [], selected: null };
  const result = render(<><SavedPlacesList view={empty} onSearch={search} onSelect={vi.fn()} onAdd={add} />
    <PlaceDetails place={null} onEdit={vi.fn()} onAdd={add} /></>);
  expect(screen.getByText(/No places yet/)).toBeTruthy();
  const detailAdd = screen.getAllByRole("button", { name: "Add a place" })[1];
  if (detailAdd === undefined) throw new Error("Detail first-place action is missing.");
  fireEvent.click(detailAdd);
  expect(add).toHaveBeenCalledOnce();
  result.rerender(<SavedPlacesList view={{ ...view, search: "not here" }} onSearch={search}
    onSelect={vi.fn()} onAdd={add} />);
  expect(screen.getByText(/No saved places match/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(search).toHaveBeenCalledWith("");
});

it("keeps numeric move inputs and a distinct delete confirmation accessible", () => {
  const change = vi.fn();
  const save = vi.fn();
  const result = render(<PlaceEditor view={{ ...view, mode: "move" }} onChange={change}
    onSave={save} onCancel={vi.fn()} onReapply={vi.fn()} />);
  fireEvent.change(screen.getByRole("spinbutton", { name: "Latitude" }), { target: { value: "40.5" } });
  expect(change).toHaveBeenCalledWith({ latitude: 40.5 });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(save).toHaveBeenCalledOnce();
  result.rerender(<PlaceEditor view={{ ...view, mode: "delete", saving: true }} onChange={change}
    onSave={save} onCancel={vi.fn()} onReapply={vi.fn()} />);
  expect(screen.getByText(/cannot be undone/i)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Saving…" }).hasAttribute("disabled")).toBe(true);
});

it("preserves empty Add and Move coordinates, while allowing deliberate zero", () => {
  for (const mode of ["add", "move"] as const) for (const field of ["latitude", "longitude"] as const) {
    const change = vi.fn();
    const save = vi.fn();
    const editing = { ...view, mode };
    const controls = { onChange: change, onSave: save, onCancel: vi.fn(), onReapply: vi.fn() };
    const result = render(<PlaceEditor view={editing} {...controls} />);
    fireEvent.change(screen.getByRole("spinbutton", { name: field === "latitude" ? "Latitude" : "Longitude" }),
      { target: { value: "" } });
    expect(change).toHaveBeenCalledWith({ [field]: "" });
    result.rerender(<PlaceEditor view={{ ...editing, draft: { ...view.draft, [field]: "" } }} {...controls} />);
    const input = screen.getByRole("spinbutton", { name: field === "latitude" ? "Latitude" : "Longitude" });
    expect(input).toHaveProperty("value", "");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "0" } });
    expect(change).toHaveBeenCalledWith({ [field]: 0 });
    result.rerender(<PlaceEditor view={{ ...editing, draft: { ...view.draft, [field]: 0 } }} {...controls} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledOnce();
    result.unmount();
  }
});

it("shows an empty saved note and its committed update date without opening an editor", () => {
  const edit = vi.fn();
  const placeWithoutNote = create(PlaceViewSchema, { ...place, markdown: "",
    whenUpdated: create(TimestampSchema, { seconds: 1_700_000_000n }) });
  render(<PlaceDetails place={placeWithoutNote} onEdit={edit} onAdd={vi.fn()} />);
  expect(screen.getByText(/No note yet/)).toBeTruthy();
  expect(screen.getByText(/Updated/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Move pin" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete place" }));
  expect(edit).toHaveBeenNthCalledWith(1, "move");
  expect(edit).toHaveBeenNthCalledWith(2, "delete");
});
