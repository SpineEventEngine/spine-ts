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
import { PlaceViewSchema } from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/entities_pb.js";
import {
  PlaceIdSchema,
  CoordinatesSchema,
} from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/types_pb.js";
import { UserIdSchema } from "@spine-event-engine/proto";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PlaceMap } from "../src/place-map";

const map = vi.hoisted(() => ({
  fail: false,
  mapRemoved: vi.fn(),
  markerRemoved: vi.fn(),
  workerUrl: vi.fn(),
  mapCreated: vi.fn(),
  listeners: new Map<string, (event?: { lngLat: { lat: number; lng: number } }) => void>(),
}));
vi.mock("maplibre-gl", () => ({
  setWorkerUrl: map.workerUrl,
  Map: class {
    readonly container: HTMLElement;
    constructor(options: { container: HTMLElement }) {
      map.mapCreated();
      if (map.fail) throw new Error("WebGL2 unavailable");
      this.container = options.container;
    }
    on(event: string, listener: (event?: { lngLat: { lat: number; lng: number } }) => void): void {
      map.listeners.set(event, listener);
    }
    getCenter(): { lat: number; lng: number } {
      return { lat: 38.7, lng: -9.1 };
    }
    remove(): void {
      map.mapRemoved();
    }
  },
  Marker: class {
    constructor(private readonly options: { element: HTMLElement }) {}
    setLngLat(): this {
      return this;
    }
    addTo(target: { container: HTMLElement }): this {
      target.container.append(this.options.element);
      return this;
    }
    remove(): void {
      this.options.element.remove();
      map.markerRemoved();
    }
  },
}));

const place = create(PlaceViewSchema, {
  id: create(PlaceIdSchema, { value: "lisbon" }),
  author: create(UserIdSchema, { value: "author" }),
  name: "Lisbon",
  coordinates: create(CoordinatesSchema, { latitude: 38.7, longitude: -9.1 }),
  placeKey: new TextEncoder().encode("lisbon"),
  revision: 1,
});

it("labels every map marker, selects its typed ID and disposes WebGL resources", async () => {
  map.fail = false;
  const select = vi.fn();
  const missingCoordinates = create(PlaceViewSchema, {
    ...place,
    id: create(PlaceIdSchema, { value: "missing-coordinates" }),
    coordinates: undefined,
  });
  const missingId = create(PlaceViewSchema, { ...place, id: undefined });
  const result = render(
    <PlaceMap
      places={[place, missingCoordinates, missingId]}
      selectedId="lisbon"
      onSelect={select}
      onPick={vi.fn()}
      onCenter={vi.fn()}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Select Lisbon" }));
  expect(screen.getAllByRole("button", { name: /Select/ })).toHaveLength(1);
  expect(select).toHaveBeenCalledWith("lisbon");
  expect(map.workerUrl).toHaveBeenCalledWith(
    expect.stringMatching(/maplibre-gl\/dist\/maplibre-gl-worker\.mjs$/),
  );
  const workerCall = map.workerUrl.mock.invocationCallOrder.at(-1);
  const constructorCall = map.mapCreated.mock.invocationCallOrder.at(-1);
  if (workerCall === undefined || constructorCall === undefined)
    throw new Error("Map worker configuration or construction was not observed.");
  expect(workerCall).toBeLessThan(constructorCall);
  result.unmount();
  expect(map.markerRemoved).toHaveBeenCalled();
  expect(map.mapRemoved).toHaveBeenCalled();
});

it("keeps coordinate entry and the list available when WebGL cannot start", async () => {
  map.fail = true;
  render(
    <PlaceMap
      places={[]}
      selectedId={null}
      onSelect={vi.fn()}
      onPick={vi.fn()}
      onCenter={vi.fn()}
    />,
  );
  await waitFor(() => {
    expect(screen.getByRole("status").textContent).toContain("Map unavailable");
  });
  expect(screen.getByRole("region", { name: "Saved places map" })).toBeTruthy();
});

it("uses map clicks and center movement only as presentation draft input", async () => {
  map.fail = false;
  map.listeners.clear();
  const pick = vi.fn();
  const center = vi.fn();
  const result = render(
    <PlaceMap
      places={[place]}
      selectedId={null}
      onSelect={vi.fn()}
      onPick={pick}
      onCenter={center}
    />,
  );
  await waitFor(() => {
    expect(map.listeners.has("click")).toBe(true);
  });
  expect(await screen.findByRole("button", { name: "Select Lisbon" })).toHaveProperty(
    "className",
    "map-pin",
  );
  map.listeners.get("load")?.();
  expect(result.container.querySelector(".map-canvas")?.getAttribute("data-map-loaded")).toBe(
    "true",
  );
  map.listeners.get("click")?.({ lngLat: { lat: 40.1, lng: -8.2 } });
  map.listeners.get("moveend")?.();
  expect(pick).toHaveBeenCalledWith({ latitude: 40.1, longitude: -8.2 });
  expect(center).toHaveBeenCalledWith({ latitude: 38.7, longitude: -9.1 });
  result.unmount();
});

it("disposes a map whose asynchronous load finishes after the workspace closes", async () => {
  map.fail = false;
  map.mapRemoved.mockClear();
  const result = render(
    <PlaceMap
      places={[place]}
      selectedId={null}
      onSelect={vi.fn()}
      onPick={vi.fn()}
      onCenter={vi.fn()}
    />,
  );
  result.unmount();
  await waitFor(() => {
    expect(map.mapRemoved).toHaveBeenCalledOnce();
  });
});

it("ignores a map startup failure after unmount and starts a later map", async () => {
  map.fail = true;
  map.mapCreated.mockClear();
  const closed = render(
    <PlaceMap
      places={[place]}
      selectedId={null}
      onSelect={vi.fn()}
      onPick={vi.fn()}
      onCenter={vi.fn()}
    />,
  );
  closed.unmount();
  await waitFor(() => {
    expect(map.mapCreated).toHaveBeenCalledOnce();
  });
  map.fail = false;
  const reopened = render(
    <PlaceMap
      places={[place]}
      selectedId={null}
      onSelect={vi.fn()}
      onPick={vi.fn()}
      onCenter={vi.fn()}
    />,
  );
  await waitFor(() => {
    expect(reopened.container.querySelector('.map-pin[aria-label="Select Lisbon"]')).not.toBeNull();
  });
  expect(reopened.container.querySelector(".map-fallback")).toBeNull();
  reopened.unmount();
});
