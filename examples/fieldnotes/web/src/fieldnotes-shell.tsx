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
import { FieldnotesBrowserLifecycle, type IdentityView } from "./browser-lifecycle";
import { PlaceWorkspace } from "./place-workspace";
import type { PublicConfig } from "./public-config";

/**
 * Resolves identity before showing private place content.
 *
 * @param props Safe provider configuration.
 * @returns Responsive browser app shell.
 */
export function FieldnotesShell(props: { readonly config: PublicConfig }): React.JSX.Element {
  const [view, setView] = useState<IdentityView>({ phase: "loading", principal: null, error: null });
  const lifecycle = useRef<FieldnotesBrowserLifecycle | null>(null);
  useEffect(() => {
    const current = new FieldnotesBrowserLifecycle(props.config, setView);
    lifecycle.current = current;
    void current.start();
    return () => { lifecycle.current = null; void current.close(); };
  }, [props.config]);
  return <div className="app-shell">
    <header className="app-header"><div className="brand">
      <span className="brand-mark" aria-hidden="true">✳</span><span>Fieldnotes</span></div>
      {view.phase === "ready" && <button type="button" className="quiet-button"
        onClick={() => void lifecycle.current?.logout()}>Sign out</button>}
    </header>
    {view.phase === "loading" && <main className="center-panel"><p role="status">Checking your session…</p></main>}
    {view.phase === "signed-out" && <main className="center-panel"><div className="sign-in-card">
      <p className="eyebrow">Your private atlas</p><h1>Keep the places that matter close.</h1>
      <p>Pin a place, write a note, and return whenever you need it.</p>
      {view.error && <p role="alert" className="error-message">{view.error}</p>}
      <button type="button" className="primary-button"
        onClick={() => void lifecycle.current?.signIn()}>Continue with Google</button>
    </div></main>}
    {view.phase === "ready" && view.principal !== null &&
      <PlaceWorkspace principalId={view.principal.id} onPrivacyFailure={() => {
        setView({ phase: "signed-out", principal: null,
          error: "Connection interrupted. Please sign in again." });
      }} />}
  </div>;
}
