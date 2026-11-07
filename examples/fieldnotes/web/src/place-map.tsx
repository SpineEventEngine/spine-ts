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

"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import type { PlaceView } from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/entities_pb.js";

/**
 * One selected presentation point, independent of saved Place data.
 */
export interface MapPoint {
  /**
   * Latitude in decimal degrees.
   */
  readonly latitude: number;

  /**
   * Longitude in decimal degrees.
   */
  readonly longitude: number;
}

/**
 * Manages MapLibre 6 resources outside React reconciliation.
 */
class FieldnotesMapRuntime {
  readonly #markers: MapLibreMarker[] = [];

  /**
   * Stores one WebGL map and the marker constructor from the same ESM module.
   *
   * @param map Live MapLibre map.
   * @param Marker Marker constructor from the loaded module.
   */
  constructor(
    private readonly map: MapLibreMap,
    private readonly Marker: typeof MapLibreMarker,
  ) {}

  /**
   * Opens the official OpenFreeMap style with normal visible attribution.
   *
   * @param container Mounted map element.
   * @param onPick Map-click coordinate selection.
   * @param onCenter Current presentation center update.
   * @returns Live map runtime.
   */
  static async open(container: HTMLElement, onPick: (point: MapPoint) => void,
                    onCenter: (point: MapPoint) => void): Promise<FieldnotesMapRuntime> {
    const maplibre = await import("maplibre-gl");
    maplibre.setWorkerUrl(new URL("/maplibre-gl-worker.mjs", window.location.origin).href);
    const map = new maplibre.Map({ container,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [-9.14, 38.72], zoom: 11,
      attributionControl: { compact: false },
    });
    map.on("load", () => { container.dataset.mapLoaded = "true"; });
    map.on("click", (event) => { onPick({ latitude: event.lngLat.lat, longitude: event.lngLat.lng }); });
    map.on("moveend", () => {
      const center = map.getCenter();
      onCenter({ latitude: center.lat, longitude: center.lng });
    });
    return new FieldnotesMapRuntime(map, maplibre.Marker);
  }

  /**
   * Renders every saved PlaceId as a separately labeled selectable marker.
   *
   * @param places Active complete private collection.
   * @param selectedId Current selected PlaceId.
   * @param onSelect Selects a marker's typed ID.
   */
  markers(places: readonly PlaceView[], selectedId: string | null,
          onSelect: (id: string) => void): void {
    for (const marker of this.#markers.splice(0)) marker.remove();
    for (const place of places) {
      const id = place.id?.value;
      const coordinates = place.coordinates;
      if (!id || coordinates === undefined) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = id === selectedId ? "map-pin selected" : "map-pin";
      button.setAttribute("aria-label", `Select ${place.name}`);
      button.addEventListener("click", (event) => { event.stopPropagation(); onSelect(id); });
      this.#markers.push(new this.Marker({ element: button })
        .setLngLat([coordinates.longitude, coordinates.latitude]).addTo(this.map));
    }
  }

  /**
   * Closes marker DOM and WebGL resources on principal departure.
   */
  close(): void {
    for (const marker of this.#markers.splice(0)) marker.remove();
    this.map.remove();
  }
}

/**
 * Renders a map while preserving a coordinate-input alternative when WebGL fails.
 *
 * @param props Visible places, selection and coordinate callbacks.
 * @returns Map with attribution or an accessible fallback.
 */
export function PlaceMap(props: {
  readonly places: readonly PlaceView[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly onPick: (point: MapPoint) => void;
  readonly onCenter: (point: MapPoint) => void;
}): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  const runtime = useRef<FieldnotesMapRuntime | null>(null);
  const callbacks = useRef(props);
  const [available, setAvailable] = useState(true); callbacks.current = props;
  useEffect(() => {
    const element = container.current;
    if (element === null) return;
    let active = true;
    void FieldnotesMapRuntime.open(element,
      (point) => { callbacks.current.onPick(point); },
      (point) => { callbacks.current.onCenter(point); }).then((opened) => {
      if (!active) { opened.close(); return; }
      runtime.current = opened;
      opened.markers(callbacks.current.places, callbacks.current.selectedId,
        (id) => { callbacks.current.onSelect(id); });
    }).catch(() => { if (active) setAvailable(false); });
    return () => { active = false; runtime.current?.close(); runtime.current = null; };
  }, []);
  useEffect(() => {
    runtime.current?.markers(props.places, props.selectedId, props.onSelect);
  }, [props.places, props.selectedId, props.onSelect]);
  return <section className="map-panel" aria-label="Saved places map">
    <div ref={container} className="map-canvas" aria-hidden={!available} />
    {!available && <div className="map-fallback" role="status">
      Map unavailable. Saved places remain selectable in the list; use coordinate fields to place or move a pin.
    </div>}
  </section>;
}
