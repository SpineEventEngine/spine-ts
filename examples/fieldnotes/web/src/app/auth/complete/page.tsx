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

import { useEffect, useState } from "react";
import { FieldnotesBrowserAuth } from "../../../browser-auth";

/**
 * Completes the one-use grant after removing it from browser history.
 *
 * @returns Generic sign-in completion or retry page.
 */
export default function CompletePage(): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const fragment = window.location.hash;
    window.history.replaceState(null, "", "/auth/complete");
    const auth = new FieldnotesBrowserAuth(
      (request) => fetch(request),
      () => document.cookie,
      {
        get: (key) => window.sessionStorage.getItem(key) ?? undefined,
        set: (key, value) => { window.sessionStorage.setItem(key, value); },
        delete: (key) => { window.sessionStorage.removeItem(key); },
      },
      window.location.origin,
    );
    void auth.completeGoogle(fragment).then((success) => {
      if (success) window.location.replace("/");
      else setFailed(true);
    }).catch(() => { setFailed(true); });
  }, []);
  return <main className="completion">
    <h1>Fieldnotes</h1>
    {failed ? <><p>Sign-in failed. Please try again.</p><a href="/">Return to sign in</a></>
      : <p role="status">Completing sign-in…</p>}
  </main>;
}
