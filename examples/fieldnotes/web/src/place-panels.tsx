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

import MDEditor from "@uiw/react-md-editor/nohighlight";
import { MapPin, Plus, Search } from "lucide-react";
import type { PlaceView } from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/entities_pb.js";
import { SafeMarkdown } from "./safe-markdown";
import { safePreviewOptions } from "./safe-markdown-policy";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import type { PlaceDraft, WorkspaceMode, WorkspaceView } from "./workspace-state";

/**
 * Renders a local search over the fully loaded private collection.
 *
 * @param props Current places and list actions.
 * @returns Saved-place navigation panel.
 */
export function SavedPlacesList(props: {
  readonly view: WorkspaceView;
  readonly onSearch: (value: string) => void;
  readonly onSelect: (id: string) => void;
  readonly onAdd: () => void;
}): React.JSX.Element {
  const { view } = props;
  const term = view.search.trim().toLocaleLowerCase();
  const places = view.places.filter((place) =>
    `${place.name} ${place.markdown}`.toLocaleLowerCase().includes(term));
  return <aside className="saved-panel" aria-label="Saved places">
    <div className="panel-heading"><div><p className="eyebrow">Your atlas</p><h2>Saved places</h2></div>
      <Button type="button" size="icon" aria-label="Add a place" onClick={props.onAdd}><Plus size={18} /></Button></div>
    <label className="search-field"><Search size={16} aria-hidden="true" />
      <span className="sr-only">Search saved places</span>
      <Input value={view.search} onChange={(event) => { props.onSearch(event.target.value); }}
        placeholder="Search places or notes" /></label>
    <p className="list-count">{places.length} {places.length === 1 ? "place" : "places"}</p>
    {places.length === 0 && <p className="empty-copy">{term ? "No saved places match this search." :
      "No places yet. Add your first place to begin your atlas."}</p>}
    {term && places.length === 0 && <Button type="button" variant="ghost" onClick={() => { props.onSearch(""); }}>Clear search</Button>}
    <ul className="place-list">{places.map((place) => <li key={place.id?.value}>
      <button type="button" className={place.id?.value === view.selected?.id?.value ? "place-row selected" : "place-row"}
        onClick={() => { props.onSelect(place.id?.value ?? ""); }}
        disabled={view.mode !== "view"}>
        <MapPin size={18} aria-hidden="true" /><span><strong>{place.name}</strong>
          <small>{place.coordinates?.latitude.toFixed(3)}, {place.coordinates?.longitude.toFixed(3)}</small></span>
      </button></li>)}</ul>
  </aside>;
}

/**
 * Renders a selected saved place with one Markdown body and distinct actions.
 *
 * @param props Current committed PlaceView and action callbacks.
 * @returns Read-only detail panel.
 */
export function PlaceDetails(props: {
  readonly place: PlaceView | null;
  readonly onEdit: (mode: Exclude<WorkspaceMode, "view" | "add">) => void;
  readonly onAdd: () => void;
}): React.JSX.Element {
  const place = props.place;
  if (place === null) return <aside className="detail-panel empty-detail">
    <MapPin size={30} aria-hidden="true" /><h2>No place selected</h2>
    <p>Choose a saved place from the list, or add a new pin.</p>
    <Button type="button" onClick={props.onAdd}>Add a place</Button>
  </aside>;
  const updated = place.updatedAt?.seconds === undefined ? null :
    new Date(Number(place.updatedAt.seconds) * 1000).toLocaleDateString();
  return <aside className="detail-panel" aria-label={`${place.name} details`}>
    <p className="eyebrow">Selected place</p><h2>{place.name}</h2>
    <p className="coordinates">{place.coordinates?.latitude.toFixed(5)}, {place.coordinates?.longitude.toFixed(5)}</p>
    {updated && <p className="updated">Updated {updated}</p>}
    <div className="detail-actions"><Button type="button" variant="outline" size="sm" onClick={() => { props.onEdit("rename"); }}>Rename</Button>
      <Button type="button" variant="outline" size="sm" onClick={() => { props.onEdit("move"); }}>Move pin</Button></div>
    <div className="note-heading"><h3>Note</h3><Button type="button" variant="ghost" size="sm" onClick={() => { props.onEdit("note"); }}>Edit note</Button></div>
    {place.markdown ? <SafeMarkdown markdown={place.markdown} /> :
      <p className="empty-copy">No note yet. Add one to remember this place.</p>}
    <Button type="button" variant="ghost" className="delete-link" onClick={() => { props.onEdit("delete"); }}>Delete place</Button>
  </aside>;
}

/**
 * Renders labeled latitude and longitude fields as a keyboard map alternative.
 *
 * @param props Current numeric or incomplete draft and field callback.
 * @returns Coordinate inputs with valid geographic bounds.
 */
export function CoordinateFields(props: {
  readonly draft: PlaceDraft;
  readonly onChange: (value: Partial<PlaceDraft>) => void;
}): React.JSX.Element {
  return <div className="coordinate-fields"><label>Latitude
    <Input type="number" min={-90} max={90} step="any" required value={props.draft.latitude}
      onChange={(event) => { const value = event.target.value;
        props.onChange({ latitude: value === "" ? "" : Number(value) }); }} /></label>
    <label>Longitude
      <Input type="number" min={-180} max={180} step="any" required value={props.draft.longitude}
        onChange={(event) => { const value = event.target.value;
          props.onChange({ longitude: value === "" ? "" : Number(value) }); }} /></label>
  </div>;
}

/**
 * Renders one focused Command form with saved text available on conflict.
 *
 * @param props Dirty draft, committed state and form callbacks.
 * @returns Accessible single-operation editor.
 */
export function PlaceEditor(props: {
  readonly view: WorkspaceView;
  readonly onChange: (value: Partial<PlaceDraft>) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
  readonly onReapply: () => void;
}): React.JSX.Element {
  const { mode, draft, selected, saving, feedback } = props.view;
  const title = { add: "Add a place", rename: "Rename place", move: "Move pin",
    note: "Edit note", delete: "Delete place", view: "Place" }[mode];
  return <aside className="detail-panel edit-panel" aria-label={title}>
    <p className="eyebrow">Your atlas</p><h2>{title}</h2>
    <form onSubmit={(event) => { event.preventDefault(); props.onSave(); }}>
      {(mode === "add" || mode === "rename") && <label>Place name
        <Input required value={draft.name} onChange={(event) => { props.onChange({ name: event.target.value }); }} /></label>}
      {(mode === "add" || mode === "move") && <><p className="hint">Click the map, use its current center, or enter coordinates below.</p>
        <CoordinateFields draft={draft} onChange={props.onChange} /></>}
      {(mode === "add" || mode === "note") && <label className="markdown-label">One Markdown note
        <MDEditor value={draft.markdown} onChange={(value) => { props.onChange({ markdown: value ?? "" }); }}
          previewOptions={safePreviewOptions} height={280} visibleDragbar={false} /></label>}
      {mode === "note" && selected !== null && selected.markdown !== draft.markdown && feedback?.includes("changed since") &&
        <div className="saved-version"><h3>Current saved note</h3><SafeMarkdown markdown={selected.markdown} /></div>}
      {feedback?.includes("changed since") && <Button type="button" variant="outline"
        onClick={props.onReapply}>Reapply draft to current version</Button>}
      {mode === "delete" && <p>Delete <strong>{selected?.name}</strong> from your atlas? This cannot be undone in the app.</p>}
      {feedback && <p role="status" className={feedback === "Saved." ? "success-message" : "error-message"}>{feedback}</p>}
      <div className="form-actions"><Button type="button" variant="outline" onClick={props.onCancel} disabled={saving}>Cancel</Button>
        <Button type="submit" variant={mode === "delete" ? "destructive" : "default"} disabled={saving}>
          {saving ? "Saving…" : mode === "delete" ? "Delete place" : "Save"}</Button></div>
    </form>
  </aside>;
}
