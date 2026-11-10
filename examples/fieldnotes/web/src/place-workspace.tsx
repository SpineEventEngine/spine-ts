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
import { PlaceMap, type MapPoint } from "./place-map";
import { SavedPlacesList, PlaceDetails, PlaceEditor } from "./place-panels";
import { FieldnotesNativePlaces } from "./native-places";
import { FieldnotesWorkspaceState, type WorkspaceView } from "./workspace-state";
import { MobilePanels } from "./mobile-panels";

/**
 * Renders one verified principal's complete private place collection.
 *
 * @param props Verified principal and privacy-failure callback.
 * @returns Responsive map, list and selected detail workspace.
 */
export function PlaceWorkspace(props: {
  readonly principalId: string;
  readonly onPrivacyFailure: () => void;
}): React.JSX.Element {
  const controller = useRef<FieldnotesWorkspaceState | null>(null);
  const [view, setView] = useState<WorkspaceView | null>(null);
  const [center, setCenter] = useState<MapPoint>({ latitude: 38.72, longitude: -9.14 });
  const onFailure = useRef(props.onPrivacyFailure); onFailure.current = props.onPrivacyFailure;
  useEffect(() => {
    let active = true;
    const connection = new FieldnotesNativePlaces(props.principalId,
      () => { current.refresh(); }, () => { if (active) onFailure.current(); });
    const current = new FieldnotesWorkspaceState(connection, setView);
    controller.current = current;
    void current.start().catch(() => { if (active) onFailure.current(); });
    return () => { active = false; controller.current = null; void current.close().catch(() => undefined); };
  }, [props.principalId]);
  if (view === null) return <main className="center-panel"><p role="status">Loading your places…</p></main>;
  const active = controller.current;
  const onSelect = (id: string) => active?.select(id);
  const onPick = (point: MapPoint) => { if (view.mode === "add" || view.mode === "move") active?.changeDraft(point); };
  return <main className="workspace">
    <div className="desktop-place-panel"><SavedPlacesList view={view} onSearch={(value) => active?.search(value)} onSelect={onSelect}
      onAdd={() => active?.add(center.latitude, center.longitude)} /></div>
    <PlaceMap places={view.places} selectedId={view.selected?.id?.value ?? null}
      onSelect={onSelect} onPick={onPick} onCenter={setCenter} />
    <div className="desktop-place-panel">{view.mode === "view" ? <PlaceDetails place={view.selected} onEdit={(mode) => active?.edit(mode)}
      onAdd={() => active?.add(center.latitude, center.longitude)} /> :
      <PlaceEditor view={view} onChange={(values) => active?.changeDraft(values)}
        onSave={() => void active?.save()} onCancel={() => active?.cancel()}
        onReapply={() => active?.reapply()} />}</div>
    <MobilePanels view={view} controller={active} center={center} />
  </main>;
}
