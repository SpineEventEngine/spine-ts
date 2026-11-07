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
import { QUERY_SERVICE_MAX_RESULTS } from "@spine-event-engine/core";
import { PlaceViewSchema, type PlaceView } from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/entities_pb.js";
import { CoordinatesSchema, PlaceIdSchema } from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/types_pb.js";
import { UserIdSchema } from "@spine-event-engine/proto/generated/spine/core/user_id_pb.js";
import { expect, it } from "vitest";
import { FieldnotesPlaceCollection } from "../src/place-collection";

const encoder = new TextEncoder();

function place(id: string, revision = 1, removed = false): PlaceView {
  return create(PlaceViewSchema, {
    id: create(PlaceIdSchema, { value: id }),
    author: create(UserIdSchema, { value: "author" }),
    name: removed ? "" : id,
    coordinates: removed ? undefined : create(CoordinatesSchema, { latitude: 38.7, longitude: -9.1 }),
    placeKey: removed ? new Uint8Array() : encoder.encode(id),
    revision,
    removed,
  });
}

it("traverses every byte-key page and detaches each continuation cursor", async () => {
  const first = Array.from({ length: QUERY_SERVICE_MAX_RESULTS }, (_, i) => place(`a-${String(i).padStart(5,"0")}`));
  const second = [place("á-place"), place("東京-place")];
  const pages = [first, second, []];
  const cursors: (Uint8Array | undefined)[] = [];
  const collection = new FieldnotesPlaceCollection("author", async (cursor) => {
    await Promise.resolve();
    cursors.push(cursor);
    return pages.shift() ?? [];
  }, () => undefined);
  await collection.scan();
  expect(collection.places()).toHaveLength(QUERY_SERVICE_MAX_RESULTS + 2);
  expect(cursors).toHaveLength(3);
  expect(cursors[0]).toBeUndefined();
  expect(cursors[1]).toEqual(first.at(-1)?.placeKey);
  expect(cursors[1]).not.toBe(first.at(-1)?.placeKey);
  expect(cursors[2]).toEqual(second.at(-1)?.placeKey);
});

it("keeps a live insertion before the cursor and a terminal deletion across a full scan", async () => {
  let next!: (value: PlaceView[]) => void;
  const pending = new Promise<PlaceView[]>((resolve) => { next = resolve; });
  let calls = 0;
  const collection = new FieldnotesPlaceCollection("author", async () => {
    await Promise.resolve();
    calls++;
    return calls === 1 ? [place("later")] : calls === 2 ? pending : [];
  }, () => undefined);
  const scanning = collection.scan();
  await Promise.resolve();
  collection.receive(place("earlier", 2));
  collection.receive(place("later", 3, true));
  next([]);
  await scanning;
  expect(collection.places().map((view) => view.id?.value)).toEqual(["earlier"]);
  collection.receive(place("later", 2));
  expect(collection.places().map((view) => view.id?.value)).toEqual(["earlier"]);
});

it("preserves prior visible data when a later page fails and rejects mismatched byte keys", async () => {
  let fail = false;
  const collection = new FieldnotesPlaceCollection("author", async (cursor) => {
    await Promise.resolve();
    if (fail && cursor !== undefined) throw new Error("page failed");
    return cursor === undefined ? [place("initial")] : [];
  }, () => undefined);
  await collection.scan();
  fail = true;
  await expect(collection.scan()).rejects.toThrow("page failed");
  expect(collection.places().map((view) => view.id?.value)).toEqual(["initial"]);
  const invalid = place("bad");
  invalid.placeKey = encoder.encode("other");
  expect(() => { collection.receive(invalid); }).toThrow("Place key");
});

it("rejects a stale removal and a foreign principal without exposing either record", () => {
  const collection = new FieldnotesPlaceCollection("author", () => Promise.resolve([]), () => undefined);
  collection.receive(place("kept", 4));
  collection.receive(place("kept", 2));
  expect(collection.places()[0]?.revision).toBe(4);
  collection.receive(place("kept", 3, true));
  expect(collection.places().map((view) => view.id?.value)).toEqual(["kept"]);
  const foreign = place("foreign");
  foreign.author = create(UserIdSchema, { value: "someone-else" });
  expect(() => { collection.receive(foreign); }).toThrow("invalid author");
  expect(() => { collection.receive(place("")); }).toThrow("invalid author");
  expect(() => { collection.receive(place("invalid-revision", 0)); }).toThrow("invalid author");
  expect(collection.places().map((view) => view.id?.value)).toEqual(["kept"]);
});

it("waits for the resulting view revision and cancels outstanding waits on close", async () => {
  const collection = new FieldnotesPlaceCollection("author", () => Promise.resolve([]), () => undefined);
  let completed = false;
  const waiting = collection.waitFor("draft", 3, false).then(() => { completed = true; });
  collection.receive(place("draft", 2));
  await Promise.resolve();
  expect(completed).toBe(false);
  collection.receive(place("draft", 3));
  await waiting;
  expect(completed).toBe(true);
  const deleted = collection.waitFor("draft", 4, true);
  collection.remove("draft");
  await expect(deleted).resolves.toBeUndefined();
  const abandoned = collection.waitFor("another", 1, false);
  collection.close();
  await expect(abandoned).rejects.toThrow("closed");
  collection.receive(place("late", 1));
  expect(collection.places()).toEqual([]);
});

it("rejects malformed page boundaries before replacing a complete collection", async () => {
  const foreign = place("foreign");
  foreign.author = create(UserIdSchema, { value: "other" });
  const cases: [readonly PlaceView[], string][] = [
    [[place("a"), place("a")], "did not advance"],
    [[place("z"), place("a")], "did not advance"],
    [[place("removed", 2, true)], "removed state"],
    [[foreign], "invalid author"],
    [Array.from({ length: QUERY_SERVICE_MAX_RESULTS + 1 }, (_, i) => place(`p-${String(i)}`)), "exceeds capacity"],
  ];
  for (const [page, reason] of cases) {
    const collection = new FieldnotesPlaceCollection("author", () => Promise.resolve(page), () => undefined);
    await expect(collection.scan()).rejects.toThrow(reason);
    expect(collection.places()).toEqual([]);
    collection.close();
  }
});

it("cancels a pending observation without accepting a later matching state", async () => {
  const collection = new FieldnotesPlaceCollection("author", () => Promise.resolve([]), () => undefined);
  expect(() => { collection.remove(""); }).toThrow("no typed ID");
  collection.receive(place("already-removed", 1, true));
  await expect(collection.waitFor("already-removed", 1, true)).resolves.toBeUndefined();
  const abort = new AbortController();
  const waiting = collection.waitFor("pending", 2, false, abort.signal);
  abort.abort();
  await expect(waiting).rejects.toThrow("cancelled");
  collection.receive(place("pending", 2));
  await expect(collection.waitFor("pending", 2, false)).resolves.toBeUndefined();
  await expect(collection.waitFor("pending", 3, false, abort.signal)).rejects.toThrow("cancelled");
  collection.close();
  await expect(collection.scan()).rejects.toThrow("closed");
  await expect(collection.waitFor("pending", 3, false)).rejects.toThrow("closed");
});

it("retains a newer live revision across an older rescan page but honors authoritative absence", async () => {
  let round = 0;
  const collection = new FieldnotesPlaceCollection("author", (cursor) => {
    if (cursor !== undefined) return Promise.resolve([]);
    round++;
    return Promise.resolve(round === 1 ? [place("absent", 1), place("kept", 1)] : [place("kept", 2)]);
  }, () => undefined);
  await collection.scan();
  collection.receive(place("kept", 3));
  await collection.scan();
  expect(collection.places().map((view) => [view.id?.value, view.revision])).toEqual([["kept", 3]]);
  collection.remove("kept");
  await collection.scan();
  expect(collection.places()).toEqual([]);
  collection.receive(place("kept", 4));
  expect(collection.places()).toEqual([]);
  collection.close();
});
