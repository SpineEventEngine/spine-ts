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

import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { PlaceViewSchema } from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/entities_pb.js";
import {
  PlaceIdSchema,
  CoordinatesSchema,
} from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/types_pb.js";
import { UserIdSchema } from "@spine-event-engine/proto";
import { expect, it, vi } from "vitest";
import { FieldnotesWorkspaceState, type PlaceConnection } from "../src/workspace-state";

const initial = create(PlaceViewSchema, {
  id: create(PlaceIdSchema, { value: "same" }),
  author: create(UserIdSchema, { value: "author" }),
  name: "Name",
  markdown: "saved note",
  coordinates: create(CoordinatesSchema, { latitude: 38.7, longitude: -9.1 }),
  whenCreated: create(TimestampSchema, { seconds: 1n }),
  revision: 2,
});

it("keeps a dirty single-note draft after a domain conflict and exposes saved text", async () => {
  const note = vi.fn(() => Promise.resolve({ kind: "conflict" as const, currentRevision: 3 }));
  const observed = [] as ReturnType<FieldnotesWorkspaceState["view"]>[];
  const connection: PlaceConnection = {
    start: () => Promise.resolve(),
    close: () => Promise.resolve(),
    places: () => [initial],
    commands: () => ({ note, add: vi.fn(), rename: vi.fn(), move: vi.fn(), delete: vi.fn() }),
  };
  const state = new FieldnotesWorkspaceState(connection, (view) => observed.push(view));
  state.select("same");
  state.edit("note");
  state.changeDraft({ markdown: "my unsaved words" });
  await state.save();
  expect(note).toHaveBeenCalledWith("same", "my unsaved words", 2);
  expect(state.view().mode).toBe("note");
  expect(state.view().draft.markdown).toBe("my unsaved words");
  expect(state.view().selected?.markdown).toBe("saved note");
  expect(state.view().feedback).toMatch(/changed since last edit/i);
  expect(observed.length).toBeGreaterThan(2);
});

it("clears a draft only after a committed projected result and blocks duplicate saves", async () => {
  let finish!: (value: { kind: "committed"; id: string; revision: number }) => void;
  const pending = new Promise<{ kind: "committed"; id: string; revision: number }>((resolve) => {
    finish = resolve;
  });
  const rename = vi.fn(() => pending);
  const connection: PlaceConnection = {
    start: () => Promise.resolve(),
    close: () => Promise.resolve(),
    places: () => [initial],
    commands: () => ({ note: vi.fn(), add: vi.fn(), rename, move: vi.fn(), delete: vi.fn() }),
  };
  const state = new FieldnotesWorkspaceState(connection, () => undefined);
  state.select("same");
  state.edit("rename");
  state.changeDraft({ name: "New name" });
  const saving = state.save();
  await state.save();
  expect(rename).toHaveBeenCalledTimes(1);
  expect(state.view().draft.name).toBe("New name");
  finish({ kind: "committed", id: "same", revision: 3 });
  await saving;
  expect(state.view().mode).toBe("view");
  expect(state.view().feedback).toMatch(/saved/i);
});

it("submits the captured edit revision after a live update until the author deliberately reapplies", async () => {
  const note = vi
    .fn()
    .mockResolvedValueOnce({ kind: "conflict", currentRevision: 3 })
    .mockResolvedValueOnce({ kind: "committed", id: "same", revision: 4 });
  let current = [initial];
  const connection: PlaceConnection = {
    start: () => Promise.resolve(),
    close: () => Promise.resolve(),
    places: () => current,
    commands: () => ({ note, add: vi.fn(), rename: vi.fn(), move: vi.fn(), delete: vi.fn() }),
  };
  const state = new FieldnotesWorkspaceState(connection, () => undefined);
  state.select("same");
  state.edit("note");
  state.changeDraft({ markdown: "my unsaved words" });
  current = [create(PlaceViewSchema, { ...initial, revision: 3, markdown: "remote words" })];
  state.refresh();
  await state.save();
  expect(note).toHaveBeenCalledWith("same", "my unsaved words", 2);
  expect(state.view().draft.markdown).toBe("my unsaved words");
  expect(state.view().selected?.markdown).toBe("remote words");
  state.reapply();
  await state.save();
  expect(note).toHaveBeenLastCalledWith("same", "my unsaved words", 3);
});

it("hides private places immediately and ignores a late committed result after close", async () => {
  let finish!: (value: { kind: "committed"; id: string; revision: number }) => void;
  const pending = new Promise<{ kind: "committed"; id: string; revision: number }>((resolve) => {
    finish = resolve;
  });
  const close = vi.fn(() => Promise.resolve());
  const views = [] as ReturnType<FieldnotesWorkspaceState["view"]>[];
  const connection: PlaceConnection = {
    start: () => Promise.resolve(),
    close,
    places: () => [initial],
    commands: () => ({
      note: () => pending,
      add: vi.fn(),
      rename: vi.fn(),
      move: vi.fn(),
      delete: vi.fn(),
    }),
  };
  const state = new FieldnotesWorkspaceState(connection, (view) => views.push(view));
  await state.start();
  state.select("same");
  state.edit("note");
  state.changeDraft({ markdown: "private draft" });
  const saving = state.save();
  await state.close();
  expect(state.view().places).toEqual([]);
  expect(state.view().selected).toBeNull();
  finish({ kind: "committed", id: "same", revision: 3 });
  await saving;
  expect(views.at(-1)?.places).toEqual([]);
  expect(views.at(-1)?.mode).toBe("view");
  expect(close).toHaveBeenCalledOnce();
});

it("preserves an invalid move draft and explains the domain refusal", async () => {
  const move = vi.fn().mockResolvedValue({ kind: "invalid-coordinates" });
  const connection: PlaceConnection = {
    start: () => Promise.resolve(),
    close: () => Promise.resolve(),
    places: () => [initial],
    commands: () => ({ move, add: vi.fn(), rename: vi.fn(), note: vi.fn(), delete: vi.fn() }),
  };
  const state = new FieldnotesWorkspaceState(connection, () => undefined);
  await state.start();
  state.select("same");
  state.edit("move");
  state.changeDraft({ latitude: 91 });
  await state.save();
  expect(move).not.toHaveBeenCalled();
  expect(state.view().mode).toBe("move");
  expect(state.view().draft.latitude).toBe(91);
  expect(state.view().feedback).toBe("Choose valid latitude and longitude.");
  state.changeDraft({ latitude: 38.7 });
  await state.save();
  expect(move).toHaveBeenCalledWith("same", 38.7, -9.1, 2);
  expect(state.view().feedback).toBe("Choose valid latitude and longitude.");
});

it("keeps AddPlace and RenamePlace drafts after their distinct domain refusals", async () => {
  const add = vi.fn().mockResolvedValue({ kind: "already-exists" });
  const rename = vi.fn().mockResolvedValue({ kind: "unavailable" });
  const connection: PlaceConnection = {
    start: () => Promise.resolve(),
    close: () => Promise.resolve(),
    places: () => [initial],
    commands: () => ({ add, rename, move: vi.fn(), note: vi.fn(), delete: vi.fn() }),
  };
  const state = new FieldnotesWorkspaceState(connection, () => undefined);
  await state.start();
  state.add(40, -8);
  state.changeDraft({ name: "Draft place", markdown: "one note" });
  await state.save();
  expect(add).toHaveBeenCalledWith("Draft place", 40, -8, "one note");
  expect(state.view().mode).toBe("add");
  expect(state.view().feedback).toBe("This place already exists.");
  state.cancel();
  state.select("same");
  state.edit("rename");
  state.changeDraft({ name: "Draft name" });
  await state.save();
  expect(rename).toHaveBeenCalledWith("same", "Draft name", 2);
  expect(state.view().draft.name).toBe("Draft name");
  expect(state.view().feedback).toBe("This place is unavailable.");
});

it("keeps a delete confirmation draft after an interrupted native attempt", async () => {
  const remove = vi.fn(() => Promise.reject(new Error("private transport closed")));
  const connection: PlaceConnection = {
    start: () => Promise.resolve(),
    close: () => Promise.resolve(),
    places: () => [initial],
    commands: () => ({
      delete: remove,
      add: vi.fn(),
      rename: vi.fn(),
      move: vi.fn(),
      note: vi.fn(),
    }),
  };
  const state = new FieldnotesWorkspaceState(connection, () => undefined);
  await state.start();
  state.select("same");
  state.edit("delete");
  await state.save();
  expect(remove).toHaveBeenCalledWith("same", 2);
  expect(state.view().mode).toBe("delete");
  expect(state.view().feedback).toMatch(/confirmation was interrupted/i);
});

it("clears selection only after a confirmed terminal DeletePlace result", async () => {
  const remove = vi.fn().mockResolvedValue({ kind: "committed", id: "same", revision: 3 });
  const connection: PlaceConnection = {
    start: () => Promise.resolve(),
    close: () => Promise.resolve(),
    places: () => [initial],
    commands: () => ({
      delete: remove,
      add: vi.fn(),
      rename: vi.fn(),
      move: vi.fn(),
      note: vi.fn(),
    }),
  };
  const state = new FieldnotesWorkspaceState(connection, () => undefined);
  await state.start();
  state.select("same");
  state.edit("delete");
  expect(state.view().selected?.id?.value).toBe("same");
  await state.save();
  expect(remove).toHaveBeenCalledWith("same", 2);
  expect(state.view().selected).toBeNull();
  expect(state.view().mode).toBe("view");
  expect(state.view().feedback).toBe("Saved.");
});

it("does not change selection or draft while a projected save is pending", async () => {
  let finish!: (value: { kind: "committed"; id: string; revision: number }) => void;
  const pending = new Promise<{ kind: "committed"; id: string; revision: number }>((resolve) => {
    finish = resolve;
  });
  const note = vi.fn(() => pending);
  const connection: PlaceConnection = {
    start: () => Promise.resolve(),
    close: () => Promise.resolve(),
    places: () => [initial],
    commands: () => ({ note, add: vi.fn(), rename: vi.fn(), move: vi.fn(), delete: vi.fn() }),
  };
  const state = new FieldnotesWorkspaceState(connection, () => undefined);
  await state.start();
  state.select("same");
  state.edit("note");
  state.changeDraft({ markdown: "submitted draft" });
  const saving = state.save();
  state.select("different");
  state.changeDraft({ markdown: "late edit" });
  state.cancel();
  state.reapply();
  await state.save();
  expect(note).toHaveBeenCalledOnce();
  expect(state.view().selected?.id?.value).toBe("same");
  expect(state.view().draft.markdown).toBe("submitted draft");
  expect(state.view().mode).toBe("note");
  finish({ kind: "committed", id: "same", revision: 3 });
  await saving;
});

it("does not revive a vanished selection or private data after close", async () => {
  let current = [initial];
  const views = [] as ReturnType<FieldnotesWorkspaceState["view"]>[];
  const connection: PlaceConnection = {
    start: () => Promise.resolve(),
    close: () => Promise.resolve(),
    places: () => current,
    commands: () => ({
      add: vi.fn(),
      rename: vi.fn(),
      move: vi.fn(),
      note: vi.fn(),
      delete: vi.fn(),
    }),
  };
  const state = new FieldnotesWorkspaceState(connection, (view) => views.push(view));
  state.edit("note");
  expect(state.view().mode).toBe("view");
  await state.start();
  state.select("same");
  state.edit("note");
  current = [];
  state.refresh();
  state.reapply();
  expect(state.view().selected).toBeNull();
  expect(state.view().mode).toBe("note");
  await state.close();
  const emitted = views.length;
  current = [initial];
  state.refresh();
  expect(views).toHaveLength(emitted);
  expect(state.view().places).toEqual([]);
});

it("keeps a draft after an interrupted outcome and ignores late failed work after close", async () => {
  let reject!: (error: Error) => void;
  const pending = new Promise<never>((_resolve, onReject) => {
    reject = onReject;
  });
  const note = vi
    .fn()
    .mockResolvedValueOnce({ kind: "interrupted" })
    .mockImplementationOnce(() => pending);
  const connection: PlaceConnection = {
    start: () => Promise.resolve(),
    close: () => Promise.resolve(),
    places: () => [initial],
    commands: () => ({ note, add: vi.fn(), rename: vi.fn(), move: vi.fn(), delete: vi.fn() }),
  };
  const state = new FieldnotesWorkspaceState(connection, () => undefined);
  await state.start();
  state.select("same");
  state.edit("note");
  state.changeDraft({ markdown: "unsaved private note" });
  await state.save();
  expect(state.view().feedback).toMatch(/Confirmation was interrupted/);
  const saving = state.save();
  await state.close();
  reject(new Error("late private socket failure"));
  await saving;
  expect(state.view().places).toEqual([]);
  expect(state.view().mode).toBe("view");
});

it("blocks incomplete Add and Move drafts but accepts explicit zero coordinates", async () => {
  const add = vi.fn().mockResolvedValue({ kind: "refused" });
  const move = vi.fn().mockResolvedValue({ kind: "refused" });
  const connection: PlaceConnection = {
    start: () => Promise.resolve(),
    close: () => Promise.resolve(),
    places: () => [initial],
    commands: () => ({ add, move, rename: vi.fn(), note: vi.fn(), delete: vi.fn() }),
  };
  const state = new FieldnotesWorkspaceState(connection, () => undefined);
  await state.start();
  state.add();
  state.changeDraft({ name: "At zero", latitude: "" });
  await state.save();
  expect(add).not.toHaveBeenCalled();
  expect(state.view().draft.latitude).toBe("");
  expect(state.view().feedback).toMatch(/valid latitude and longitude/);
  state.changeDraft({ latitude: Number.POSITIVE_INFINITY });
  await state.save();
  expect(add).not.toHaveBeenCalled();
  state.changeDraft({ latitude: 0, longitude: 181 });
  await state.save();
  expect(add).not.toHaveBeenCalled();
  state.changeDraft({ latitude: 0, longitude: 0 });
  await state.save();
  expect(add).toHaveBeenCalledWith("At zero", 0, 0, "");
  state.cancel();
  state.select("same");
  state.edit("move");
  state.changeDraft({ longitude: "" });
  await state.save();
  expect(move).not.toHaveBeenCalled();
  state.changeDraft({ longitude: Number.NaN });
  await state.save();
  expect(move).not.toHaveBeenCalled();
  state.changeDraft({ latitude: 0, longitude: 0 });
  await state.save();
  expect(move).toHaveBeenCalledWith("same", 0, 0, 2);
});
