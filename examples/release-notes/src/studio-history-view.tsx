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

import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { Copy, History, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { HistorySection } from "./studio-history-section.js";
import type { HistoryRecord } from "./studio-history-record.js";

/**
 * One release with its original creation timestamp.
 */
export interface HistoryRelease {
  /**
   * Draft identifier used for indexed history requests.
   */
  readonly id: string;

  /**
   * Release title displayed in the section heading.
   */
  readonly title: string;

  /**
   * Original creation timestamp, distinct from later edit times.
   */
  readonly createdAt?: string | undefined;
}

/**
 * The existing trusted history and native clipboard actions used by the drawer.
 */
export interface HistoryBridge {
  /**
   * Reads one indexed audit page for a session release.
   *
   * @param id Session release identifier.
   * @param category Indexed history category.
   * @param pageSize Requested number of records.
   * @param cursor Cursor for an older page, when present.
   * @returns Records and a cursor for the next older page.
   */
  history(
    id: string,
    category: string,
    pageSize: number,
    cursor?: string,
  ): Promise<{
    items: readonly unknown[];
    cursor?: string;
  }>;

  /**
   * Copies full message text or recorded fields to the native clipboard.
   *
   * @param content Exact content to copy.
   * @returns Completion of the native clipboard action.
   */
  copyMarkdown(content: string): Promise<void>;
}

interface DrawerProps {
  releases: readonly HistoryRelease[];
  currentId?: string | undefined;
  generatingId?: string | undefined;
  bridge: HistoryBridge;
  onClose: () => void;
  restoreFocus?: HTMLElement | null | undefined;
}

/**
 * Keeps keyboard focus within the visible audit dialog.
 */
const trapFocus = (event: KeyboardEvent<HTMLElement>): void => {
  if (event.key !== "Tab") return;
  const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button, summary"));
  const current = controls.indexOf(document.activeElement as HTMLElement);
  event.preventDefault();
  controls[(current + (event.shiftKey ? controls.length - 1 : 1)) % controls.length]?.focus();
};

/**
 * Restores focus to the launcher or selected record as the dialogs close.
 */
const useHistoryFocus = (
  detail: HistoryRecord | undefined,
  onDetail: (value: HistoryRecord | undefined) => void,
  restoreFocus?: HTMLElement | null,
) => {
  const launcher = useRef<HTMLElement | null>(
    restoreFocus ?? (document.activeElement as HTMLElement),
  );
  const selected = useRef<HTMLElement | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const modal = useRef<HTMLDivElement>(null);
  useEffect(() => {
    closeButton.current?.focus();
    return () => {
      launcher.current?.focus();
    };
  }, []);
  useEffect(() => {
    if (detail) modal.current?.querySelector<HTMLButtonElement>("button")?.focus();
    else if (selected.current) {
      selected.current.focus();
      selected.current = null;
    }
  }, [detail]);
  const show = (value: HistoryRecord) => {
    selected.current = document.activeElement as HTMLElement;
    onDetail(value);
  };
  const hide = () => {
    onDetail(undefined);
  };
  return { closeButton, modal, show, hide };
};

type HistoryFocus = ReturnType<typeof useHistoryFocus>;

/**
 * Renders the panel heading and close action.
 */
const PanelHeading = ({
  onClose,
  focus,
}: {
  onClose: () => void;
  focus: HistoryFocus;
}): ReactElement => (
  <header className="rs-history-heading">
    <span className="rs-history-mark">
      <History size={18} aria-hidden="true" />
    </span>
    <div>
      <h2>History</h2>
      <p>Recorded in this session</p>
    </div>
    <button
      ref={focus.closeButton}
      className="icon-action"
      type="button"
      aria-label="Close history"
      onClick={onClose}
    >
      <X size={18} aria-hidden="true" />
    </button>
  </header>
);

/**
 * Lists the session releases without merging their indexed histories.
 */
const PanelReleases = ({
  releases,
  expanded,
  setExpanded,
  generatingId,
  bridge,
  focus,
}: DrawerProps & {
  expanded: string | undefined;
  setExpanded: (id: string | undefined) => void;
  focus: HistoryFocus;
}): ReactElement => (
  <div className="rs-history-releases">
    {releases.length === 0 && <p className="rs-history-empty">No releases yet.</p>}
    {releases.map((release) => (
      <HistorySection
        key={release.id}
        release={release}
        expanded={expanded === release.id}
        generating={generatingId === release.id}
        bridge={bridge}
        onToggle={() => {
          setExpanded(expanded === release.id ? undefined : release.id);
        }}
        onDetail={focus.show}
      />
    ))}
  </div>
);

/**
 * Renders the sliding panel and traps keyboard navigation within it.
 */
const HistoryPanel = ({
  onClose,
  focus,
  modalOpen,
  ...props
}: DrawerProps & {
  expanded: string | undefined;
  setExpanded: (id: string | undefined) => void;
  focus: HistoryFocus;
  modalOpen: boolean;
}): ReactElement => (
  <aside
    className="rs-history-drawer"
    role="dialog"
    aria-modal="true"
    aria-label="History"
    inert={modalOpen}
    onKeyDown={(event) => {
      if (event.key === "Escape") onClose();
      else trapFocus(event);
    }}
  >
    <PanelHeading onClose={onClose} focus={focus} />
    <PanelReleases {...props} onClose={onClose} focus={focus} />
  </aside>
);

/**
 * Returns a readable JSON object only when the exact visible content is JSON.
 */
const formattedJson = (exact: string): string | undefined => {
  try {
    return JSON.stringify(JSON.parse(exact), null, 2);
  } catch {
    return undefined;
  }
};

/**
 * Renders model Markdown without navigating links or loading remote images.
 */
const SafeHistoryMarkdown = ({ text }: { text: string }): ReactElement => (
  <ReactMarkdown
    skipHtml
    components={{
      a: ({ children, href }) => (
        <span>
          {children} {href && <small>({href})</small>}
        </span>
      ),
      img: ({ alt, src }) => (
        <span>
          Image: {alt ?? "Untitled image"} {src && <small>({src})</small>}
        </span>
      ),
    }}
  >
    {text}
  </ReactMarkdown>
);

/**
 * Renders full message text while preserving the unmodified record below.
 */
const ModalBody = ({ detail }: { detail: HistoryRecord }): ReactElement => {
  const json = detail.exact ? formattedJson(detail.exact) : undefined;
  return (
    <>
      {json ? (
        <pre>{json}</pre>
      ) : detail.kind === "Model" && detail.exact ? (
        <div className="rs-history-modal-message">
          <SafeHistoryMarkdown text={detail.exact} />
        </div>
      ) : (
        <pre>{detail.exact || detail.detail}</pre>
      )}
      <details>
        <summary>Recorded fields</summary>
        <pre>{detail.detail}</pre>
      </details>
    </>
  );
};

/**
 * Keeps the dialog title and close action visible above the full record.
 */
const ModalHeading = ({
  detail,
  focus,
}: {
  detail: HistoryRecord;
  focus: HistoryFocus;
}): ReactElement => (
  <header>
    <div>
      <span className="rs-history-kind">{detail.speaker}</span>
      <h2>{detail.title}</h2>
    </div>
    <button type="button" aria-label="Close detail" onClick={focus.hide}>
      <X size={18} />
    </button>
  </header>
);

/**
 * Copies the exact visible content, including whitespace.
 */
const ModalCopy = ({
  detail,
  bridge,
}: {
  detail: HistoryRecord;
  bridge: HistoryBridge;
}): ReactElement => (
  <footer>
    <button
      type="button"
      onClick={() => {
        void bridge.copyMarkdown(detail.exact || detail.detail);
      }}
    >
      <Copy size={15} aria-hidden="true" /> Copy
    </button>
  </footer>
);

/**
 * Shows full visible content with unchanged recorded fields available beneath it.
 */
const HistoryModal = ({
  detail,
  bridge,
  focus,
}: {
  detail: HistoryRecord;
  bridge: HistoryBridge;
  focus: HistoryFocus;
}): ReactElement => (
  <div className="rs-history-modal-backdrop">
    <div
      ref={focus.modal}
      className="rs-history-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Recorded detail"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") focus.hide();
        else trapFocus(event);
      }}
    >
      <ModalHeading detail={detail} focus={focus} />
      <ModalBody detail={detail} />
      <ModalCopy detail={detail} bridge={bridge} />
    </div>
  </div>
);

/**
 * Renders each release's indexed audit without combining their records.
 *
 * @param releases Session releases to list independently.
 * @param currentId Release initially expanded when available.
 * @param generatingId Release currently receiving generation events.
 * @param bridge Trusted history and clipboard actions.
 * @param onClose Closes the drawer.
 * @param restoreFocus Element to focus after closing the drawer.
 * @returns Accessible sliding audit panel.
 */
export const HistoryDrawer = ({
  releases,
  currentId,
  generatingId,
  bridge,
  onClose,
  restoreFocus,
}: DrawerProps): ReactElement => {
  const [expanded, setExpanded] = useState<string | undefined>(currentId ?? releases[0]?.id);
  const [detail, setDetail] = useState<HistoryRecord>();
  const focus = useHistoryFocus(detail, setDetail, restoreFocus);
  return (
    <>
      <div className="rs-history-scrim" onClick={onClose} aria-hidden="true" />
      <HistoryPanel
        releases={releases}
        currentId={currentId}
        generatingId={generatingId}
        bridge={bridge}
        onClose={onClose}
        expanded={expanded}
        setExpanded={setExpanded}
        focus={focus}
        modalOpen={Boolean(detail)}
      />
      {detail && <HistoryModal detail={detail} bridge={bridge} focus={focus} />}
    </>
  );
};
