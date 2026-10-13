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

import { useEffect, useRef, useState, type ReactElement } from "react";
import { ArrowLeft, ArrowRight, Folder, Sparkles } from "lucide-react";
import { ChoiceSelect } from "./choice-select.js";
import { DashboardView, StudioTopBar, WizardFrame } from "./studio-flow-view.js";
import { MarkdownWorkspaceView } from "./studio-markdown-view.js";
import { StudioIpcErrors } from "./trusted/studio-ipc-errors.js";

interface Comparison {
  readonly selectionId: string;
  readonly projectName: string;
  readonly baseLabel: string;
  readonly targetLabel: string;
  readonly commits: readonly unknown[];
  readonly changes: readonly unknown[];
}

interface Draft {
  readonly id: string;
  readonly version: object;
  readonly title: string;
  readonly audience: string;
  readonly comparison: Comparison;
  readonly generationStatus: string;
  readonly markdown: Uint8Array;
  readonly lastEditedAt?: string | undefined;
}

/**
 * Renderer-visible methods of the private trusted Studio boundary.
 */
export interface StudioFlowBridge {
  /**
   * Reads this session.
   *
   * @returns Draft identifiers and active generation references in this session.
   */
  session(): Promise<{ drafts: readonly string[]; generations: Readonly<Record<string, string>> }>;

  /**
   * Opens a local Git project.
   *
   * @returns Native-picked local Git project metadata or a canceled choice.
   */
  chooseProject(): Promise<{ handle: string; name: string; refs: readonly string[] } | null>;

  /**
   * Compares a real selected ref pair to a verified comparison.
   *
   * @param handle Opaque native-picked project.
   * @param base From revision.
   * @param target To revision.
   * @returns Verified comparison metadata.
   */
  compareProject(handle: string, base: string, target: string): Promise<Comparison>;

  /**
   * Opens or repeats one draft creation with its stable identifier.
   *
   * @param id Stable draft identifier.
   * @param selectionId Pinned comparison reference.
   * @param title Release title.
   * @param audience Intended readers.
   * @returns Authoritative draft.
   */
  openDraft(id: string, selectionId: string, title: string, audience: string): Promise<Draft>;

  /**
   * Reads an authoritative draft.
   *
   * @param id Draft identifier.
   * @returns Current authoritative draft.
   */
  readDraft(id: string): Promise<Draft>;

  /**
   * Starts release generation.
   *
   * @param id Draft identifier.
   * @param instruction Bounded style request.
   * @returns Generation reference.
   */
  generate(id: string, instruction: string): Promise<{ generation: string }>;

  /**
   * Retries an uncertain generation.
   *
   * @param generation Retained uncertain generation.
   * @returns Its original reference.
   */
  repeatGeneration(generation: string): Promise<{ generation: string }>;

  /**
   * Cancels a matching generation.
   *
   * @param id Draft identifier.
   * @param generation Exact generation.
   * @returns Canceled draft state.
   */
  cancelGeneration(id: string, generation: string): Promise<Draft>;

  /**
   * Reads an Agent phase.
   *
   * @param generation Generation reference.
   * @returns Receipt and Agent phase.
   */
  phase(generation: string): Promise<{ receipt: boolean; phase?: string; rejection?: string }>;

  /**
   * Replaces exact Markdown bytes.
   *
   * @param id Draft identifier.
   * @param version Displayed Version.
   * @param markdown Exact bytes.
   * @returns Saved draft.
   */
  edit(id: string, version: object, markdown: Uint8Array): Promise<Draft>;

  /**
   * Writes a saved Markdown snapshot.
   *
   * @param id Draft identifier.
   * @param version Current saved Version.
   * @returns Native export result.
   */
  exportMarkdown(id: string, version: object): Promise<{ saved: boolean }>;
}

type Page = "dashboard" | "changes" | "style" | "writing" | "editor";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const releaseExcerpt = (markdown: Uint8Array): string =>
  decoder
    .decode(markdown)
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("#")) ?? "No notes yet.";

const useSessionDrafts = (bridge: StudioFlowBridge, onNotice: (value: string) => void) => {
  const [drafts, setDrafts] = useState<readonly Draft[]>([]);
  const [generations, setGenerations] = useState<Readonly<Record<string, string>>>({});
  const refresh = async () => {
    const session = await bridge.session();
    const settled = await Promise.allSettled(session.drafts.map((id) => bridge.readDraft(id)));
    const records = settled.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    if (settled.some((result) => result.status === "rejected"))
      onNotice("Some releases could not be read yet. Try opening them again.");
    setDrafts((current) => [
      ...records.filter((record) => !current.some((item) => item.id === record.id)),
      ...current,
    ]);
    setGenerations((current) => ({ ...session.generations, ...current }));
  };
  useEffect(() => {
    void refresh().catch((error: unknown) => {
      onNotice(StudioIpcErrors.display(error, "Could not read this session's releases."));
    });
  }, []);
  const remember = (draft: Draft) => {
    setDrafts((current) => [...current.filter((item) => item.id !== draft.id), draft]);
  };
  return { drafts, generations, setGenerations, remember, refresh };
};

const useMarkdownRecord = (draft: Draft | undefined) => {
  const [buffer, setBuffer] = useState("");
  const [state, setState] = useState("Saved for this session");
  const record = useRef<Draft | undefined>(undefined);
  const current = useRef("");
  useEffect(() => {
    if (!draft) return;
    const previous = record.current;
    const wasClean = !previous || current.current === decoder.decode(previous.markdown);
    record.current = draft;
    if (previous?.id !== draft.id || wasClean) {
      current.current = decoder.decode(draft.markdown);
      setBuffer(current.current);
      setState("Saved for this session");
    }
  }, [draft?.id, draft?.generationStatus]);
  return { buffer, state, setState, setBuffer, record, current };
};

type MarkdownRecord = ReturnType<typeof useMarkdownRecord>;

const saveMarkdownChanges = async (
  bridge: StudioFlowBridge,
  editor: MarkdownRecord,
  onUpdate: (draft: Draft) => void,
  reconcile: () => Promise<void>,
  uncertainVersion: { current: boolean },
): Promise<void> => {
  if (uncertainVersion.current) await reconcile();
  while (
    editor.record.current &&
    editor.current.current !== decoder.decode(editor.record.current.markdown)
  ) {
    const snapshot = editor.current.current;
    const before = editor.record.current;
    editor.setState("Saving…");
    let after: Draft;
    try {
      after = await bridge.edit(before.id, before.version, encoder.encode(snapshot));
    } catch (error) {
      uncertainVersion.current = true;
      throw error;
    }
    editor.record.current = after;
    onUpdate(after);
  }
  editor.setState("Saved for this session");
};

const useMarkdownFlush = (
  bridge: StudioFlowBridge,
  editor: MarkdownRecord,
  onUpdate: (draft: Draft) => void,
) => {
  const pending = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const uncertainVersion = useRef(false);
  const reconcile = async () => {
    const selected = editor.record.current;
    if (!selected) return;
    const latest = await bridge.readDraft(selected.id);
    editor.record.current = latest;
    onUpdate(latest);
    uncertainVersion.current = false;
  };
  const flush = async () => {
    if (timer.current) clearTimeout(timer.current);
    pending.current = pending.current
      .catch(() => undefined)
      .then(() => saveMarkdownChanges(bridge, editor, onUpdate, reconcile, uncertainVersion));
    try {
      await pending.current;
    } catch (error) {
      if (uncertainVersion.current) await reconcile().catch(() => undefined);
      editor.setState("Could not save. Your edits remain here.");
      throw error;
    }
  };
  return { flush, timer, reconcile, markUncertain: () => (uncertainVersion.current = true) };
};

const useMarkdownSave = (
  bridge: StudioFlowBridge,
  draft: Draft | undefined,
  onUpdate: (draft: Draft) => void,
) => {
  const editor = useMarkdownRecord(draft);
  const { flush, timer, reconcile, markUncertain } = useMarkdownFlush(bridge, editor, onUpdate);
  const change = (value: string) => {
    editor.current.current = value;
    editor.setBuffer(value);
    editor.setState("Unsaved changes");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void flush().catch(() => undefined);
    }, 450);
  };
  const acceptSnapshot = (value: Draft) => {
    editor.record.current = value;
    if (editor.current.current === decoder.decode(value.markdown))
      editor.setState("Saved for this session");
  };
  return {
    buffer: editor.buffer,
    state: editor.state,
    change,
    flush,
    acceptSnapshot,
    reconcile,
    markUncertain,
  };
};

interface ChangesProps {
  project: { handle: string; name: string; refs: readonly string[] } | undefined;
  base: string;
  target: string;
  title: string;
  comparison: Comparison | undefined;
  comparisonStatus: "idle" | "pending" | "failed";
  comparisonError: string;
  busy: boolean;
  pickerPending: boolean;
  retryComparison: () => void;
  choose: () => void;
  setBase: (value: string) => void;
  setTarget: (value: string) => void;
  setTitle: (value: string) => void;
  next: () => void;
  dashboard: () => void;
}

const RevisionField = ({
  label,
  value,
  refs,
  busy,
  onChange,
}: {
  label: string;
  value: string;
  refs: readonly string[] | undefined;
  busy: boolean;
  onChange: (value: string) => void;
}): ReactElement => (
  <ChoiceSelect
    label={label}
    value={value}
    disabled={!refs || busy}
    placeholder="Select a revision"
    options={refs?.map((ref) => ({ value: ref, label: ref })) ?? []}
    onChange={onChange}
  />
);

const ChangesFields = (props: ChangesProps): ReactElement => (
  <>
    <ProjectField {...props} />
    <ReleaseTitleField {...props} />
    <div className="rs-field-row">
      <RevisionField
        label="From"
        value={props.base}
        refs={props.project?.refs}
        busy={props.busy}
        onChange={props.setBase}
      />
      <RevisionField
        label="To"
        value={props.target}
        refs={props.project?.refs}
        busy={props.busy}
        onChange={props.setTarget}
      />
    </div>
    {props.comparison && (
      <p className="rs-change-counts">
        {props.comparison.commits.length}{" "}
        {props.comparison.commits.length === 1 ? "commit" : "commits"} ·{" "}
        {props.comparison.changes.length} {props.comparison.changes.length === 1 ? "file" : "files"}
      </p>
    )}
    {props.busy && (
      <p className="rs-change-counts" role="status">
        {props.pickerPending ? "Opening Git project…" : "Signing out…"}
      </p>
    )}
    {!props.busy && props.comparisonStatus === "pending" && (
      <p className="rs-change-counts" role="status">
        Comparing Git changes…
      </p>
    )}
    {props.comparisonStatus === "failed" && (
      <div className="rs-comparison-error" role="alert">
        <p>{props.comparisonError}</p>
        {props.comparisonError !==
          "From must be part of To's Git history. Choose another range." && (
          <button
            type="button"
            className="rs-secondary"
            disabled={props.busy}
            onClick={props.retryComparison}
          >
            Retry
          </button>
        )}
      </div>
    )}
    {!props.project && <p className="rs-change-counts">Choose a Git project to continue.</p>}
    {props.project && (!props.base || !props.target) && (
      <p className="rs-change-counts">Select From and To revisions to continue.</p>
    )}
    {props.base && props.base === props.target && (
      <p className="rs-change-counts">Choose two different revisions.</p>
    )}
    {props.project &&
      props.base &&
      props.target &&
      props.base !== props.target &&
      !props.title.trim() &&
      props.comparisonStatus !== "failed" && (
        <p className="rs-change-counts">Enter a release title to continue.</p>
      )}
  </>
);

const ProjectField = (props: ChangesProps): ReactElement => (
  <div className="rs-field">
    <span>Project</span>
    <button
      type="button"
      className="rs-project-button"
      aria-label="Choose a Git project"
      disabled={props.busy}
      onClick={props.choose}
    >
      <Folder aria-hidden="true" size={17} /> {props.project?.name ?? "Choose a Git project"}
      <Folder aria-hidden="true" size={17} className="rs-project-action-icon" />
    </button>
  </div>
);

const ReleaseTitleField = (props: ChangesProps): ReactElement => (
  <label className="rs-field">
    Release
    <input
      value={props.title}
      placeholder="e.g. Version 2.4"
      onChange={(event) => {
        props.setTitle(event.target.value);
      }}
    />
  </label>
);

const ChangesStep = (props: ChangesProps): ReactElement => (
  <WizardFrame
    step="changes"
    dashboard={props.dashboard}
    heading="Choose changes"
    footer={
      <button
        type="button"
        className="rs-primary"
        disabled={props.busy || !props.comparison || !props.title.trim()}
        onClick={props.next}
      >
        Next <ArrowRight aria-hidden="true" size={16} />
      </button>
    }
  >
    <ChangesFields {...props} />
  </WizardFrame>
);

interface StyleProps {
  audience: string;
  tone: string;
  notes: string;
  model: string;
  modelPending?: boolean;
  models: readonly { slug: string; displayName: string }[];
  busy: boolean;
  setAudience: (value: string) => void;
  setTone: (value: string) => void;
  setNotes: (value: string) => void;
  selectModel: (value: string) => void;
  back: () => void;
  write: () => void;
  dashboard: () => void;
}

const StyleFields = (props: StyleProps): ReactElement => (
  <>
    <div className="rs-field-row rs-style-options">
      <SegmentedField
        label="Audience"
        value={props.audience}
        choices={["Customers", "Developers"]}
        onChange={props.setAudience}
      />
      <SegmentedField
        label="Tone"
        value={props.tone}
        choices={["Plain", "Friendly"]}
        onChange={props.setTone}
      />
    </div>
    <StyleNotesField {...props} />
    <StyleModelField {...props} />
    <p className="rs-disclosure">Selected changes are sent to OpenAI.</p>
  </>
);

const SegmentedField = ({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: string;
  choices: readonly string[];
  onChange: (value: string) => void;
}): ReactElement => (
  <fieldset className="rs-segmented-field">
    <legend>{label}</legend>
    <div className="rs-segments">
      {choices.map((choice) => (
        <label key={choice} className={value === choice ? "selected" : ""}>
          <input
            type="radio"
            name={label}
            value={choice}
            checked={value === choice}
            onChange={() => {
              onChange(choice);
            }}
          />
          {choice}
        </label>
      ))}
    </div>
  </fieldset>
);

const StyleNotesField = (props: StyleProps): ReactElement => (
  <label className="rs-field">
    Notes (optional)
    <textarea
      value={props.notes}
      placeholder="Lead with the most useful changes. Keep it brief."
      onChange={(event) => {
        props.setNotes(event.target.value);
      }}
    />
  </label>
);

const StyleModelField = (props: StyleProps): ReactElement => (
  <>
    <ChoiceSelect
      label="Model"
      value={props.model}
      disabled={props.models.length === 0}
      placeholder="Select a model"
      options={props.models.map((item) => ({ value: item.slug, label: item.displayName }))}
      onChange={props.selectModel}
    />
    {props.modelPending && <p role="status">Preparing model…</p>}
  </>
);

const StyleStep = (props: StyleProps): ReactElement => (
  <WizardFrame
    step="style"
    dashboard={props.dashboard}
    heading="Writing style"
    footer={
      <>
        <button type="button" className="rs-secondary" disabled={props.busy} onClick={props.back}>
          <ArrowLeft aria-hidden="true" size={16} /> Back
        </button>
        <button
          type="button"
          className="rs-primary"
          disabled={props.busy || !props.model || props.modelPending}
          onClick={props.write}
        >
          Write <Sparkles aria-hidden="true" size={16} />
        </button>
      </>
    }
  >
    <StyleFields {...props} />
  </WizardFrame>
);

const WritingStep = ({
  cancel,
  retry,
  status,
  project,
  release,
}: {
  cancel: () => void;
  retry: () => void;
  status: string;
  project: string;
  release: string;
}): ReactElement => (
  <WizardFrame step="writing" dashboard={cancel} footer={<WritingFooter cancel={cancel} />}>
    <WritingBody project={project} release={release} status={status} retry={retry} />
  </WizardFrame>
);

const WritingFooter = ({ cancel }: { cancel: () => void }): ReactElement => (
  <div className="rs-writing-actions">
    <button type="button" className="rs-secondary" onClick={cancel}>
      Cancel
    </button>
  </div>
);

const WritingBody = ({
  project,
  release,
  status,
  retry,
}: {
  project: string;
  release: string;
  status: string;
  retry: () => void;
}): ReactElement => (
  <div className="rs-writing-state">
    <div className="rs-writing-spinner" aria-hidden="true" />
    <h2>{status.includes("Try again") ? "Writing needs attention" : "Writing…"}</h2>
    <p className="rs-writing-release">
      {project} · {release}
    </p>
    <p role="status">{status}</p>
    {status.includes("Try again") && (
      <button type="button" className="rs-secondary" onClick={retry}>
        Try again
      </button>
    )}
  </div>
);

interface FlowConfig {
  bridge: StudioFlowBridge;
  models: readonly { slug: string; displayName: string }[];
  model: string;
  modelPending?: boolean;
  selectModel: (slug: string) => Promise<void>;
  signOut: () => Promise<void>;
  onNotice: (value: string) => void;
  clearSuccessNotice?: () => void;
}

const useWizardState = () => {
  const [project, setProject] = useState<{
    handle: string;
    name: string;
    refs: readonly string[];
  }>();
  const [base, setBase] = useState("");
  const [target, setTarget] = useState("");
  const [title, setTitle] = useState("");
  const [audience, setAudience] = useState("Customers");
  const [tone, setTone] = useState("Plain");
  const [notes, setNotes] = useState("");
  const [comparison, setComparison] = useState<Comparison>();
  const [comparisonStatus, setComparisonStatus] = useState<"idle" | "pending" | "failed">("idle");
  const [comparisonError, setComparisonError] = useState("");
  const [comparisonRetry, setComparisonRetry] = useState(0);
  return {
    project,
    setProject,
    base,
    setBase,
    target,
    setTarget,
    title,
    setTitle,
    audience,
    setAudience,
    tone,
    setTone,
    notes,
    setNotes,
    comparison,
    setComparison,
    comparisonStatus,
    setComparisonStatus,
    comparisonError,
    setComparisonError,
    comparisonRetry,
    setComparisonRetry,
  };
};

const useOperationalState = (config: FlowConfig) => {
  const [page, setPage] = useState<Page>("dashboard");
  const [draft, setDraft] = useState<Draft>();
  const [busy, setBusy] = useState(false);
  const [writingStatus, setWritingStatus] = useState("Your editor will open when it’s ready.");
  const sequence = useRef(0);
  const pickerPending = useRef(false);
  const generation = useRef<string | undefined>(undefined);
  const openingId = useRef<string | undefined>(undefined);
  const cancelRequested = useRef(false);
  const session = useSessionDrafts(config.bridge, config.onNotice);
  const editor = useMarkdownSave(config.bridge, draft, (saved) => {
    setDraft(saved);
    session.remember(saved);
  });
  const report = (error: unknown, fallback: string) => {
    config.onNotice(StudioIpcErrors.display(error, fallback));
  };
  return {
    page,
    setPage,
    draft,
    setDraft,
    busy,
    setBusy,
    writingStatus,
    setWritingStatus,
    sequence,
    pickerPending,
    generation,
    openingId,
    cancelRequested,
    session,
    editor,
    report,
  };
};

const useFlowState = (config: FlowConfig) => ({
  ...useWizardState(),
  ...useOperationalState(config),
});

type FlowState = ReturnType<typeof useFlowState>;

const chooseProject = async (state: FlowState, config: FlowConfig): Promise<void> => {
  const token = ++state.sequence.current;
  let changed = false;
  state.pickerPending.current = true;
  state.setBusy(true);
  try {
    const selected = await config.bridge.chooseProject();
    if (token !== state.sequence.current || !selected) return;
    changed = true;
    state.setProject(selected);
    state.setBase("");
    state.setTarget("");
    state.setComparison(undefined);
    state.setComparisonStatus("idle");
  } catch (error) {
    if (token === state.sequence.current) state.report(error, "Could not open that Git project.");
  } finally {
    if (token === state.sequence.current) {
      state.pickerPending.current = false;
      state.setBusy(false);
      if (!changed && state.comparisonStatus === "pending")
        state.setComparisonRetry((value) => value + 1);
    }
  }
};

const useComparison = (state: FlowState, config: FlowConfig): void => {
  useEffect(() => {
    if (
      state.page !== "changes" ||
      !state.project ||
      !state.base ||
      !state.target ||
      state.base === state.target
    )
      return;
    const token = ++state.sequence.current;
    state.setComparison(undefined);
    state.setComparisonStatus("pending");
    state.setComparisonError("");
    void config.bridge.compareProject(state.project.handle, state.base, state.target).then(
      (selected) => {
        if (token === state.sequence.current) {
          state.setComparison(selected);
          state.setComparisonStatus("idle");
        }
      },
      (error: unknown) => {
        if (token === state.sequence.current) {
          state.setComparisonError(
            StudioIpcErrors.display(error, "Could not compare those Git revisions. Try again."),
          );
          state.setComparisonStatus("failed");
        }
      },
    );
    return () => {
      if (token === state.sequence.current) ++state.sequence.current;
    };
  }, [state.page, state.project?.handle, state.base, state.target, state.comparisonRetry]);
};

const cancelWriting = async (
  state: FlowState,
  config: FlowConfig,
  selected: Draft,
  active: string,
): Promise<void> => {
  state.setWritingStatus("Stopping writing…");
  const latest = await config.bridge.cancelGeneration(selected.id, active);
  state.setDraft(latest);
  state.session.remember(latest);
  if (latest.generationStatus === "canceled") state.setPage("dashboard");
  else if (latest.generationStatus === "staged" || latest.generationStatus === "edited")
    state.setPage("editor");
  else if (latest.generationStatus.startsWith("failed:"))
    state.setWritingStatus("Writing failed. Try again.");
  else state.setWritingStatus("Stopping writing…");
};

const cancellationRequested = (state: FlowState): boolean => state.cancelRequested.current;

const startGeneration = async (state: FlowState, config: FlowConfig): Promise<void> => {
  if (!state.comparison || !config.model || config.modelPending) return;
  state.setBusy(true);
  state.setPage("writing");
  state.cancelRequested.current = false;
  let opened: Draft | undefined;
  try {
    state.openingId.current ??= crypto.randomUUID();
    opened = await config.bridge.openDraft(
      state.openingId.current,
      state.comparison.selectionId,
      state.title,
      state.audience,
    );
    state.setDraft(opened);
    state.session.remember(opened);
    const instruction = `Tone: ${state.tone}. ${state.notes.trim()}`.trim();
    const accepted = await config.bridge.generate(opened.id, instruction);
    state.generation.current = accepted.generation;
    const openedId = opened.id;
    state.session.setGenerations((current) => ({ ...current, [openedId]: accepted.generation }));
    if (cancellationRequested(state))
      await cancelWriting(state, config, opened, accepted.generation);
    else state.setWritingStatus("Your editor will open when it’s ready.");
  } catch (error) {
    await recoverGeneration(state, config, opened, error);
  } finally {
    state.setBusy(false);
  }
};

const recoverGeneration = async (
  state: FlowState,
  config: FlowConfig,
  opened: Draft | undefined,
  error: unknown,
): Promise<void> => {
  const session = opened && (await config.bridge.session().catch(() => undefined));
  const retained = opened && session?.generations[opened.id];
  if (!opened) {
    state.report(error, "Could not open this release. Try again.");
    state.setPage("style");
    return;
  }
  if (!retained) {
    state.setWritingStatus("Writing needs attention. Try again.");
    return;
  }
  state.generation.current = retained;
  const openedId = opened.id;
  state.session.setGenerations((current) => ({ ...current, [openedId]: retained }));
  if (cancellationRequested(state)) {
    try {
      await cancelWriting(state, config, opened, retained);
    } catch (cancelError) {
      state.report(cancelError, "Could not stop writing.");
    }
    return;
  }
  try {
    await config.bridge.repeatGeneration(retained);
    state.setWritingStatus("Your editor will open when it’s ready.");
  } catch {
    state.setWritingStatus("Writing needs attention. Try again.");
  }
};

const useWritingPoll = (state: FlowState, config: FlowConfig): void => {
  const acceptedGeneration = state.draft && state.session.generations[state.draft.id];
  useEffect(() => {
    if (
      state.page !== "writing" ||
      !state.draft ||
      !acceptedGeneration ||
      state.draft.generationStatus.startsWith("failed:") ||
      state.draft.generationStatus === "canceled"
    )
      return;
    const draftId = state.draft.id;
    let current = true;
    const poll = async () => {
      try {
        const latest = await config.bridge.readDraft(draftId);
        if (!current) return;
        applyGenerationSnapshot(state, latest);
      } catch (error) {
        if (current) state.report(error, "Could not check writing progress.");
      }
    };
    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 900);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [state.page, state.draft?.id, state.draft?.generationStatus, acceptedGeneration]);
};

const applyGenerationSnapshot = (state: FlowState, latest: Draft): void => {
  if (
    latest.generationStatus !== "staged" &&
    latest.generationStatus !== "canceled" &&
    !latest.generationStatus.startsWith("failed:")
  )
    return;
  state.setDraft(latest);
  state.session.remember(latest);
  if (latest.generationStatus === "staged") state.setPage("editor");
  else if (latest.generationStatus === "canceled") state.setPage("dashboard");
  else state.setWritingStatus("Writing failed. Try again.");
};

const leaveEditor = async (state: FlowState, onComplete: () => void): Promise<void> => {
  try {
    await state.editor.flush();
    onComplete();
  } catch (error) {
    state.report(error, "Could not save your edits.");
  }
};

const exportCurrent = async (state: FlowState, config: FlowConfig): Promise<void> => {
  if (!state.draft || state.busy) return;
  state.setBusy(true);
  try {
    await state.editor.flush();
    const latest = await config.bridge.readDraft(state.draft.id);
    const result = await config.bridge.exportMarkdown(latest.id, latest.version);
    const after = await config.bridge.readDraft(state.draft.id);
    state.editor.acceptSnapshot(after);
    state.setDraft(after);
    if (result.saved) config.onNotice("Markdown exported.");
  } catch (error) {
    state.editor.markUncertain();
    await state.editor.reconcile().catch(() => undefined);
    state.report(error, "Could not export Markdown.");
  } finally {
    state.setBusy(false);
  }
};

const awaitGenerationFence = async (state: FlowState, config: FlowConfig): Promise<void> => {
  if (!state.generation.current) return;
  for (;;) {
    const observation = await config.bridge.phase(state.generation.current);
    if (observation.phase === "completed" || observation.phase === "terminated") return;
    await new Promise((done) => setTimeout(done, 1_000));
  }
};

const signOutSafely = async (state: FlowState, config: FlowConfig): Promise<void> => {
  if (state.busy) return;
  state.setBusy(true);
  try {
    if (state.page === "editor") await state.editor.flush();
    if (state.page === "writing" && state.draft && state.generation.current)
      await config.bridge.cancelGeneration(state.draft.id, state.generation.current);
    await awaitGenerationFence(state, config);
    await config.signOut();
    state.setPage("dashboard");
    state.setDraft(undefined);
  } catch (error) {
    state.report(error, "Could not sign out yet.");
  } finally {
    state.setBusy(false);
  }
};

const DashboardRoute = ({
  state,
  config,
}: {
  state: FlowState;
  config: FlowConfig;
}): ReactElement => (
  <DashboardView
    releases={state.session.drafts.map((item) => ({
      id: item.id,
      title: item.comparison.projectName,
      subtitle: item.title,
      summary: releaseExcerpt(item.markdown),
      lastEditedAt: item.lastEditedAt,
    }))}
    newRelease={() => {
      resetWizard(state);
    }}
    openRelease={(id) => {
      openSessionRelease(state, config, id);
    }}
  />
);

const resetWizard = (state: FlowState): void => {
  state.openingId.current = undefined;
  state.generation.current = undefined;
  state.setProject(undefined);
  state.setBase("");
  state.setTarget("");
  state.setComparison(undefined);
  state.setComparisonStatus("idle");
  state.setTitle("");
  state.setAudience("Customers");
  state.setNotes("");
  state.setPage("changes");
};

const openSessionRelease = (state: FlowState, config: FlowConfig, id: string): void => {
  const selected = state.session.drafts.find((item) => item.id === id);
  if (!selected) return;
  state.setDraft(selected);
  const retained = state.session.generations[id];
  if (selected.generationStatus === "staged" || selected.generationStatus === "edited") {
    state.setPage("editor");
    return;
  }
  if (selected.generationStatus.startsWith("failed:")) {
    state.setWritingStatus("Writing failed. Try again.");
    state.setPage("writing");
    return;
  }
  if (selected.generationStatus === "canceled") {
    state.setPage("dashboard");
    return;
  }
  if (!retained) {
    state.setWritingStatus("Writing needs attention. Try again.");
    state.setPage("writing");
    return;
  }
  state.generation.current = retained;
  state.setPage("writing");
  void config.bridge
    .phase(retained)
    .then(async (observation) => {
      if (!observation.receipt) await config.bridge.repeatGeneration(retained);
    })
    .catch(() => {
      state.setWritingStatus("Writing needs attention. Try again.");
    });
};

const ChangesRoute = ({
  state,
  config,
}: {
  state: FlowState;
  config: FlowConfig;
}): ReactElement => (
  <ChangesStep
    project={state.project}
    base={state.base}
    target={state.target}
    title={state.title}
    comparison={state.comparison}
    comparisonStatus={state.comparisonStatus}
    comparisonError={state.comparisonError}
    busy={state.busy}
    pickerPending={state.pickerPending.current}
    retryComparison={() => {
      state.setComparisonRetry((value) => value + 1);
    }}
    choose={() => {
      void chooseProject(state, config);
    }}
    setBase={(value) => {
      changeRevision(state, "base", value);
    }}
    setTarget={(value) => {
      changeRevision(state, "target", value);
    }}
    setTitle={(value) => {
      changeReleaseTitle(state, value);
    }}
    next={() => {
      nextFromChanges(state);
    }}
    dashboard={() => {
      if (state.busy && !state.pickerPending.current) return;
      ++state.sequence.current;
      if (state.pickerPending.current) {
        state.pickerPending.current = false;
        state.setBusy(false);
      }
      state.setPage("dashboard");
    }}
  />
);

const changeReleaseTitle = (state: FlowState, value: string): void => {
  state.openingId.current = undefined;
  state.setTitle(value);
};

const nextFromChanges = (state: FlowState): void => {
  if (!state.comparison) return;
  state.openingId.current = undefined;
  state.setPage("style");
};

const changeRevision = (state: FlowState, side: "base" | "target", value: string): void => {
  ++state.sequence.current;
  if (side === "base") state.setBase(value);
  else state.setTarget(value);
  state.setComparison(undefined);
  state.setComparisonStatus("idle");
};

const StyleRoute = ({ state, config }: { state: FlowState; config: FlowConfig }): ReactElement => (
  <StyleStep
    audience={state.audience}
    tone={state.tone}
    notes={state.notes}
    model={config.model}
    modelPending={config.modelPending ?? false}
    models={config.models}
    busy={state.busy}
    setAudience={(value) => {
      state.openingId.current = undefined;
      state.setAudience(value);
    }}
    setTone={state.setTone}
    setNotes={state.setNotes}
    selectModel={(slug) => {
      void config.selectModel(slug);
    }}
    back={() => {
      state.setPage("changes");
    }}
    write={() => {
      void startGeneration(state, config);
    }}
    dashboard={() => {
      state.setPage("dashboard");
    }}
  />
);

const WritingRoute = ({
  state,
  config,
}: {
  state: FlowState;
  config: FlowConfig;
}): ReactElement => (
  <WritingStep
    status={state.writingStatus}
    project={state.draft?.comparison.projectName ?? state.project?.name ?? ""}
    release={state.draft?.title ?? state.title}
    retry={() => {
      retryWriting(state, config);
    }}
    cancel={() => {
      stopWriting(state, config);
    }}
  />
);

const retryWriting = (state: FlowState, config: FlowConfig): void => {
  if (state.draft?.generationStatus.startsWith("failed:")) {
    state.generation.current = undefined;
    const draftId = state.draft.id;
    state.session.setGenerations((current) => {
      return Object.fromEntries(Object.entries(current).filter(([id]) => id !== draftId));
    });
    state.setPage("style");
  } else if (state.generation.current) {
    void config.bridge.repeatGeneration(state.generation.current).then(
      () => {
        state.setWritingStatus("Your editor will open when it’s ready.");
      },
      () => {
        state.setWritingStatus("Writing needs attention. Try again.");
      },
    );
  } else if (state.draft) {
    void recoverWritingReference(state, config, state.draft.id);
  }
};

const recoverWritingReference = async (
  state: FlowState,
  config: FlowConfig,
  draftId: string,
): Promise<void> => {
  try {
    const session = await config.bridge.session();
    const retained = session.generations[draftId];
    if (!retained) return;
    state.generation.current = retained;
    state.session.setGenerations((current) => ({ ...current, [draftId]: retained }));
    if (cancellationRequested(state) && state.draft)
      await cancelWriting(state, config, state.draft, retained);
    else {
      await config.bridge.repeatGeneration(retained);
      state.setWritingStatus("Your editor will open when it’s ready.");
    }
  } catch {
    state.setWritingStatus("Writing needs attention. Try again.");
  }
};

const stopWriting = (state: FlowState, config: FlowConfig): void => {
  state.cancelRequested.current = true;
  state.setWritingStatus("Stopping writing…");
  if (!state.draft || !state.generation.current) return;
  void cancelWriting(state, config, state.draft, state.generation.current).catch(
    (error: unknown) => {
      state.report(error, "Could not stop writing.");
    },
  );
};

const copyMarkdown = (state: FlowState, config: FlowConfig): void => {
  void navigator.clipboard.writeText(state.editor.buffer).then(
    () => {
      config.onNotice("Markdown copied.");
    },
    (error: unknown) => {
      state.report(error, "Could not copy Markdown.");
    },
  );
};

const EditorRoute = ({
  state,
  config,
}: {
  state: FlowState;
  config: FlowConfig;
}): ReactElement | null =>
  state.draft ? (
    <MarkdownWorkspaceView
      title={state.draft.comparison.projectName}
      subtitle={state.draft.title}
      markdown={state.editor.buffer}
      saveState={state.editor.state}
      exportDisabled={state.busy}
      editorDisabled={state.busy}
      onMarkdownChange={state.editor.change}
      onCopy={() => {
        copyMarkdown(state, config);
      }}
      onExport={() => {
        void exportCurrent(state, config);
      }}
      onDashboard={() => {
        void leaveEditor(state, () => {
          state.setPage("dashboard");
        });
      }}
    />
  ) : null;

const FlowRoute = ({
  state,
  config,
}: {
  state: FlowState;
  config: FlowConfig;
}): ReactElement | null => {
  switch (state.page) {
    case "dashboard":
      return <DashboardRoute state={state} config={config} />;
    case "changes":
      return <ChangesRoute state={state} config={config} />;
    case "style":
      return <StyleRoute state={state} config={config} />;
    case "writing":
      return <WritingRoute state={state} config={config} />;
    case "editor":
      return <EditorRoute state={state} config={config} />;
  }
};

/**
 * Renders the signed-in dashboard, Git wizard, and exact Markdown editor.
 *
 * @param config Trusted actions, account model selection, and session callbacks.
 * @returns The signed-in Studio flow.
 */
export const StudioFlow = (config: FlowConfig): ReactElement => {
  const state = useFlowState(config);
  useComparison(state, config);
  useWritingPoll(state, config);
  useEffect(() => {
    if (state.page !== "editor") config.clearSuccessNotice?.();
  }, [state.page]);
  return (
    <main className="rs-app">
      <StudioTopBar
        disabled={state.busy}
        signOut={() => {
          void signOutSafely(state, config);
        }}
      />
      <FlowRoute state={state} config={config} />
    </main>
  );
};
