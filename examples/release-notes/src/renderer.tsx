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

import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { createRoot } from "react-dom/client";
import { ArrowRight, FileText } from "lucide-react";

import type { DesktopAuthStatus } from "./trusted/desktop-auth.js";
import { StudioIpcErrors } from "./trusted/studio-ipc-errors.js";
import { StudioFlow, type StudioFlowBridge } from "./studio-flow.js";

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
interface ReleaseNotesBridge extends StudioFlowBridge {
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
  const [loaded, setLoaded] = useState(false);
  const [statusFailed, setStatusFailed] = useState(false);
  const [notice, setNotice] = useState("");
  const refresh = async () => {
    setBusy(true);
    setNotice("");
    try {
      setStatus(await window.releaseNotes.status());
      setStatusFailed(false);
    } catch (error) {
      setStatusFailed(true);
      setNotice(StudioIpcErrors.display(error, "Could not check your ChatGPT connection."));
    } finally {
      setLoaded(true);
      setBusy(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  const run = accountAction(setStatus, setBusy, setNotice);
  const signOut = useSignOut(setStatus, setBusy, setNotice);
  return { status, busy, loaded, statusFailed, notice, setNotice, run, signOut, refresh };
};

const accountAction =
  (
    onStatus: (value: DesktopAuthStatus) => void,
    onBusy: (value: boolean) => void,
    onNotice: (value: string) => void,
  ) =>
  async (action: () => Promise<DesktopAuthStatus>) => {
    onBusy(true);
    onNotice("");
    try {
      onStatus(await action());
    } catch (error) {
      onNotice(StudioIpcErrors.display(error, "The account action could not be completed."));
    } finally {
      onBusy(false);
    }
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
      throw error;
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
  onChoice: (choice: { clientId: string; model: string; confirmed: boolean } | undefined) => void,
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
          onChoice({ clientId, model: result.model, confirmed: true });
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

interface ModelSelection {
  clientId: string;
  model: string;
  version: number;
}

interface ModelChoiceState {
  clientId: string;
  model: string;
  confirmed: boolean;
}

interface ModelSelectionPending {
  clientId: string | undefined;
  version: number;
}

const confirmModelSelection = async (
  requested: ModelSelection,
  pending: RefObject<ModelSelectionPending>,
  onChoice: (value: ModelChoiceState | undefined) => void,
  onNotice: (value: string) => void,
) => {
  const isCurrent = () =>
    pending.current.clientId === requested.clientId &&
    pending.current.version === requested.version;
  try {
    const result = await window.releaseNotes.selectModel(requested.clientId, requested.model);
    if (isCurrent()) {
      onChoice({ clientId: requested.clientId, model: result.model, confirmed: true });
      onNotice("");
    }
  } catch (error) {
    if (isCurrent()) {
      onChoice(undefined);
      onNotice(
        StudioIpcErrors.display(error, "That model is no longer available to this account."),
      );
    }
  }
};

const drainModelSelections = async (
  pending: RefObject<ModelSelectionPending>,
  queued: RefObject<ModelSelection | undefined>,
  preparing: RefObject<boolean>,
  onChoice: (value: ModelChoiceState | undefined) => void,
  onNotice: (value: string) => void,
) => {
  if (preparing.current) return;
  preparing.current = true;
  try {
    while (queued.current) {
      const requested = queued.current;
      queued.current = undefined;
      if (
        pending.current.clientId !== requested.clientId ||
        pending.current.version !== requested.version
      )
        continue;
      await confirmModelSelection(requested, pending, onChoice, onNotice);
    }
  } finally {
    preparing.current = false;
  }
};

const useModels = (status: DesktopAuthStatus, onNotice: (value: string) => void) => {
  const [choice, setChoice] = useState<ModelChoiceState>();
  const pending = useRef({ clientId: status.selectedClientId, version: 0 });
  const queued = useRef<ModelSelection | undefined>(undefined);
  const preparing = useRef(false);
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
    setChoice({ clientId, model: slug, confirmed: false });
    onNotice("");
    queued.current = { clientId, model: slug, version };
    await drainModelSelections(pending, queued, preparing, setChoice, onNotice);
  };
  const model =
    choice !== undefined && choice.clientId === status.selectedClientId && status.planEnabled
      ? choice.model
      : "";
  const modelPending = model !== "" && choice?.confirmed === false;
  return { models, model, modelPending, select };
};

const trapSignInFocus = (event: KeyboardEvent<HTMLDivElement>, gate: HTMLDivElement | null) => {
  if (event.target instanceof Element && event.target.closest('[role="listbox"]')) return;
  if (event.key === "Escape") event.preventDefault();
  if (event.key !== "Tab") return;
  const controls = Array.from(
    gate?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
  );
  if (controls.length === 0) return;
  const current = controls.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.shiftKey
    ? (current - 1 + controls.length) % controls.length
    : (current + 1) % controls.length;
  event.preventDefault();
  controls[next]?.focus();
};

const SignInPrimaryAction = ({ account }: { account: ReturnType<typeof useAccount> }) => {
  const retryStatus = account.statusFailed;
  const label = retryStatus
    ? "Check connection again"
    : account.busy
      ? "Complete sign-in in your browser…"
      : account.status.pendingClientIds.length > 0
        ? "Continue sign-in"
        : "Sign in with ChatGPT";
  const action = retryStatus
    ? account.refresh
    : () => account.run(() => window.releaseNotes.signIn());
  return (
    <button className="primary-button" disabled={account.busy} onClick={() => void action()}>
      {label}
      {!account.busy && <ArrowRight aria-hidden="true" size={16} />}
    </button>
  );
};

const SignInControls = ({ account }: { account: ReturnType<typeof useAccount> }) => (
  <div className="sign-in-controls">
    <SignInPrimaryAction account={account} />
  </div>
);

const SignInDialogBody = ({ account }: { account: ReturnType<typeof useAccount> }) => (
  <>
    <span className="sign-in-brand-mark">
      <FileText aria-hidden="true" size={22} />
    </span>
    <p className="sign-in-brand-name">Release Notes Studio</p>
    <h1 id="sign-in-title">Welcome</h1>
    <p className="sign-in-intro">Draft release notes with your ChatGPT plan.</p>
    {account.loaded ? (
      <SignInControls account={account} />
    ) : (
      <p role="status">Checking your connection…</p>
    )}
    {account.notice && (
      <p className="notice-banner" role="status">
        {account.notice}
      </p>
    )}
  </>
);

const SignInGate = ({ account }: { account: ReturnType<typeof useAccount> }) => {
  const gate = useRef<HTMLDivElement>(null);
  useEffect(() => {
    gate.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [account.loaded]);
  return (
    <div className="sign-in-screen">
      <div
        ref={gate}
        className="sign-in-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sign-in-title"
        onKeyDown={(event) => {
          trapSignInFocus(event, gate.current);
        }}
      >
        <SignInDialogBody account={account} />
      </div>
    </div>
  );
};

const App = () => {
  const account = useAccount();
  const models = useModels(account.status, account.setNotice);
  if (!account.loaded || !account.status.planEnabled || !account.status.selectedClientId)
    return <SignInGate account={account} />;
  return (
    <>
      <StudioFlow
        bridge={window.releaseNotes}
        models={models.models}
        model={models.model}
        modelPending={models.modelPending}
        selectModel={models.select}
        signOut={() => account.signOut(account.status.selectedClientId ?? "")}
        onNotice={account.setNotice}
        clearSuccessNotice={() => {
          if (account.notice === "Markdown exported." || account.notice === "Markdown copied.")
            account.setNotice("");
        }}
      />
      {account.notice && (
        <p
          className={
            account.notice === "Markdown exported." || account.notice === "Markdown copied."
              ? "notice-toast"
              : "notice-banner"
          }
          role="status"
        >
          {account.notice}
        </p>
      )}
    </>
  );
};

const root = document.getElementById("root");
if (root === null) throw new Error("Application root is missing.");
createRoot(root).render(<App />);
