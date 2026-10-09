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

const EvidenceSummary = ({ comparison }: { comparison: Comparison }) => (
  <>
    <p>
      Base {comparison.base} → target {comparison.target}
    </p>
    <ul>
      {comparison.commits.map((item) => (
        <li key={item.commit}>
          {item.commit} — {item.subject}
        </li>
      ))}
    </ul>
    <ul>
      {comparison.changes.map((item) => (
        <li key={`${item.status}:${item.path}`}>
          {item.status} {item.path}
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
    Inspect committed evidence
    <select
      defaultValue=""
      onChange={(event) => {
        const index = Number(event.target.value);
        if (Number.isInteger(index)) select(index);
      }}
    >
      <option value="">Select evidence</option>
      {evidence.map((item, index) => (
        <option key={index} value={index}>
          {item.commit.slice(0, 12)} {item.status} {item.path}
        </option>
      ))}
    </select>
  </label>
);

const EvidencePanel = ({ comparison }: { comparison: Comparison }) => {
  const [patch, setPatch] = useState("");
  const [notice, setNotice] = useState("");
  return (
    <section aria-label="Recorded evidence">
      <h2>Recorded evidence</h2>
      <EvidenceSummary comparison={comparison} />
      <EvidencePicker
        evidence={comparison.evidence}
        select={(index) => {
          void window.releaseNotes
            .evidencePatch(comparison.selectionId, index)
            .then((result) => {
              setPatch(result.patch ?? "");
              setNotice(result.reason ?? "");
            })
            .catch(() => {
              setNotice("This committed patch is unavailable.");
            });
        }}
      />
      {notice && <p role="status">{notice}</p>}
      {patch && <pre aria-label="Committed patch">{patch}</pre>}
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
    Evidence citations
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
      Claim
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
      Remove claim
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
    Section heading
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
      Add claim
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
    <h2>Release notes</h2>
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

const History = {
  /**
   * Describes a recorded model, tool, or domain item for the history list.
   *
   * @param value Recorded history item encoded for the renderer.
   * @param category Current history view.
   * @returns Human-readable kind, occurrence time, and content type.
   */
  label(value: unknown, category: string): { kind: string; time: string; content: string } {
    if (typeof value !== "object" || value === null)
      return { kind: category, time: "", content: "" };
    const row = value as Record<string, unknown>;
    const record = (row.conversationRecord ?? row.systemEvent ?? row.domainEvent ?? row) as Record<
      string,
      unknown
    >;
    const content = (record.content ?? record.message) as Record<string, unknown> | undefined;
    const type = typeof content?.["@type"] === "string" ? content["@type"] : "";
    const kind = row.conversationRecord
      ? "Model or tool exchange"
      : row.systemEvent
        ? "System Event"
        : row.domainEvent
          ? "Domain Event"
          : category === "conversation"
            ? "Model or tool exchange"
            : `${category} Event`;
    const occurred = row.occurredAt ?? record.occurredAt;
    const time = typeof occurred === "string" ? occurred : "";
    return { kind, time, content: type.split("/").at(-1) ?? "" };
  },
};

const HistoryRecords = ({ items, category }: { items: readonly unknown[]; category: string }) => (
  <ol>
    {items.map((item, index) => {
      const label = History.label(item, category);
      return (
        <li key={index}>
          <strong>{label.kind}</strong> {label.time}
          {label.content && <span> — {label.content}</span>}
          <details>
            <summary>Recorded content</summary>
            <pre>{JSON.stringify(item, null, 2)}</pre>
          </details>
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
          {value}
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
    <section aria-label="Agent history">
      <h2>Agent history</h2>
      <HistoryView category={history.category} select={history.select} />
      <button type="button" onClick={() => void history.load()}>
        Load history
      </button>
      <HistoryRecords items={history.items} category={history.category} />
      {history.cursor && (
        <button type="button" onClick={() => void history.load(history.cursor)}>
          Older entries
        </button>
      )}
      {history.notice && <p role="status">{history.notice}</p>}
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

const useDraftEditor = (draft: Draft) => {
  const [document, setDocument] = useState<Document>(draft.document);
  const [preview, setPreview] = useState<Preview>();
  const [dirty, setDirty] = useState(false);
  const latestVersion = useRef(JSON.stringify(draft.version));
  const synchronizedDraft = useRef(draft);
  useEffect(() => {
    if (synchronizedDraft.current === draft) return;
    synchronizedDraft.current = draft;
    latestVersion.current = JSON.stringify(draft.version);
    if (!dirty) setDocument(draft.document);
    setPreview(undefined);
  }, [draft]);
  const update = (next: Document) => {
    setDocument(next);
    setDirty(true);
    setPreview(undefined);
  };
  return { document, preview, dirty, latestVersion, setPreview, setDirty, update };
};

interface DraftPanelProps {
  draft: Draft;
  setDraft: (value: Draft) => void;
  generation: string | undefined;
  setGeneration: (value: string) => void;
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

const GenerationActions = (props: GenerationActionsProps) => (
  <>
    <label>
      Generation instruction
      <textarea
        value={props.instruction}
        maxLength={2000}
        onChange={(event) => {
          props.setInstruction(event.target.value);
        }}
      />
    </label>
    <button
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
      Generate draft
    </button>
    {props.generation !== undefined && props.phase === "unknown" && (
      <RetryAdmission onRetry={props.repeat} />
    )}
    <button type="button" onClick={props.reread}>
      Read current draft
    </button>
  </>
);

const RetryAdmission = ({ onRetry }: { onRetry: () => void }) => (
  <>
    <button type="button" onClick={onRetry}>
      Retry unconfirmed generation
    </button>
    <p>
      This reuses the original instruction, account, model, and committed comparison. Edits above
      are not included.
    </p>
  </>
);

const GenerationSection = (props: GenerationActionsProps) => (
  <section aria-label="Release draft">
    <h2>{props.draft.title}</h2>
    <p>
      Generation sends the selected source content and your instruction to OpenAI. Drafts and
      history are held in this session and disappear when the backend exits.
    </p>
    <p>
      Audience: {props.draft.audience}. Generation: {props.draft.generationStatus}; execution:{" "}
      {props.phase ?? "none"}.
    </p>
    <GenerationActions {...props} />
  </section>
);

interface ReviewProps {
  draft: Draft;
  document: Document;
  preview: Preview | undefined;
  save: () => void;
  makePreview: () => void;
  approve: () => void;
  exportFile: () => void;
}

const PreviewBox = ({ preview, approve }: { preview: Preview; approve: () => void }) => (
  <>
    <pre aria-label="Markdown preview">{new TextDecoder().decode(preview.markdown)}</pre>
    <details>
      <summary>Content digest</summary>
      <p>SHA-256: {preview.digest}</p>
    </details>
    <button type="button" onClick={approve}>
      Approve reviewed notes
    </button>
  </>
);

const ReviewSection = (props: ReviewProps) => (
  <section aria-label="Review and export">
    <h2>Review and export</h2>
    <button type="button" onClick={props.save}>
      Save edits
    </button>
    <button type="button" onClick={props.makePreview}>
      Preview release notes
    </button>
    {props.preview && <PreviewBox preview={props.preview} approve={props.approve} />}
    <button type="button" disabled={!props.draft.approvalDigest} onClick={props.exportFile}>
      Export approved release notes
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
    props.setGeneration(result.generation);
    onPhase("accepted");
  } catch (error) {
    const retained = (await window.releaseNotes.session()).generations[props.draft.id];
    if (retained && retained !== props.generation) {
      props.setGeneration(retained);
      const observed = await window.releaseNotes.phase(retained).catch(() => undefined);
      onPhase(
        observed?.rejection
          ? "rejected"
          : (observed?.phase ?? (observed?.receipt ? "accepted" : "unknown")),
      );
    }
    throw error;
  }
};

const generationButtons = (
  props: DraftPanelProps,
  instruction: string,
  onPhase: (value: string) => void,
  onDirty: (value: boolean) => void,
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
      props.setGeneration(result.generation);
      onPhase("accepted");
    });
  },
  reread: () => {
    run(async () => {
      onDirty(false);
      props.setDraft(await window.releaseNotes.readDraft(props.draft.id));
    });
  },
});

const reviewEditButtons = (
  props: DraftPanelProps,
  editor: ReturnType<typeof useDraftEditor>,
  run: RunAction,
) => ({
  save: () => {
    run(async () => {
      const saved = await window.releaseNotes.edit(
        props.draft.id,
        props.draft.version,
        editor.document,
      );
      editor.setDirty(false);
      props.setDraft(saved);
    });
  },
  makePreview: () => {
    run(async () => {
      editor.setPreview(await window.releaseNotes.preview(props.draft.id));
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
      if (!editor.preview) return;
      props.setDraft(
        await window.releaseNotes.approve(
          props.draft.id,
          editor.preview.version,
          editor.preview.markdown,
        ),
      );
    });
  },
  exportFile: () => {
    run(async () => {
      const result = await window.releaseNotes.exportApproved(props.draft.id, props.draft.version);
      if (result.saved) props.setDraft(await window.releaseNotes.readDraft(props.draft.id));
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

const DraftEvidenceAndReview = ({
  draft,
  editor,
  reviewActions,
}: Pick<DraftPanelViewProps, "draft" | "editor" | "reviewActions">) => (
  <>
    <EvidencePanel comparison={draft.comparison} />
    <DocumentEditor
      document={editor.document}
      evidence={draft.comparison.evidence}
      update={editor.update}
    />
    <ReviewSection
      draft={draft}
      document={editor.document}
      preview={editor.preview}
      {...reviewActions}
    />
    <HistoryPanel id={draft.id} />
  </>
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
  <>
    <GenerationSection
      draft={draft}
      generation={generation}
      phase={phase}
      modelReady={modelReady}
      instruction={instruction}
      setInstruction={setInstruction}
      {...generationActions}
    />
    <DraftEvidenceAndReview draft={draft} editor={editor} reviewActions={reviewActions} />
  </>
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
  const generationActions = generationButtons(props, instruction, setPhase, editor.setDirty, run);
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

const useDraftSession = (onNotice: (value: string) => void) => {
  const [draft, setDraft] = useState<Draft>();
  const [titles, setTitles] = useState<Readonly<Record<string, string>>>({});
  const [generation, setGeneration] = useState<string>();
  useEffect(() => {
    let live = true;
    void window.releaseNotes
      .session()
      .then(async (session) => {
        const drafts = await Promise.all(
          session.drafts.map((id) => window.releaseNotes.readDraft(id)),
        );
        if (!live) return;
        setTitles(Object.fromEntries(drafts.map((item) => [item.id, item.title])));
        const current = drafts.at(-1);
        if (current) {
          setDraft(current);
          setGeneration(session.generations[current.id]);
        }
      })
      .catch(() => {
        if (live) onNotice("The in-memory session is unavailable.");
      });
    return () => {
      live = false;
    };
  }, []);
  const open = (value: Draft) => {
    setDraft(value);
    setGeneration(undefined);
    setTitles((current) => ({ ...current, [value.id]: value.title }));
  };
  return { draft, setDraft, titles, generation, setGeneration, open };
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
            {title} ({id.slice(0, 8)})
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
        {comparison.base} → {comparison.target}
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
      Base revision
      <input
        value={base}
        onChange={(event) => {
          onBase(event.target.value);
        }}
      />
    </label>
    <label>
      Target revision
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
      run(async () => {
        const current = await window.releaseNotes.readDraft(id);
        const active = await window.releaseNotes.session();
        session.setDraft(current);
        session.setGeneration(active.generations[id]);
      });
    }}
  />
);

const comparisonPolicy =
  "The base must be an ancestor of the target. Only committed changes are included; uncommitted edits are excluded.";

const ComparisonPanel = ({
  run,
  open,
  session,
}: {
  run: RunAction;
  open: (draft: Draft) => void;
  session: ReturnType<typeof useDraftSession>;
}) => {
  const [base, setBase] = useState("");
  const [target, setTarget] = useState("HEAD");
  const [comparison, setComparison] = useState<Comparison>();
  return (
    <section aria-label="Release comparison">
      <h2>Release comparison</h2>
      <SelectedDraftPicker session={session} run={run} />
      <RevisionFields base={base} target={target} onBase={setBase} onTarget={setTarget} />
      <p>{comparisonPolicy}</p>
      <button
        type="button"
        onClick={() => {
          run(async () => {
            const chosen = await window.releaseNotes.chooseComparison(base, target);
            if (chosen) setComparison(chosen);
          });
        }}
      >
        Choose repository and comparison
      </button>
      {comparison && <OpenDraftForm comparison={comparison} run={run} open={open} />}
    </section>
  );
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
  return (
    <>
      <ComparisonPanel run={run} open={session.open} session={session} />
      {session.draft && (
        <DraftPanel
          key={session.draft.id}
          draft={session.draft}
          setDraft={session.setDraft}
          generation={session.generation}
          setGeneration={session.setGeneration}
          modelReady={modelReady}
          notice={notice}
        />
      )}
      <button type="button" onClick={() => void window.releaseNotes.stopAndQuit()}>
        Stop and quit
      </button>
    </>
  );
};
