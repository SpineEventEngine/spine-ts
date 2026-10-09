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

import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import type { DesktopAuthStatus } from "./trusted/desktop-auth.js";

interface ModelChoice {
  /**
   * Account-advertised model slug.
   */
  readonly slug: string;

  /**
   * Account-advertised model label.
   */
  readonly displayName: string;
}
interface ModelCatalog {
  readonly clientId: string;
  readonly models: readonly ModelChoice[];
}
interface ReleaseNotesBridge {
  /**
   * Returns the renderer-safe account status.
   *
   * @returns The status result.
   */
  status(): Promise<DesktopAuthStatus>;

  /**
   * Opens the browser and completes local authorization.
   *
   * @returns The sign in result.
   */
  signIn(): Promise<DesktopAuthStatus>;

  /**
   * Connects the issued account in the browser.
   *
   * @param clientId Issued OAuth client identifier.
   * @returns The reconnect result.
   */
  reconnect(clientId: string): Promise<DesktopAuthStatus>;

  /**
   * Sets a verified account for plan use.
   *
   * @param clientId Issued OAuth client identifier.
   * @returns The select account result.
   */
  selectAccount(clientId: string): Promise<DesktopAuthStatus>;

  /**
   * Fetches the account model catalog.
   *
   * @param clientId Issued OAuth client identifier.
   * @returns The models result.
   */
  models(clientId: string): Promise<readonly ModelChoice[]>;

  /**
   * Sets an account-advertised model.
   *
   * @param clientId Issued OAuth client identifier.
   * @param model The model for this operation.
   * @returns The select model result.
   */
  selectModel(clientId: string, model: string): Promise<{ model: string }>;

  /**
   * Clears local credentials after attempting refresh-token revocation.
   *
   * @param clientId Issued OAuth client identifier.
   * @returns The sign out result.
   */
  signOut(clientId: string): Promise<{ status: DesktopAuthStatus; revocationConfirmed: boolean }>;

  /**
   * Opens account usage management in the browser.
   *
   * @returns The manage usage result.
   */
  manageUsage(): Promise<void>;
}

declare global {
  interface Window {
    /**
     * The release notes value.
     */
    releaseNotes: ReleaseNotesBridge;
  }
}

const useAccount = () => {
  const [status, setStatus] = useState<DesktopAuthStatus>({
    accounts: [],
    planEnabled: false,
    pendingClientIds: [],
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    void window.releaseNotes.status().then(setStatus);
  }, []);
  const run = async (action: () => Promise<DesktopAuthStatus>) => {
    setBusy(true);
    setNotice("");
    try {
      setStatus(await action());
    } catch {
      setNotice("The account action could not be completed.");
    } finally {
      setBusy(false);
    }
  };
  const signOut = useSignOut(setStatus, setBusy, setNotice);
  return { status, busy, notice, setNotice, run, signOut };
};

const useSignOut = (
  onStatus: (value: DesktopAuthStatus) => void,
  onBusy: (value: boolean) => void,
  onNotice: (value: string) => void,
) => {
  return async (clientId: string) => {
    onBusy(true);
    try {
      const result = await window.releaseNotes.signOut(clientId);
      onStatus(result.status);
      if (!result.revocationConfirmed)
        onNotice("Signed out locally; remote revocation was not confirmed.");
    } catch {
      onNotice("Sign-out could not be completed.");
    } finally {
      onBusy(false);
    }
  };
};

const useModelCatalog = (
  status: DesktopAuthStatus,
  onNotice: (value: string) => void,
  onReset: () => void,
) => {
  const [catalog, setCatalog] = useState<ModelCatalog>();
  useEffect(() => {
    let current = true;
    const selected = status.selectedClientId;
    if (!selected || !status.planEnabled) {
      setCatalog(undefined);
      onReset();
      return () => {
        current = false;
      };
    }
    setCatalog({ clientId: selected, models: [] });
    void window.releaseNotes
      .models(selected)
      .then((catalog) => {
        if (!current) return;
        setCatalog({ clientId: selected, models: catalog });
        onReset();
      })
      .catch(() => {
        if (current) onNotice("Models for this account are unavailable.");
      });
    return () => {
      current = false;
    };
  }, [status.selectedClientId, status.planEnabled]);
  return catalog !== undefined && catalog.clientId === status.selectedClientId && status.planEnabled
    ? catalog.models
    : [];
};

const useModels = (status: DesktopAuthStatus, onNotice: (value: string) => void) => {
  const [choice, setChoice] = useState<{ clientId: string; model: string }>();
  const pending = useRef({ clientId: status.selectedClientId, version: 0 });
  if (pending.current.clientId !== status.selectedClientId) {
    pending.current = { clientId: status.selectedClientId, version: pending.current.version + 1 };
  }
  const models = useModelCatalog(status, onNotice, () => {
    setChoice(undefined);
  });
  const select = async (slug: string) => {
    const clientId = status.selectedClientId;
    if (!clientId) return;
    const version = ++pending.current.version;
    try {
      const result = await window.releaseNotes.selectModel(clientId, slug);
      if (pending.current.clientId === clientId && pending.current.version === version) {
        setChoice({ clientId, model: result.model });
      }
    } catch {
      if (pending.current.clientId === clientId && pending.current.version === version) {
        onNotice("That model is no longer available to this account.");
      }
    }
  };
  const model =
    choice !== undefined && choice.clientId === status.selectedClientId && status.planEnabled
      ? choice.model
      : "";
  return { models, model, select };
};

const AccountPicker = ({
  status,
  busy,
  run,
}: Pick<ReturnType<typeof useAccount>, "status" | "busy" | "run">) => (
  <label>
    Account
    <select
      value={status.selectedClientId ?? ""}
      disabled={busy}
      onChange={(event) => {
        if (event.target.value)
          void run(() => window.releaseNotes.selectAccount(event.target.value));
      }}
    >
      <option value="">Select an account</option>
      {status.accounts.map((account) => (
        <option key={account.clientId} value={account.clientId}>
          {account.email ?? account.subject} ({account.clientId})
        </option>
      ))}
    </select>
  </label>
);

const AccountActions = ({ status, busy, run, signOut }: ReturnType<typeof useAccount>) => (
  <>
    <button disabled={busy} onClick={() => void run(() => window.releaseNotes.signIn())}>
      Continue with ChatGPT
    </button>
    {status.accounts.length > 0 && <AccountPicker status={status} busy={busy} run={run} />}
    {status.pendingClientIds.map((clientId) => (
      <button
        key={clientId}
        disabled={busy}
        onClick={() => void run(() => window.releaseNotes.reconnect(clientId))}
      >
        Retry {clientId}
      </button>
    ))}
    <p>{status.planEnabled ? "Using ChatGPT plan" : "ChatGPT plan use is not enabled"}</p>
    {status.selectedClientId && (
      <>
        <button
          disabled={busy}
          onClick={() =>
            void run(() => window.releaseNotes.reconnect(status.selectedClientId ?? ""))
          }
        >
          Reconnect
        </button>
        <button disabled={busy} onClick={() => void signOut(status.selectedClientId ?? "")}>
          Sign out
        </button>
      </>
    )}
    <button onClick={() => void window.releaseNotes.manageUsage()}>Manage usage</button>
  </>
);

const ModelPanel = ({
  status,
  models,
  model,
  select,
}: {
  status: DesktopAuthStatus;
  models: readonly ModelChoice[];
  model: string;
  select: (slug: string) => Promise<void>;
}) => (
  <section aria-label="Model">
    <h2>Model</h2>
    <label>
      Available to this account
      <select
        value={model}
        disabled={!status.planEnabled || models.length === 0}
        onChange={(event) => void select(event.target.value)}
      >
        <option value="">Select a model</option>
        {models.map((choice) => (
          <option key={choice.slug} value={choice.slug}>
            {choice.displayName}
          </option>
        ))}
      </select>
    </label>
  </section>
);

const App = () => {
  const account = useAccount();
  const models = useModels(account.status, account.setNotice);
  return (
    <main>
      <h1>Release Notes Studio</h1>
      <p>
        Draft release notes with a reviewable Agent workflow. Connect a ChatGPT account before using
        its plan.
      </p>
      <section aria-label="ChatGPT account">
        <h2>ChatGPT account</h2>
        <AccountActions {...account} />
      </section>
      <ModelPanel status={account.status} {...models} />
      {account.notice && <p role="status">{account.notice}</p>}
    </main>
  );
};

const root = document.getElementById("root");
if (root === null) throw new Error("Application root is missing.");
createRoot(root).render(<App />);
