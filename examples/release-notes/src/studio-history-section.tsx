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

import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { ChevronDown, ChevronRight, Clock3, Maximize2 } from "lucide-react";
import {
  historyAge,
  historyKey,
  historyMerge,
  historyRecord,
  type HistoryRecord,
} from "./studio-history-record.js";
import type { HistoryBridge, HistoryRelease } from "./studio-history-view.js";

interface SectionProps {
  release: HistoryRelease;
  expanded: boolean;
  generating: boolean;
  bridge: HistoryBridge;
  onToggle: () => void;
  onDetail: (detail: HistoryRecord) => void;
}

/**
 * Keeps scroll anchors across paging and collapses.
 */
const useScrollState = () => ({
  anchored: useRef(false),
  olderHeight: useRef<number | undefined>(undefined),
  savedTop: useRef<number | undefined>(undefined),
  followLatest: useRef(false),
});

/**
 * Holds paging state for one release while the drawer remains open.
 */
const usePageState = () => {
  const [items, setItems] = useState<readonly unknown[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const active = useRef(true);
  const reading = useRef(false);
  const pendingRead = useRef(false);
  const scroll = useScrollState();
  return {
    items,
    setItems,
    cursor,
    setCursor,
    loaded,
    setLoaded,
    busy,
    setBusy,
    error,
    setError,
    newCount,
    setNewCount,
    list,
    active,
    reading,
    pendingRead,
    ...scroll,
  };
};

type PageState = ReturnType<typeof usePageState>;

/**
 * Walks a refresh across every new page until it joins the prior loaded anchor.
 */
const readPages = async (
  bridge: HistoryBridge,
  id: string,
  cursor: string | undefined,
  known: readonly unknown[],
): Promise<{ items: unknown[]; cursor?: string }> => {
  const first = await bridge.history(id, "all", 40, cursor);
  const items = [...first.items];
  let next = first.cursor;
  const keys = new Set(known.map(historyKey));
  while (known.length && next && !items.some((entry) => keys.has(historyKey(entry)))) {
    const page = await bridge.history(id, "all", 40, next);
    items.push(...page.items);
    next = page.cursor;
  }
  return { items, ...(next ? { cursor: next } : {}) };
};

/**
 * Reconciles one page without replacing older entries or moving a reader higher in the list.
 */
const acceptPage = (
  state: PageState,
  page: { items: readonly unknown[]; cursor?: string },
  older: boolean,
): void => {
  state.setItems((current) => {
    const known = new Set(current.map(historyKey));
    const additions = page.items.filter((entry) => !known.has(historyKey(entry)));
    const area = state.list.current;
    if (!older && state.loaded && additions.length && area) {
      if (area.scrollHeight - area.scrollTop - area.clientHeight > 60)
        state.setNewCount((count) => count + additions.length);
      else {
        state.followLatest.current = true;
        state.setNewCount(0);
      }
    }
    return older ? historyMerge(page.items, current) : historyMerge(current, page.items);
  });
  if (older || !state.loaded || state.items.length === 0) state.setCursor(page.cursor);
  state.setLoaded(true);
};

/**
 * Reads an initial, older, or refreshed indexed history page.
 */
const usePageRead =
  (release: HistoryRelease, bridge: HistoryBridge, state: PageState) =>
  async (older = false): Promise<void> => {
    if (state.reading.current) {
      if (!older) state.pendingRead.current = true;
      return;
    }
    if (older) state.olderHeight.current = state.list.current?.scrollHeight;
    state.reading.current = true;
    state.setBusy(true);
    state.setError(false);
    try {
      const page = await readPages(
        bridge,
        release.id,
        older ? state.cursor : undefined,
        !older && state.loaded ? state.items : [],
      );
      if (state.active.current) acceptPage(state, page, older);
    } catch {
      state.olderHeight.current = undefined;
      if (state.active.current) state.setError(true);
    } finally {
      state.reading.current = false;
      if (state.active.current) state.setBusy(false);
    }
  };

/**
 * Reads a section when opened, including activity recorded while it was collapsed.
 */
const useOpenRead = (
  expanded: boolean,
  state: PageState,
  read: (older?: boolean) => Promise<void>,
): void => {
  useEffect(() => {
    state.active.current = true;
    return () => {
      state.active.current = false;
    };
  }, []);
  useEffect(() => {
    if (expanded) void read();
  }, [expanded]);
  useEffect(() => {
    if (!state.busy && state.pendingRead.current) {
      state.pendingRead.current = false;
      void read();
    }
  }, [state.busy]);
};

/**
 * Anchors the newest record initially and preserves the reader's position as older pages prepend.
 */
const useListPosition = (state: PageState, expanded: boolean): void => {
  useLayoutEffect(() => {
    const area = state.list.current;
    if (!area || !state.items.length) return;
    if (!state.anchored.current) {
      area.scrollTop = area.scrollHeight;
      state.anchored.current = true;
      state.savedTop.current = undefined;
    } else if (state.olderHeight.current !== undefined && !state.reading.current) {
      area.scrollTop =
        (state.savedTop.current ?? area.scrollTop) + area.scrollHeight - state.olderHeight.current;
      state.savedTop.current = undefined;
      state.olderHeight.current = undefined;
    } else if (state.savedTop.current !== undefined) {
      area.scrollTop = state.savedTop.current;
      state.savedTop.current = undefined;
    } else if (state.followLatest.current) {
      area.scrollTop = area.scrollHeight;
      state.followLatest.current = false;
    }
  }, [state.items, expanded]);
};

/**
 * Refreshes during generation and once more when it finishes.
 */
const useGenerationRefresh = (
  expanded: boolean,
  generating: boolean,
  state: PageState,
  read: (older?: boolean) => Promise<void>,
): void => {
  const prior = useRef(generating);
  useEffect(() => {
    if (!expanded || !generating) return;
    const timer = window.setInterval(() => {
      void read();
    }, 2_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [expanded, generating, state.items, state.cursor, state.loaded]);
  useEffect(() => {
    if (prior.current && !generating && expanded) void read();
    prior.current = generating;
  }, [generating, expanded]);
};

/**
 * Renders the collapsible release title and its live creation age.
 */
const SectionHeader = ({
  release,
  expanded,
  onToggle,
}: Pick<SectionProps, "release" | "expanded" | "onToggle">): ReactElement => {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 30_000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  return (
    <button
      type="button"
      className="rs-history-release-title"
      aria-expanded={expanded}
      onClick={onToggle}
    >
      {expanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
      <span className="rs-history-release-name">{release.title}</span>
      <span
        className="rs-history-age"
        title={release.createdAt ? new Date(release.createdAt).toLocaleString() : undefined}
      >
        <Clock3 size={13} aria-hidden="true" /> {historyAge(release.createdAt, now)}
      </span>
    </button>
  );
};

/**
 * Renders the recorded time with exact source value available on hover.
 */
const EntryTime = ({ value }: { value: string | undefined }): ReactElement | null =>
  value ? (
    <time dateTime={value} title={value}>
      {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(value),
      )}
    </time>
  ) : null;

/**
 * Renders one conversational bubble or compact Event record.
 */
const HistoryEntry = ({
  entry,
  onDetail,
}: {
  entry: unknown;
  onDetail: SectionProps["onDetail"];
}): ReactElement => {
  const view = historyRecord(entry);
  const bubble = view.kind === "App" || view.kind === "Model";
  return (
    <article
      className={`rs-history-entry ${bubble ? "conversation" : "compact"} ${view.kind.toLowerCase()}`}
    >
      <div className="rs-history-entry-head">
        <span className="rs-history-kind">{view.kind}</span>
        <strong>{view.title}</strong>
        <EntryTime value={view.occurredAt} />
      </div>
      <p className="rs-history-preview">{view.preview}</p>
      <button
        type="button"
        className="rs-history-read"
        aria-label="Read full record"
        title="Read full record"
        onClick={() => {
          onDetail(view);
        }}
      >
        <Maximize2 size={13} aria-hidden="true" />
      </button>
    </article>
  );
};

/**
 * Shows a jump action when new records arrive below the reader's current position.
 */
const NewEntriesButton = ({ state }: { state: PageState }): ReactElement | null =>
  state.newCount ? (
    <button
      type="button"
      className="rs-history-new"
      onClick={() => {
        state.list.current?.scrollTo({ top: state.list.current.scrollHeight, behavior: "smooth" });
        state.setNewCount(0);
      }}
    >
      {state.newCount} new {state.newCount === 1 ? "record" : "records"}
    </button>
  ) : null;

/**
 * Offers a retry after a scoped history read fails.
 */
const RetryStatus = ({ read }: { read: () => Promise<void> }): ReactElement => (
  <p role="alert" className="rs-history-status">
    Could not load history.{" "}
    <button
      type="button"
      onClick={() => {
        void read();
      }}
    >
      Retry
    </button>
  </p>
);

/**
 * Shows loading, retry, empty, and older-page actions.
 */
const PageStatus = ({
  state,
  read,
}: {
  state: PageState;
  read: (older?: boolean) => Promise<void>;
}): ReactElement => (
  <>
    {state.busy && (
      <p role="status" className="rs-history-status">
        Loading…
      </p>
    )}
    {state.error && <RetryStatus read={read} />}
    {state.loaded && state.items.length === 0 && !state.busy && (
      <p className="rs-history-empty">No records yet.</p>
    )}
    {state.cursor && !state.busy && (
      <button
        type="button"
        className="rs-history-older"
        onClick={() => {
          void read(true);
        }}
      >
        Load older
      </button>
    )}
  </>
);

/**
 * Renders loaded audit entries in chronological reading order.
 */
const SectionList = ({
  state,
  read,
  onDetail,
}: {
  state: PageState;
  read: (older?: boolean) => Promise<void>;
  onDetail: SectionProps["onDetail"];
}): ReactElement => (
  <div className="rs-history-list" ref={state.list}>
    <NewEntriesButton state={state} />
    {state.items.toReversed().map((entry) => (
      <HistoryEntry key={historyKey(entry)} entry={entry} onDetail={onDetail} />
    ))}
    <PageStatus state={state} read={read} />
  </div>
);

/**
 * Renders one release's independent audit section.
 *
 * @param release Session release shown by this section.
 * @param expanded Whether the section's records are visible.
 * @param generating Whether this release is currently being written.
 * @param bridge Trusted indexed history reader.
 * @param onToggle Expands or collapses this section.
 * @param onDetail Opens the full content for one entry.
 * @returns A collapsible, paged release history section.
 */
export const HistorySection = ({
  release,
  expanded,
  generating,
  bridge,
  onToggle,
  onDetail,
}: SectionProps): ReactElement => {
  const state = usePageState();
  const read = usePageRead(release, bridge, state);
  useListPosition(state, expanded);
  useOpenRead(expanded, state, read);
  useGenerationRefresh(expanded, generating, state, read);
  return (
    <section className="rs-history-release" aria-label={`${release.title} history`}>
      <SectionHeader
        release={release}
        expanded={expanded}
        onToggle={() => {
          if (expanded && state.anchored.current)
            state.savedTop.current = state.list.current?.scrollTop;
          onToggle();
        }}
      />
      {expanded && <SectionList state={state} read={read} onDetail={onDetail} />}
    </section>
  );
};
