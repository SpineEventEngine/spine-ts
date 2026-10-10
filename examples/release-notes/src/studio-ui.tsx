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

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactElement,
  type SetStateAction,
} from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { BookOpen, FileText, History as HistoryIcon, PenLine } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { StudioIpcErrors } from "./trusted/studio-ipc-errors.js";

interface Evidence {
  readonly commit: string;
  readonly parent: string;
  readonly path: string;
  readonly status: string;
}
interface Comparison {
  readonly selectionId: string;
  readonly base: string;
  readonly target: string;
  readonly commits: readonly { readonly commit: string; readonly subject: string }[];
  readonly changes: readonly { readonly path: string; readonly status: string }[];
  readonly evidence: readonly Evidence[];
}
interface Citation {
  readonly commit: { readonly value: string };
  readonly parent: { readonly value: string };
  readonly path: string;
}
interface Entry {
  readonly text: string;
  readonly evidence: readonly Citation[];
}
interface Section {
  readonly heading: string;
  readonly entries: readonly Entry[];
}
interface Document {
  readonly sections: readonly Section[];
}
interface Draft {
  readonly id: string;
  readonly version: object;
  readonly title: string;
  readonly audience: string;
  readonly comparison: Comparison;
  readonly generationStatus: string;
  readonly document: Document;
  readonly approvalDigest?: string;
}
interface HistoryPage {
  readonly items: readonly unknown[];
  readonly cursor?: string;
}
interface Preview {
  readonly version: object;
  readonly markdown: Uint8Array;
  readonly digest: string;
}

/**
 * Exposes credential-free release editing through the isolated preload.
 */
export interface StudioBridge {
  /**
   * Lists drafts and generation identifiers retained in this in-memory session.
   *
   * @returns Current draft and generation references without credentials.
   */
  session(): Promise<{ drafts: readonly string[]; generations: Readonly<Record<string, string>> }>;

  /**
   * Opens the native repository picker and records a committed comparison.
   *
   * @param base Base Git revision selected by the user.
   * @param target Target Git revision selected by the user.
   * @returns Bounded evidence comparison, or null after cancellation.
   */
  chooseComparison(base: string, target: string): Promise<Comparison | null>;

  /**
   * Reads one recorded committed patch without consulting the worktree.
   *
   * @param selectionId Previously selected comparison identifier.
   * @param index Position in the accepted evidence catalog.
   * @returns Patch text or an explicit unavailability reason.
   */
  evidencePatch(
    selectionId: string,
    index: number,
  ): Promise<{ complete: boolean; patch?: string; reason?: string }>;

  /**
   * Creates a release draft from the recorded comparison and editor metadata.
   *
   * @param selectionId Previously selected comparison identifier.
   * @param title Release title shown in the editor.
   * @param audience Readers for whom the notes are drafted.
   * @returns Authoritative draft state with its framework Version.
   */
  openDraft(selectionId: string, title: string, audience: string): Promise<Draft>;

  /**
   * Reads current draft state together with its framework Version.
   *
   * @param id Release draft identifier.
   * @returns Authoritative draft snapshot.
   */
  readDraft(id: string): Promise<Draft>;

  /**
   * Admits generation for the selected plan model and source comparison.
   *
   * @param id Release draft identifier.
   * @param instruction Optional editor instruction, bounded at ingress.
   * @returns Generation identifier used for status observation.
   */
  generate(id: string, instruction: string): Promise<{ generation: string }>;

  /**
   * Retries the retained generation with its original input and selected model.
   *
   * @param generation Previously submitted generation identifier.
   * @returns Original identifier after the Aggregate receipt is confirmed.
   */
  repeatGeneration(generation: string): Promise<{ generation: string }>;

  /**
   * Reads the indexed Agent execution phase for a generation.
   *
   * @param generation Accepted generation identifier.
   * @returns Known phase or typed input rejection; absent fields mean unresolved admission.
   */
  phase(
    generation: string,
  ): Promise<{ receipt: boolean; phase?: string; rejection?: "inputs-conflict" }>;

  /**
   * Reads one cursor page from a selected Agent history view.
   *
   * @param id Release draft identifier.
   * @param category Full, conversation, system, or domain history.
   * @param pageSize Positive requested page size.
   * @param cursor Optional older-page cursor.
   * @returns Recorded items and optional continuation cursor.
   */
  history(id: string, category: string, pageSize: number, cursor?: string): Promise<HistoryPage>;

  /**
   * Writes edited claims against the Version paired with the displayed document.
   *
   * @param id Release draft identifier.
   * @param version Framework Version of the edited snapshot.
   * @param document Structured release claims and evidence citations.
   * @returns Updated authoritative draft snapshot.
   */
  edit(id: string, version: object, document: Document): Promise<Draft>;

  /**
   * Builds the canonical Markdown bytes for review.
   *
   * @param id Release draft identifier.
   * @returns Bytes, digest, and Version for exact approval.
   */
  preview(id: string): Promise<Preview>;

  /**
   * Records approval of exactly the reviewed Markdown for the current draft Version.
   *
   * @param id Release draft identifier.
   * @param version Framework Version shown with the preview.
   * @param markdown Exact reviewed Markdown bytes.
   * @returns Draft snapshot containing the approval digest.
   */
  approve(id: string, version: object, markdown: Uint8Array): Promise<Draft>;

  /**
   * Prepares the approved bytes and opens a native save dialog.
   *
   * @param id Release draft identifier.
   * @param version Current approved draft Version.
   * @returns Whether exact approved bytes reached the selected destination.
   */
  exportApproved(id: string, version: object): Promise<{ saved: boolean }>;

  /**
   * Stops the in-memory Bounded Context and quits the desktop process.
   *
   * @returns Completion after shutdown starts.
   */
  stopAndQuit(): Promise<void>;
}

type Update = (document: Document) => void;
const citation = (evidence: Evidence): Citation => ({
  commit: { value: evidence.commit },
  parent: { value: evidence.parent },
  path: evidence.path,
});
const emptySection = (): Section => ({ heading: "Changes", entries: [] });
const changeLabel = (status: string): string => {
  if (status.startsWith("R")) return "Renamed";
  if (status.startsWith("C")) return "Copied";
  return (
    ({ A: "Added", M: "Modified", D: "Deleted", T: "Type changed" } as Record<string, string>)[
      status
    ] ?? "Changed"
  );
};

const EvidenceSummary = ({ comparison }: { comparison: Comparison }) => (
  <>
    <p>
      From {comparison.base.slice(0, 8)} → {comparison.target.slice(0, 8)}
    </p>
    <ul>
      {comparison.commits.map((item) => (
        <li key={item.commit}>
          <span title={item.commit}>{item.commit.slice(0, 8)}</span> — {item.subject}
        </li>
      ))}
    </ul>
    <ul>
      {comparison.changes.map((item) => (
        <li key={`${item.status}:${item.path}`}>
          {changeLabel(item.status)} {item.path}
        </li>
      ))}
    </ul>
  </>
);

const EvidencePicker = ({
  evidence,
  select,
}: {
  evidence: readonly Evidence[];
  select: (index: number) => void;
}) => (
  <label>
    Choose a change to inspect
    <select
      defaultValue=""
      onChange={(event) => {
        const index = Number(event.target.value);
        if (Number.isInteger(index)) select(index);
      }}
    >
      <option value="">Select a change</option>
      {evidence.map((item, index) => (
        <option key={index} value={index}>
          {item.commit.slice(0, 8)} {changeLabel(item.status)} {item.path}
        </option>
      ))}
    </select>
  </label>
);

const useEvidencePatch = (comparison: Comparison) => {
  const [patch, setPatch] = useState("");
  const [notice, setNotice] = useState("");
  const selectedPatch = useRef(0);
  const select = (index: number) => {
    const request = ++selectedPatch.current;
    setPatch("");
    setNotice("");
    void window.releaseNotes
      .evidencePatch(comparison.selectionId, index)
      .then((result) => {
        if (request !== selectedPatch.current) return;
        setPatch(result.complete ? (result.patch ?? "") : "");
        setNotice(result.complete ? "" : "This change cannot be shown here.");
      })
      .catch(() => {
        if (request !== selectedPatch.current) return;
        setNotice("This committed patch is unavailable.");
      });
  };
  return { patch, notice, select };
};

const EvidencePanel = ({ comparison }: { comparison: Comparison }) => {
  const evidence = useEvidencePatch(comparison);
  return (
    <section className="sources-panel" aria-label="Sources and changes">
      <p className="eyebrow">Committed changes</p>
      <h2>Sources and changes</h2>
      <p className="supporting-copy">Use these changes to check the wording in your notes.</p>
      <EvidenceSummary comparison={comparison} />
      <EvidencePicker evidence={comparison.evidence} select={evidence.select} />
      {evidence.notice && <p role="status">{evidence.notice}</p>}
      {evidence.patch && (
        <pre className="source-patch" aria-label="Change details">
          {evidence.patch}
        </pre>
      )}
    </section>
  );
};

interface EntryEditorProps {
  entry: Entry;
  evidence: readonly Evidence[];
  update: (entry: Entry) => void;
  remove: () => void;
}

const CitationPicker = ({ entry, evidence, update }: Omit<EntryEditorProps, "remove">) => (
  <label>
    Sources for this entry
    <select
      multiple
      value={entry.evidence.map((item) =>
        evidence
          .findIndex(
            (candidate) =>
              candidate.commit === item.commit.value &&
              candidate.parent === item.parent.value &&
              candidate.path === item.path,
          )
          .toString(),
      )}
      onChange={(event) => {
        update({
          ...entry,
          evidence: [...event.target.selectedOptions]
            .map((option) => evidence[Number(option.value)])
            .filter((item): item is Evidence => item !== undefined)
            .map(citation),
        });
      }}
    >
      {evidence.map((item, index) => (
        <option key={index} value={index}>
          {item.commit.slice(0, 12)} {item.path}
        </option>
      ))}
    </select>
  </label>
);

const EntryEditor = ({ entry, evidence, update, remove }: EntryEditorProps) => (
  <div className="entry">
    <label>
      Entry
      <textarea
        value={entry.text}
        maxLength={2000}
        onChange={(event) => {
          update({ ...entry, text: event.target.value });
        }}
      />
    </label>
    <CitationPicker entry={entry} evidence={evidence} update={update} />
    <button type="button" onClick={remove}>
      Remove entry
    </button>
  </div>
);

const DocumentChanges = {
  /**
   * Replaces one section without mutating the displayed document.
   *
   * @param document Document paired with the editor Version.
   * @param position Position of the section being edited.
   * @param section Updated section value.
   * @returns New document with the selected section replaced.
   */
  section(document: Document, position: number, section: Section): Document {
    return {
      sections: document.sections.map((item, index) => (index === position ? section : item)),
    };
  },

  /**
   * Replaces one claim while keeping other sections and claims intact.
   *
   * @param document Document paired with the editor Version.
   * @param sectionIndex Section containing the claim.
   * @param entryIndex Claim position within that section.
   * @param next Updated claim with its citations.
   * @returns New document with the edited claim.
   */
  entry(document: Document, sectionIndex: number, entryIndex: number, next: Entry): Document {
    const section = document.sections[sectionIndex];
    if (!section) return document;
    return this.section(document, sectionIndex, {
      ...section,
      entries: section.entries.map((item, index) => (index === entryIndex ? next : item)),
    });
  },

  /**
   * Removes one claim from a copied document.
   *
   * @param document Document paired with the editor Version.
   * @param sectionIndex Section containing the claim.
   * @param entryIndex Claim position within that section.
   * @returns New document without the selected claim.
   */
  removeEntry(document: Document, sectionIndex: number, entryIndex: number): Document {
    const section = document.sections[sectionIndex];
    if (!section) return document;
    return this.section(document, sectionIndex, {
      ...section,
      entries: section.entries.filter((_, index) => index !== entryIndex),
    });
  },
};

interface SectionEditorProps {
  document: Document;
  section: Section;
  index: number;
  evidence: readonly Evidence[];
  update: Update;
}

const SectionClaims = ({ document, section, index, evidence, update }: SectionEditorProps) => (
  <>
    {section.entries.map((entry, position) => (
      <EntryEditor
        key={position}
        entry={entry}
        evidence={evidence}
        update={(next) => {
          update(DocumentChanges.entry(document, index, position, next));
        }}
        remove={() => {
          update(DocumentChanges.removeEntry(document, index, position));
        }}
      />
    ))}
  </>
);

const SectionHeading = ({ document, section, index, update }: SectionEditorProps) => (
  <label>
    Section title
    <input
      value={section.heading}
      maxLength={120}
      onChange={(event) => {
        update(
          DocumentChanges.section(document, index, { ...section, heading: event.target.value }),
        );
      }}
    />
  </label>
);

const SectionButtons = ({ document, section, index, update }: SectionEditorProps) => (
  <>
    <button
      type="button"
      onClick={() => {
        update(
          DocumentChanges.section(document, index, {
            ...section,
            entries: [...section.entries, { text: "", evidence: [] }],
          }),
        );
      }}
    >
      Add entry
    </button>
    <button
      type="button"
      onClick={() => {
        update({ sections: document.sections.filter((_, position) => position !== index) });
      }}
    >
      Remove section
    </button>
  </>
);

const SectionEditor = (props: SectionEditorProps) => {
  return (
    <div className="section-editor">
      <SectionHeading {...props} />
      <SectionClaims {...props} />
      <SectionButtons {...props} />
    </div>
  );
};

const DocumentEditor = ({
  document,
  evidence,
  update,
}: {
  document: Document;
  evidence: readonly Evidence[];
  update: Update;
}) => (
  <section aria-label="Release notes">
    {document.sections.map((section, index) => (
      <SectionEditor
        key={index}
        document={document}
        section={section}
        index={index}
        evidence={evidence}
        update={update}
      />
    ))}
    <button
      type="button"
      onClick={() => {
        update({ sections: [...document.sections, emptySection()] });
      }}
    >
      Add section
    </button>
  </section>
);

const historyDescriptions: Record<string, { kind: string; content: string }> = {
  GenerationRequest: {
    kind: "Writing requested",
    content: "A draft was requested for these changes.",
  },
  GenerationResponse: { kind: "Writing response", content: "A draft response was received." },
  ToolRequest: { kind: "Source lookup", content: "Checking a committed change." },
  ToolResponse: { kind: "Source lookup", content: "A source lookup response was recorded." },
  AgentToolCallStarted: { kind: "Source lookup", content: "Checking a committed change." },
  AgentToolCallFinished: { kind: "Source lookup", content: "A source lookup finished." },
  AgentInvocationTerminated: { kind: "Writing stopped", content: "The draft was not completed." },
  AgentAiOperationFailed: { kind: "Writing stopped", content: "The writing step did not finish." },
  ReleaseNotesProposed: {
    kind: "Notes proposed",
    content: "Proposed notes were returned for review.",
  },
  ReleaseGenerationFailed: { kind: "Writing stopped", content: "No new notes were saved." },
};

const historyRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const responseDetail = (content: Record<string, unknown>): string | undefined => {
  if (typeof content.rawOutput !== "string") return undefined;
  try {
    const output = historyRecord(JSON.parse(content.rawOutput));
    const sections = output.sections;
    if (!Array.isArray(sections)) return undefined;
    const count = sections.reduce<number>((total, section) => {
      const entries = historyRecord(section).entries;
      return total + (Array.isArray(entries) ? entries.length : 0);
    }, 0);
    return `Proposed ${String(sections.length)} ${sections.length === 1 ? "section" : "sections"} with ${String(count)} ${count === 1 ? "entry" : "entries"}.`;
  } catch {
    return undefined;
  }
};

const History = {
  /**
   * Describes a recorded model, tool, or domain item for the history list.
   *
   * @param value Recorded history item encoded for the renderer.
   * @param category Current history view.
   * @returns Human-readable kind, occurrence time, and content type.
   */
  label(value: unknown, category: string): { kind: string; time: string; content: string } {
    const row = historyRecord(value);
    const record = historyRecord(
      row.conversationRecord ?? row.systemEvent ?? row.domainEvent ?? row,
    );
    const content = historyRecord(record.content ?? record.message);
    const url = typeof content["@type"] === "string" ? content["@type"] : "";
    const type = url.split(/[./]/).at(-1) ?? "";
    const description = historyDescriptions[type] ?? {
      kind:
        category === "conversation" || row.conversationRecord
          ? "Writing exchange"
          : category === "system" || row.systemEvent
            ? "Progress update"
            : "Draft update",
      content: "A release activity was recorded.",
    };
    const context = historyRecord(record.context);
    const occurred = row.occurredAt ?? record.occurredAt ?? context.timestamp;
    const time =
      typeof occurred === "string" && !Number.isNaN(Date.parse(occurred))
        ? new Date(occurred).toLocaleString()
        : "";
    return {
      kind: description.kind,
      time,
      content:
        type === "GenerationResponse"
          ? (responseDetail(content) ?? description.content)
          : description.content,
    };
  },
};

const HistoryRecords = ({ items, category }: { items: readonly unknown[]; category: string }) => (
  <ol className="activity-list">
    {items.map((item, index) => {
      const label = History.label(item, category);
      return (
        <li key={index}>
          <span className="activity-dot" aria-hidden="true" />
          <div>
            <strong>{label.kind}</strong>
            {label.time && <time> · {label.time}</time>}
            {label.content && <p>{label.content}</p>}
          </div>
        </li>
      );
    })}
  </ol>
);

const HistoryView = ({
  category,
  select,
}: {
  category: string;
  select: (value: string) => void;
}) => (
  <label>
    View
    <select
      value={category}
      onChange={(event) => {
        select(event.target.value);
      }}
    >
      {(["all", "conversation", "system", "domain"] as const).map((value) => (
        <option key={value} value={value}>
          {
            {
              all: "Everything",
              conversation: "Writing",
              system: "Progress",
              domain: "Draft changes",
            }[value]
          }
        </option>
      ))}
    </select>
  </label>
);

interface HistoryPageState {
  id: string;
  category: string;
  revision: number;
  cursor: string | undefined;
  pending: string | undefined;
}

const historyState = (id: string, category: string, revision: number): HistoryPageState => ({
  id,
  category,
  revision,
  cursor: undefined,
  pending: undefined,
});

const readHistoryPage = async (
  state: { current: HistoryPageState },
  next: string | undefined,
  setItems: Dispatch<SetStateAction<readonly unknown[]>>,
  setCursor: Dispatch<SetStateAction<string | undefined>>,
  setNotice: Dispatch<SetStateAction<string>>,
): Promise<void> => {
  const view = state.current;
  if (next && (next !== view.cursor || view.pending === next)) return;
  if (next) view.pending = next;
  else {
    view.revision++;
    view.cursor = undefined;
    view.pending = undefined;
  }
  const revision = view.revision;
  try {
    const page = await window.releaseNotes.history(view.id, view.category, 20, next);
    if (state.current !== view || view.revision !== revision) return;
    setItems((current) => (next ? [...current, ...page.items] : page.items));
    view.cursor = page.cursor;
    setCursor(page.cursor);
    setNotice("");
  } catch {
    if (state.current === view && view.revision === revision)
      setNotice("This history view is unavailable.");
  } finally {
    if (state.current === view && view.pending === next) view.pending = undefined;
  }
};

const useHistoryPage = (id: string) => {
  const [category, setCategory] = useState("all");
  const [items, setItems] = useState<readonly unknown[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [notice, setNotice] = useState("");
  const state = useRef<HistoryPageState>(historyState(id, "all", 0));
  useEffect(
    () => () => {
      state.current.revision++;
    },
    [id],
  );
  return {
    category,
    items,
    cursor,
    notice,
    load: (next?: string) => readHistoryPage(state, next, setItems, setCursor, setNotice),
    select: (value: string) => {
      state.current = historyState(id, value, state.current.revision + 1);
      setCategory(value);
      setItems([]);
      setCursor(undefined);
      setNotice("");
    },
  };
};

const HistoryPanel = ({ id }: { id: string }) => {
  const history = useHistoryPage(id);
  return (
    <section className="activity-panel" aria-label="Activity">
      <p className="eyebrow">What happened</p>
      <h2>Activity</h2>
      <HistoryView category={history.category} select={history.select} />
      <button type="button" onClick={() => void history.load()}>
        Load activity
      </button>
      <HistoryRecords items={history.items} category={history.category} />
      {history.cursor && (
        <button type="button" onClick={() => void history.load(history.cursor)}>
          Earlier activity
        </button>
      )}
      {history.notice && <p role="status">{history.notice}</p>}
      {history.items.length === 0 && !history.notice && (
        <p className="empty-note">No activity in this view yet.</p>
      )}
    </section>
  );
};

const GenerationPolling = {
  /**
   * Updates generation status without rebasing unsaved edits onto a newer Version.
   *
   * @param draft Draft displayed by the editor.
   * @param generation Accepted generation identifier.
   * @param dirty Whether local edits remain unsaved.
   * @param latestVersion Last authoritative Version observed by polling.
   * @param onDraft Applies a fresh snapshot when no local edit is pending.
   * @param onNotice Reports that an explicit reread is required.
   * @param onPhase Updates the visible Agent execution phase.
   * @param active Checks whether this polling effect remains mounted.
   * @returns Completion after one trusted status and draft read.
   */
  async refresh(
    draft: Draft,
    generation: string,
    dirty: boolean,
    latestVersion: { current: string },
    onDraft: (value: Draft) => void,
    onNotice: (value: string) => void,
    onPhase: (value: string) => void,
    active: () => boolean,
  ): Promise<void> {
    let phaseReceived = false;
    try {
      const observedVersion = latestVersion.current;
      const result = await window.releaseNotes.phase(generation);
      if (!active()) return;
      phaseReceived = true;
      onPhase(
        result.rejection ? "rejected" : (result.phase ?? (result.receipt ? "accepted" : "unknown")),
      );
      const current = await window.releaseNotes.readDraft(draft.id);
      if (!active()) return;
      if (latestVersion.current !== observedVersion) return;
      if (JSON.stringify(current.version) === latestVersion.current) return;
      latestVersion.current = JSON.stringify(current.version);
      if (dirty)
        onNotice("The draft changed while you were editing. Read the current draft before saving.");
      else onDraft(current);
    } catch {
      if (active() && !phaseReceived) onPhase("unknown");
    }
  },
};

const startGenerationPolling = (
  draft: Draft,
  generation: string,
  dirty: boolean,
  latestVersion: { current: string },
  onDraft: (value: Draft) => void,
  onNotice: (value: string) => void,
  onPhase: (value: string) => void,
): (() => void) => {
  let active = true;
  let inFlight = false;
  const refresh = () => {
    if (inFlight) return;
    inFlight = true;
    void GenerationPolling.refresh(
      draft,
      generation,
      dirty,
      latestVersion,
      onDraft,
      onNotice,
      onPhase,
      () => active,
    ).finally(() => {
      inFlight = false;
    });
  };
  refresh();
  const timer = setInterval(refresh, 1500);
  return () => {
    active = false;
    clearInterval(timer);
  };
};

const useGenerationStatus = (
  draft: Draft,
  generation: string | undefined,
  dirty: boolean,
  latestVersion: { current: string },
  onDraft: (value: Draft) => void,
  onNotice: (value: string) => void,
) => {
  const [phase, setPhase] = useState<string>();
  useEffect(
    () =>
      generation
        ? startGenerationPolling(
            draft,
            generation,
            dirty,
            latestVersion,
            onDraft,
            onNotice,
            setPhase,
          )
        : undefined,
    [draft.id, generation, dirty],
  );
  return { phase, setPhase };
};

const useEditorSynchronization = (
  draft: Draft,
  dirty: boolean,
  setDocument: Dispatch<SetStateAction<Document>>,
  setPreview: Dispatch<SetStateAction<Preview | undefined>>,
) => {
  const editVersion = useRef(0);
  const latestVersion = useRef(JSON.stringify(draft.version));
  const baseVersion = useRef(draft.version);
  const synchronizedDraft = useRef(draft);
  useEffect(() => {
    if (synchronizedDraft.current === draft) return;
    synchronizedDraft.current = draft;
    editVersion.current += 1;
    latestVersion.current = JSON.stringify(draft.version);
    if (!dirty) {
      baseVersion.current = draft.version;
      setDocument(draft.document);
    }
    setPreview(undefined);
  }, [draft]);
  return { editVersion, latestVersion, baseVersion };
};

const useDraftEditor = (draft: Draft) => {
  const [document, setDocument] = useState<Document>(draft.document);
  const [preview, setPreview] = useState<Preview>();
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const pendingSave = useRef(false);
  const { editVersion, latestVersion, baseVersion } = useEditorSynchronization(
    draft,
    dirty,
    setDocument,
    setPreview,
  );
  const update = (next: Document) => {
    editVersion.current += 1;
    setDocument(next);
    setDirty(true);
    setPreview(undefined);
  };
  return {
    document,
    preview,
    dirty,
    saving,
    pendingSave,
    editVersion,
    baseVersion,
    latestVersion,
    setPreview,
    setDirty,
    setSaving,
    update,
  };
};

interface DraftPanelProps {
  draft: Draft;
  setDraft: (value: Draft) => void;
  generation: string | undefined;
  setGeneration: (value: string) => void;
  isCurrent: () => boolean;
  modelReady: boolean;
  notice: (value: string) => void;
}

interface GenerationActionsProps {
  draft: Draft;
  generation: string | undefined;
  phase: string | undefined;
  modelReady: boolean;
  instruction: string;
  setInstruction: (value: string) => void;
  generate: () => void;
  repeat: () => void;
  reread: () => void;
}

const GenerationInstruction = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) => (
  <label>
    What should readers know?
    <textarea
      value={value}
      maxLength={2000}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    />
  </label>
);

const GenerationActions = (props: GenerationActionsProps) => (
  <div className="generation-actions">
    <GenerationInstruction value={props.instruction} onChange={props.setInstruction} />
    <button
      className="primary-button"
      type="button"
      disabled={
        !props.modelReady ||
        (props.generation !== undefined &&
          props.phase !== "completed" &&
          props.phase !== "terminated" &&
          props.phase !== "rejected")
      }
      onClick={props.generate}
    >
      Write a draft
    </button>
    {!props.modelReady && (
      <p className="field-hint">Connect your account and choose a model to write.</p>
    )}
    {props.generation !== undefined && props.phase === "unknown" && (
      <RetryAdmission onRetry={props.repeat} />
    )}
    <button className="text-button" type="button" onClick={props.reread}>
      Refresh draft
    </button>
  </div>
);

const RetryAdmission = ({ onRetry }: { onRetry: () => void }) => (
  <>
    <button type="button" onClick={onRetry}>
      Retry saved draft
    </button>
    <p>This retries the same draft with its original instructions and selected changes.</p>
  </>
);

const phaseLabel = (phase: string | undefined, draft: Draft): string => {
  if (phase === "rejected") return "Needs attention";
  if (phase === "terminated") return "Stopped";
  if (phase === "unknown") return "Checking status";
  if (phase === "accepted" || phase === "active" || phase === "completed-pending-delivery")
    return "Writing";
  if (draft.generationStatus.startsWith("failed:")) return "Needs attention";
  if (draft.approvalDigest) return "Approved";
  if (draft.document.sections.length > 0) return "Draft ready";
  if (phase === "completed") return "Writing finished";
  return "Ready to write";
};

const failureAdvice: Readonly<Record<string, string>> = {
  AUTHENTICATION_REQUIRED: "Check your account and selected model, then try again.",
  UNSUPPORTED_CAPABILITY: "Check your account and selected model, then try again.",
  BUDGET_EXCEEDED: "This draft contains too much work at once. Choose fewer changes and try again.",
  RATE_LIMITED: "This draft hit a usage limit. Wait a little before trying again.",
  INVALID_OUTPUT: "The draft could not be completed. Review the changes and try again.",
  REFUSED: "The draft could not be completed. Review the changes and try again.",
  UNAVAILABLE: "OpenAI is unavailable right now. Refresh the draft, then try again.",
  DEADLINE_EXCEEDED: "Writing took too long. Refresh the draft before trying again.",
  TOOL_FAILED:
    "A source lookup could not be confirmed. Check the current draft before trying again.",
  TOOL_OUTCOME_UNKNOWN:
    "A source lookup could not be confirmed. Check the current draft before trying again.",
};

const generationAdvice = (phase: string | undefined, draft: Draft): string | undefined => {
  if (phase === "unknown")
    return "Writing status is uncertain. Refresh the draft before trying again.";
  if (phase === "rejected")
    return "The draft changed before writing began. Refresh it and try again.";
  if (phase === "terminated")
    return "Writing stopped. Check your account and model, then refresh the draft.";
  if (phase === "accepted" || phase === "active" || phase === "completed-pending-delivery") return;
  if (!draft.generationStatus.startsWith("failed:")) return;
  const code = draft.generationStatus.slice("failed:".length);
  return (
    failureAdvice[code] ?? "Writing could not finish. Review the current draft before trying again."
  );
};

const GenerationSection = (props: GenerationActionsProps) => (
  <section className="draft-heading" aria-label="Release draft">
    <div className="draft-heading-row">
      <div>
        <p className="eyebrow">Release draft · {props.draft.audience}</p>
        <h2>{props.draft.title}</h2>
      </div>
      <span className="status-pill" role="status">
        {phaseLabel(props.phase, props.draft)}
      </span>
    </div>
    <p className="disclosure">
      Selected changes and your instructions are sent to OpenAI when you write a draft. Your drafts
      and activity disappear when you quit.
    </p>
    {generationAdvice(props.phase, props.draft) && (
      <p className="field-hint">{generationAdvice(props.phase, props.draft)}</p>
    )}
    <GenerationActions {...props} />
  </section>
);

interface ReviewProps {
  draft: Draft;
  document: Document;
  preview: Preview | undefined;
  dirty: boolean;
  save: () => void;
  makePreview: () => void;
  approve: () => void;
  exportFile: () => void;
}

const PreviewBox = ({ preview, approve }: { preview: Preview; approve: () => void }) => (
  <>
    <article className="rendered-preview" aria-label="Release notes preview">
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
        {new TextDecoder().decode(preview.markdown)}
      </ReactMarkdown>
    </article>
    <details className="export-text">
      <summary>Show export text</summary>
      <pre>{new TextDecoder().decode(preview.markdown)}</pre>
    </details>
    <button type="button" onClick={approve}>
      Approve release notes
    </button>
  </>
);

const ReviewSection = (props: ReviewProps) => (
  <section className="review-panel" aria-label="Preview and export">
    <h2>Preview your release notes</h2>
    <p>Review the final wording before approving it for export.</p>
    <button type="button" disabled={props.dirty} onClick={props.makePreview}>
      Refresh preview
    </button>
    {props.dirty && <p className="field-hint">Save your edits before previewing or exporting.</p>}
    {props.preview && !props.dirty && (
      <PreviewBox preview={props.preview} approve={props.approve} />
    )}
    {!props.preview && <p className="empty-note">Your preview will appear here.</p>}
    <button
      type="button"
      disabled={props.dirty || !props.draft.approvalDigest}
      onClick={props.exportFile}
    >
      Export release notes
    </button>
  </section>
);

const useDraftRun =
  (onNotice: (value: string) => void): RunAction =>
  (action) => {
    onNotice("");
    void action().catch((error: unknown) => {
      onNotice(
        StudioIpcErrors.display(
          error,
          "The draft action is unconfirmed. Read the current draft before another action.",
        ),
      );
    });
  };

const submitGeneration = async (
  props: DraftPanelProps,
  instruction: string,
  onPhase: (value: string) => void,
): Promise<void> => {
  try {
    const result = await window.releaseNotes.generate(props.draft.id, instruction);
    if (!props.isCurrent()) return;
    props.setGeneration(result.generation);
    onPhase("accepted");
  } catch (error) {
    if (!props.isCurrent()) return;
    const retained = (await window.releaseNotes.session()).generations[props.draft.id];
    if (!props.isCurrent()) return;
    if (retained && retained !== props.generation) {
      props.setGeneration(retained);
      const observed = await window.releaseNotes.phase(retained).catch(() => undefined);
      if (!props.isCurrent()) return;
      onPhase(
        observed?.rejection
          ? "rejected"
          : (observed?.phase ?? (observed?.receipt ? "accepted" : "unknown")),
      );
    }
    throw error;
  }
};

const refreshDraft = async (props: DraftPanelProps, editor: ReturnType<typeof useDraftEditor>) => {
  const startedAt = editor.editVersion.current;
  const current = await window.releaseNotes.readDraft(props.draft.id);
  if (!props.isCurrent()) return;
  if (editor.editVersion.current !== startedAt) {
    props.notice("Your newer edits are still here. Save or copy them before refreshing again.");
    return;
  }
  editor.setDirty(false);
  props.setDraft(current);
};

const generationButtons = (
  props: DraftPanelProps,
  instruction: string,
  onPhase: (value: string) => void,
  editor: ReturnType<typeof useDraftEditor>,
  run: RunAction,
) => ({
  generate: () => {
    run(() => submitGeneration(props, instruction, onPhase));
  },
  repeat: () => {
    const generation = props.generation;
    if (!generation) return;
    run(async () => {
      const result = await window.releaseNotes.repeatGeneration(generation);
      if (!props.isCurrent()) return;
      props.setGeneration(result.generation);
      onPhase("accepted");
    });
  },
  reread: () => {
    run(() => refreshDraft(props, editor));
  },
});

const saveDraft = async (props: DraftPanelProps, editor: ReturnType<typeof useDraftEditor>) => {
  try {
    const startedAt = editor.editVersion.current;
    const saved = await window.releaseNotes.edit(
      props.draft.id,
      editor.baseVersion.current,
      editor.document,
    );
    if (props.isCurrent()) {
      editor.baseVersion.current = saved.version;
      if (editor.editVersion.current === startedAt) editor.setDirty(false);
      props.setDraft(saved);
    }
  } finally {
    editor.pendingSave.current = false;
    editor.setSaving(false);
  }
};

const reviewEditButtons = (
  props: DraftPanelProps,
  editor: ReturnType<typeof useDraftEditor>,
  run: RunAction,
) => ({
  save: () => {
    if (!editor.dirty || editor.pendingSave.current) return;
    editor.pendingSave.current = true;
    editor.setSaving(true);
    run(() => saveDraft(props, editor));
  },
  makePreview: () => {
    run(async () => {
      if (editor.dirty) return;
      const startedAt = editor.editVersion.current;
      const preview = await window.releaseNotes.preview(props.draft.id);
      if (props.isCurrent() && editor.editVersion.current === startedAt) editor.setPreview(preview);
    });
  },
});

const reviewApprovalButtons = (
  props: DraftPanelProps,
  editor: ReturnType<typeof useDraftEditor>,
  run: RunAction,
) => ({
  approve: () => {
    run(async () => {
      if (!editor.preview || editor.dirty) return;
      const approved = await window.releaseNotes.approve(
        props.draft.id,
        editor.preview.version,
        editor.preview.markdown,
      );
      if (props.isCurrent()) props.setDraft(approved);
    });
  },
  exportFile: () => {
    run(async () => {
      if (editor.dirty) return;
      const result = await window.releaseNotes.exportApproved(props.draft.id, props.draft.version);
      if (!props.isCurrent()) return;
      if (result.saved) {
        const current = await window.releaseNotes.readDraft(props.draft.id);
        if (!props.isCurrent()) return;
        props.setDraft(current);
      }
      props.notice(
        result.saved ? "Approved Markdown exported." : "Export cancelled; no file was written.",
      );
    });
  },
});

const reviewButtons = (
  props: DraftPanelProps,
  editor: ReturnType<typeof useDraftEditor>,
  run: RunAction,
) => ({ ...reviewEditButtons(props, editor, run), ...reviewApprovalButtons(props, editor, run) });

interface DraftPanelViewProps {
  draft: Draft;
  generation: string | undefined;
  phase: string | undefined;
  modelReady: boolean;
  instruction: string;
  setInstruction: (value: string) => void;
  editor: ReturnType<typeof useDraftEditor>;
  generationActions: ReturnType<typeof generationButtons>;
  reviewActions: ReturnType<typeof reviewButtons>;
}

const workspaceTabs = [
  { value: "write", label: "Write", Icon: PenLine },
  { value: "sources", label: "Sources", Icon: BookOpen },
  { value: "preview", label: "Preview", Icon: FileText },
  { value: "activity", label: "Activity", Icon: HistoryIcon },
] as const;

const WorkspaceTabList = () => (
  <Tabs.List className="workspace-tab-list" aria-label="Draft workspace">
    {workspaceTabs.map(({ value, label, Icon }) => (
      <Tabs.Trigger className="workspace-tab" key={value} value={value}>
        <Icon aria-hidden="true" size={17} /> {label}
      </Tabs.Trigger>
    ))}
  </Tabs.List>
);

const WritingTab = ({
  draft,
  editor,
  save,
}: {
  draft: Draft;
  editor: ReturnType<typeof useDraftEditor>;
  save: () => void;
}) => (
  <Tabs.Content className="workspace-tab-panel" value="write" forceMount>
    <div className="panel-heading">
      <div>
        <p className="eyebrow">Your draft</p>
        <h2>Edit entries</h2>
      </div>
      <button
        className="primary-button"
        type="button"
        disabled={!editor.dirty || editor.saving}
        onClick={save}
      >
        {editor.saving ? "Saving edits…" : "Save edits"}
      </button>
    </div>
    <DocumentEditor
      document={editor.document}
      evidence={draft.comparison.evidence}
      update={editor.update}
    />
  </Tabs.Content>
);

const DraftWorkspace = ({
  draft,
  editor,
  reviewActions,
}: Pick<DraftPanelViewProps, "draft" | "editor" | "reviewActions">) => (
  <Tabs.Root className="workspace-tabs" defaultValue="write">
    <WorkspaceTabList />
    <WritingTab draft={draft} editor={editor} save={reviewActions.save} />
    <Tabs.Content className="workspace-tab-panel" value="sources" forceMount>
      <EvidencePanel comparison={draft.comparison} />
    </Tabs.Content>
    <Tabs.Content className="workspace-tab-panel" value="preview" forceMount>
      <ReviewSection
        draft={draft}
        document={editor.document}
        preview={editor.preview}
        dirty={editor.dirty}
        {...reviewActions}
      />
    </Tabs.Content>
    <Tabs.Content className="workspace-tab-panel" value="activity" forceMount>
      <HistoryPanel id={draft.id} />
    </Tabs.Content>
  </Tabs.Root>
);

const DraftPanelView = ({
  draft,
  generation,
  phase,
  modelReady,
  instruction,
  setInstruction,
  editor,
  generationActions,
  reviewActions,
}: DraftPanelViewProps) => (
  <div className="draft-workspace">
    <GenerationSection
      draft={draft}
      generation={generation}
      phase={phase}
      modelReady={modelReady}
      instruction={instruction}
      setInstruction={setInstruction}
      {...generationActions}
    />
    <DraftWorkspace draft={draft} editor={editor} reviewActions={reviewActions} />
  </div>
);

const DraftPanel = (props: DraftPanelProps) => {
  const { draft, generation, modelReady, notice } = props;
  const [instruction, setInstruction] = useState("");
  const editor = useDraftEditor(draft);
  const { phase, setPhase } = useGenerationStatus(
    draft,
    generation,
    editor.dirty,
    editor.latestVersion,
    props.setDraft,
    notice,
  );
  const run = useDraftRun(notice);
  const generationActions = generationButtons(props, instruction, setPhase, editor, run);
  const reviewActions = reviewButtons(props, editor, run);
  return (
    <DraftPanelView
      draft={draft}
      generation={generation}
      phase={phase}
      modelReady={modelReady}
      instruction={instruction}
      setInstruction={setInstruction}
      editor={editor}
      generationActions={generationActions}
      reviewActions={reviewActions}
    />
  );
};

type RunAction = (action: () => Promise<void>) => void;

const useInitialDraftSession = (
  onNotice: (value: string) => void,
  selectionVersion: { current: number },
  setDraft: Dispatch<SetStateAction<Draft | undefined>>,
  setTitles: Dispatch<SetStateAction<Readonly<Record<string, string>>>>,
  setGeneration: Dispatch<SetStateAction<string | undefined>>,
) => {
  useEffect(() => {
    let live = true;
    void window.releaseNotes
      .session()
      .then(async (session) => {
        const drafts = await Promise.all(
          session.drafts.map((id) => window.releaseNotes.readDraft(id)),
        );
        if (!live) return;
        setTitles((current) => ({
          ...Object.fromEntries(drafts.map((item) => [item.id, item.title])),
          ...current,
        }));
        const current = drafts.at(-1);
        if (current && selectionVersion.current === 0) {
          setDraft(current);
          setGeneration(session.generations[current.id]);
        }
      })
      .catch(() => {
        if (live) onNotice("Your open drafts could not be loaded. Try refreshing the app.");
      });
    return () => {
      live = false;
    };
  }, []);
};

const useDraftSession = (onNotice: (value: string) => void) => {
  const [draft, setDraft] = useState<Draft>();
  const [titles, setTitles] = useState<Readonly<Record<string, string>>>({});
  const [generation, setGeneration] = useState<string>();
  const selectionVersion = useRef(0);
  useInitialDraftSession(onNotice, selectionVersion, setDraft, setTitles, setGeneration);
  const open = (value: Draft) => {
    selectionVersion.current += 1;
    setDraft(value);
    setGeneration(undefined);
    setTitles((current) => ({ ...current, [value.id]: value.title }));
  };
  const beginSelection = () => ++selectionVersion.current;
  const currentSelection = () => selectionVersion.current;
  const isCurrentSelection = (version: number) => selectionVersion.current === version;
  return {
    draft,
    setDraft,
    titles,
    generation,
    setGeneration,
    open,
    beginSelection,
    currentSelection,
    isCurrentSelection,
  };
};

const SessionDraftPicker = ({
  titles,
  selected,
  select,
}: {
  titles: Readonly<Record<string, string>>;
  selected: string;
  select: (id: string) => void;
}) =>
  Object.keys(titles).length > 0 ? (
    <label>
      Session drafts
      <select
        value={selected}
        onChange={(event) => {
          select(event.target.value);
        }}
      >
        <option value="">Select a draft</option>
        {Object.entries(titles).map(([id, title]) => (
          <option key={id} value={id}>
            {title}
          </option>
        ))}
      </select>
    </label>
  ) : null;

const DraftFields = ({
  title,
  audience,
  onTitle,
  onAudience,
}: {
  title: string;
  audience: string;
  onTitle: (value: string) => void;
  onAudience: (value: string) => void;
}) => (
  <>
    <label>
      Release title
      <input
        value={title}
        onChange={(event) => {
          onTitle(event.target.value);
        }}
      />
    </label>
    <label>
      Audience
      <input
        value={audience}
        onChange={(event) => {
          onAudience(event.target.value);
        }}
      />
    </label>
  </>
);

const OpenDraftForm = ({
  comparison,
  run,
  open,
}: {
  comparison: Comparison;
  run: RunAction;
  open: (draft: Draft) => void;
}) => {
  const [title, setTitle] = useState("");
  const [audience, setAudience] = useState("");
  return (
    <>
      <p>
        {comparison.base.slice(0, 8)} → {comparison.target.slice(0, 8)}
      </p>
      <DraftFields title={title} audience={audience} onTitle={setTitle} onAudience={setAudience} />
      <button
        type="button"
        onClick={() => {
          run(async () => {
            open(await window.releaseNotes.openDraft(comparison.selectionId, title, audience));
          });
        }}
      >
        Open release draft
      </button>
    </>
  );
};

const RevisionFields = ({
  base,
  target,
  onBase,
  onTarget,
}: {
  base: string;
  target: string;
  onBase: (value: string) => void;
  onTarget: (value: string) => void;
}) => (
  <>
    <label>
      From
      <input
        value={base}
        onChange={(event) => {
          onBase(event.target.value);
        }}
      />
    </label>
    <label>
      To
      <input
        value={target}
        onChange={(event) => {
          onTarget(event.target.value);
        }}
      />
    </label>
  </>
);

const SelectedDraftPicker = ({
  session,
  run,
}: {
  session: ReturnType<typeof useDraftSession>;
  run: RunAction;
}) => (
  <SessionDraftPicker
    titles={session.titles}
    selected={session.draft?.id ?? ""}
    select={(id) => {
      const selection = session.beginSelection();
      run(async () => {
        const current = await window.releaseNotes.readDraft(id);
        if (!session.isCurrentSelection(selection)) return;
        const active = await window.releaseNotes.session();
        if (!session.isCurrentSelection(selection)) return;
        session.setDraft(current);
        session.setGeneration(active.generations[id]);
      });
    }}
  />
);

const comparisonPolicy =
  "Choose an earlier and later commit. Your notes use committed changes between them; edits you have not committed are not included.";

interface ComparisonControlProps {
  base: string;
  target: string;
  onBase: (value: string) => void;
  onTarget: (value: string) => void;
  comparison: Comparison | undefined;
  choose: (base: string, target: string) => Promise<void>;
  run: RunAction;
  open: (draft: Draft) => void;
}

const ComparisonControls = ({
  base,
  target,
  onBase,
  onTarget,
  comparison,
  choose,
  run,
  open,
}: ComparisonControlProps) => (
  <>
    <RevisionFields base={base} target={target} onBase={onBase} onTarget={onTarget} />
    <p className="field-hint">{comparisonPolicy}</p>
    <button
      className="secondary-button"
      type="button"
      onClick={() => {
        run(async () => {
          await choose(base, target);
        });
      }}
    >
      Choose repository
    </button>
    {comparison && <OpenDraftForm comparison={comparison} run={run} open={open} />}
  </>
);

const ComparisonPanelView = ({
  session,
  run,
  controls,
}: {
  session: ReturnType<typeof useDraftSession>;
  run: RunAction;
  controls: ReactElement;
}) => (
  <section className="setup-panel" aria-label="Release setup">
    <p className="eyebrow">{session.draft ? "Current release" : "Step 1 · Set up"}</p>
    <h2>{session.draft ? "Your release" : "Choose your changes"}</h2>
    {!session.draft && (
      <p className="supporting-copy">Select a repository and the range you want to describe.</p>
    )}
    <SelectedDraftPicker session={session} run={run} />
    {session.draft ? (
      <details className="comparison-details">
        <summary>Change repository or commits</summary>
        {controls}
      </details>
    ) : (
      controls
    )}
  </section>
);

const useComparisonSelection = () => {
  const [base, setBase] = useState("");
  const [target, setTarget] = useState("HEAD");
  const [comparison, setComparison] = useState<Comparison>();
  const choiceVersion = useRef(0);
  const revise = (onSet: (value: string) => void, value: string) => {
    choiceVersion.current += 1;
    setComparison(undefined);
    onSet(value);
  };
  const choose = async (from: string, to: string) => {
    const startedAt = ++choiceVersion.current;
    const chosen = await window.releaseNotes.chooseComparison(from, to);
    if (chosen && choiceVersion.current === startedAt) setComparison(chosen);
  };
  return { base, target, comparison, revise, choose, setBase, setTarget };
};

const ComparisonPanel = ({
  run,
  open,
  session,
}: {
  run: RunAction;
  open: (draft: Draft) => void;
  session: ReturnType<typeof useDraftSession>;
}) => {
  const { base, target, comparison, revise, choose, setBase, setTarget } = useComparisonSelection();
  const controls = (
    <ComparisonControls
      base={base}
      target={target}
      onBase={(value) => {
        revise(setBase, value);
      }}
      onTarget={(value) => {
        revise(setTarget, value);
      }}
      comparison={comparison}
      choose={choose}
      run={run}
      open={open}
    />
  );
  return <ComparisonPanelView session={session} run={run} controls={controls} />;
};

const useStudioRun =
  (onNotice: (value: string) => void): RunAction =>
  (action) => {
    onNotice("");
    void action().catch((error: unknown) => {
      onNotice(
        StudioIpcErrors.display(
          error,
          "This release action could not be confirmed. Review the current draft.",
        ),
      );
    });
  };

const WelcomePanel = () => (
  <section className="welcome-panel" aria-label="Start a release">
    <p className="eyebrow">Getting started</p>
    <h2>Start with the changes.</h2>
    <p>
      Choose a repository and the commits to cover. Then add a title and audience to open your
      release notes.
    </p>
    <div className="welcome-steps">
      <span>01 · Choose changes</span>
      <span>02 · Write</span>
      <span>03 · Review and export</span>
    </div>
  </section>
);

const selectedDraftCallbacks = (
  session: ReturnType<typeof useDraftSession>,
  onNotice: (value: string) => void,
) => {
  const id = session.draft?.id ?? "";
  const version = session.currentSelection();
  const isCurrent = () => session.isCurrentSelection(version);
  return {
    isCurrent,
    setDraft: (value: Draft) => {
      if (isCurrent() && value.id === id) session.setDraft(value);
    },
    setGeneration: (value: string) => {
      if (isCurrent()) session.setGeneration(value);
    },
    notice: (value: string) => {
      if (isCurrent()) onNotice(value);
    },
  };
};

/**
 * Renders the release editor while credentials and paths remain in the main process.
 *
 * @param modelReady Whether the selected account can generate a draft.
 * @param notice Reports a safe status message to the account panel.
 * @returns Release comparison, editor, and history controls.
 */
export const StudioPanel = ({
  modelReady,
  notice,
}: {
  modelReady: boolean;
  notice: (value: string) => void;
}): ReactElement => {
  const session = useDraftSession(notice);
  const run = useStudioRun(notice);
  const callbacks = selectedDraftCallbacks(session, notice);
  return (
    <div className="studio-layout">
      <ComparisonPanel run={run} open={session.open} session={session} />
      {session.draft ? (
        <DraftPanel
          key={session.draft.id}
          draft={session.draft}
          setDraft={callbacks.setDraft}
          generation={session.generation}
          setGeneration={callbacks.setGeneration}
          isCurrent={callbacks.isCurrent}
          modelReady={modelReady}
          notice={callbacks.notice}
        />
      ) : (
        <WelcomePanel />
      )}
    </div>
  );
};
