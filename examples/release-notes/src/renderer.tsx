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

import { useEffect, useRef, useState, type RefObject } from "react";
import { createRoot } from "react-dom/client";
import { CircleHelp, LogOut, Power, Sparkles } from "lucide-react";

import type { DesktopAuthStatus } from "./trusted/desktop-auth.js";
import { StudioIpcErrors } from "./trusted/studio-ipc-errors.js";
import { StudioPanel, type StudioBridge } from "./studio-ui.js";

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
interface ReleaseNotesBridge extends StudioBridge {
  /**
   * Returns the account's selected model after renderer reload.
   *
   * @returns Selected model slug, or an empty slug until selection.
   */
  currentModel(): Promise<{ model: string }>;

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
    } catch (error) {
      setNotice(StudioIpcErrors.display(error, "The account action could not be completed."));
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
        onNotice(
          "Signed out on this computer. We could not confirm that OpenAI removed the connection.",
        );
    } catch (error) {
      onNotice(StudioIpcErrors.display(error, "Sign-out could not be completed."));
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

const useCurrentModel = (
  status: DesktopAuthStatus,
  models: readonly ModelChoice[],
  pending: RefObject<{ clientId: string | undefined; version: number }>,
  onChoice: (choice: { clientId: string; model: string } | undefined) => void,
  onNotice: (value: string) => void,
) => {
  useEffect(() => {
    const clientId = status.selectedClientId;
    if (!clientId || models.length === 0) return;
    let current = true;
    const version = pending.current.version;
    void window.releaseNotes
      .currentModel()
      .then((result) => {
        if (
          current &&
          pending.current.clientId === clientId &&
          pending.current.version === version &&
          models.some((item) => item.slug === result.model)
        )
          onChoice({ clientId, model: result.model });
      })
      .catch(() => {
        if (current && pending.current.clientId === clientId && pending.current.version === version)
          onNotice("Selected model is unavailable.");
      });
    return () => {
      current = false;
    };
  }, [status.selectedClientId, models]);
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
  useCurrentModel(status, models, pending, setChoice, onNotice);
  const select = async (slug: string) => {
    const clientId = status.selectedClientId;
    if (!clientId) return;
    const version = ++pending.current.version;
    try {
      const result = await window.releaseNotes.selectModel(clientId, slug);
      if (pending.current.clientId === clientId && pending.current.version === version) {
        setChoice({ clientId, model: result.model });
      }
    } catch (error) {
      if (pending.current.clientId === clientId && pending.current.version === version) {
        onNotice(
          StudioIpcErrors.display(error, "That model is no longer available to this account."),
        );
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
      {status.accounts.map((account, index) => (
        <option key={account.clientId} value={account.clientId}>
          {account.email ?? "ChatGPT account"} · {index + 1}
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
    {status.pendingClientIds.map((clientId, index) => (
      <button
        key={clientId}
        disabled={busy}
        onClick={() => void run(() => window.releaseNotes.reconnect(clientId))}
      >
        Continue sign-in {index + 1}
      </button>
    ))}
    <p className="account-state">
      {status.planEnabled ? "Ready to write with ChatGPT" : "Connect a ChatGPT plan to write"}
    </p>
    {status.selectedClientId && (
      <SelectedAccountActions
        clientId={status.selectedClientId}
        busy={busy}
        run={run}
        signOut={signOut}
      />
    )}
    <button className="text-button" onClick={() => void window.releaseNotes.manageUsage()}>
      <CircleHelp aria-hidden="true" size={15} /> View plan usage
    </button>
  </>
);

const SelectedAccountActions = ({
  clientId,
  busy,
  run,
  signOut,
}: {
  clientId: string;
  busy: boolean;
  run: ReturnType<typeof useAccount>["run"];
  signOut: ReturnType<typeof useAccount>["signOut"];
}) => (
  <>
    <button disabled={busy} onClick={() => void run(() => window.releaseNotes.reconnect(clientId))}>
      Refresh connection
    </button>
    <button disabled={busy} onClick={() => void signOut(clientId)}>
      <LogOut aria-hidden="true" size={15} /> Sign out
    </button>
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
  <section className="model-settings" aria-label="Writing model">
    <h2>Writing model</h2>
    <label>
      Choose a model
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

const SidebarSettings = ({
  account,
  models,
}: {
  account: ReturnType<typeof useAccount>;
  models: ReturnType<typeof useModels>;
}) => {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <>
      <button
        className="sidebar-settings-toggle"
        type="button"
        aria-controls="sidebar-settings"
        aria-expanded={settingsOpen}
        onClick={() => {
          setSettingsOpen(!settingsOpen);
        }}
      >
        Account and model
      </button>
      <div id="sidebar-settings" className={`sidebar-settings${settingsOpen ? " is-open" : ""}`}>
        <section className="account-settings" aria-label="ChatGPT account">
          <h2>ChatGPT account</h2>
          <AccountActions {...account} />
        </section>
        <ModelPanel status={account.status} {...models} />
      </div>
    </>
  );
};

const IdentitySidebar = ({
  account,
  models,
}: {
  account: ReturnType<typeof useAccount>;
  models: ReturnType<typeof useModels>;
}) => {
  return (
    <aside className="identity-sidebar" aria-label="Account and writing settings">
      <div className="brand-mark">
        <Sparkles aria-hidden="true" size={20} />
      </div>
      <p className="eyebrow">Writing workspace</p>
      <h1>
        Release Notes
        <br />
        Studio
      </h1>
      <p className="sidebar-intro">Turn committed changes into clear notes for your readers.</p>
      <div className="sidebar-divider" />
      <SidebarSettings account={account} models={models} />
      <p className="privacy-note">Your sign-in stays protected on this computer.</p>
      <button
        className="sidebar-quit text-button"
        type="button"
        onClick={() => void window.releaseNotes.stopAndQuit()}
      >
        <Power aria-hidden="true" size={14} /> Quit
      </button>
    </aside>
  );
};

const App = () => {
  const account = useAccount();
  const models = useModels(account.status, account.setNotice);
  return (
    <main className="app-shell">
      <IdentitySidebar account={account} models={models} />
      <div className="app-content">
        <header className="app-header">
          <div>
            <p className="eyebrow">Your workspace</p>
            <h2>Prepare a release</h2>
          </div>
          <span className="header-badge">Draft · Review · Export</span>
        </header>
        {account.notice && (
          <p className="notice-banner" role="status">
            {account.notice}
          </p>
        )}
        <StudioPanel
          modelReady={account.status.planEnabled && Boolean(models.model)}
          notice={account.setNotice}
        />
      </div>
    </main>
  );
};

const root = document.getElementById("root");
if (root === null) throw new Error("Application root is missing.");
createRoot(root).render(<App />);
