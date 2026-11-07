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

import { useState } from "react";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "./ui/sheet";
import { SavedPlacesList, PlaceDetails, PlaceEditor } from "./place-panels";
import type { MapPoint } from "./place-map";
import type { FieldnotesWorkspaceState, WorkspaceView } from "./workspace-state";

/**
 * Renders shadcn Sheet navigation while leaving the map visible on small screens.
 *
 * @param props Current view, editor controller and presentation map center.
 * @returns Mobile place-list and detail Sheet controls.
 */
export function MobilePanels(props: {
  readonly view: WorkspaceView;
  readonly controller: FieldnotesWorkspaceState | null;
  readonly center: MapPoint;
}): React.JSX.Element {
  const [panel, setPanel] = useState<"places" | "details" | null>(null);
  const { controller, view, center } = props;
  const add = () => { controller?.add(center.latitude, center.longitude); setPanel("details"); };
  return <div className="mobile-controls">
    <Sheet open={panel !== null} onOpenChange={(open) => { if (!open) setPanel(null); }}>
      <div className="mobile-buttons">
        <SheetTrigger asChild><Button type="button" variant="outline" onClick={() => { setPanel("places"); }}>Places</Button></SheetTrigger>
        <SheetTrigger asChild><Button type="button" variant="outline" onClick={() => { setPanel("details"); }}>Details</Button></SheetTrigger>
      </div>
      <SheetContent>
        <SheetTitle>{panel === "places" ? "Saved places" : view.mode === "view" ? "Place details" : "Edit place"}</SheetTitle>
        <SheetDescription className="sr-only">Review and edit your private saved places.</SheetDescription>
        {panel === "places" && <SavedPlacesList view={view} onSearch={(value) => controller?.search(value)}
          onAdd={add} onSelect={(id) => { controller?.select(id); setPanel("details"); }} />}
        {panel === "details" && (view.mode === "view" ?
          <PlaceDetails place={view.selected} onEdit={(mode) => controller?.edit(mode)} onAdd={add} /> :
          <PlaceEditor view={view} onChange={(values) => controller?.changeDraft(values)}
            onSave={() => void controller?.save()} onCancel={() => controller?.cancel()}
            onReapply={() => controller?.reapply()} />)}
      </SheetContent>
    </Sheet>
  </div>;
}
