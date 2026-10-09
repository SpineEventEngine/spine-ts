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

import { randomUUID } from "node:crypto";
import {
  clone,
  create,
  createRegistry,
  equals,
  toJson,
  type MessageShape,
} from "@bufbuild/protobuf";
import { createRouterTransport } from "@connectrpc/connect";
import {
  AiRegistry,
  AgentHistoryCursorSchema,
  type HistoryRead,
  type AiScope,
  type ModelRef,
} from "@spine-event-engine/ai";
import { Client, type SubscriptionDelivery } from "@spine-event-engine/client-node";
import { AnyMessages, Time, TypeUrls } from "@spine-event-engine/core";
import {
  ActorContextSchema,
  EventIdSchema,
  EventSchema,
  UserIdSchema,
  VersionSchema,
  type EventId,
} from "@spine-event-engine/proto";
import { TargetSchema, TopicIdSchema, TopicSchema } from "@spine-event-engine/proto/client";
import {
  AgentHistoryEntrySchema,
  ConversationIdSchema,
  ConversationRecordSchema,
} from "@spine-event-engine/proto/agent";
import { file_spine_core_event as coreEventFile } from "@spine-event-engine/proto/generated/spine/core/event_pb.js";
import { file_spine_core_command as coreCommandFile } from "@spine-event-engine/proto/generated/spine/core/command_pb.js";
import { file_spine_system_server_entity_log_events as entityEventsFile } from "@spine-event-engine/proto/generated/spine/system/server/entity_log_events_pb.js";
import { file_spine_ts_agent_history as agentHistoryFile } from "@spine-event-engine/proto/generated/spine/ts/agent/history_pb.js";
import { file_spine_ts_agent_interaction_events as interactionEventsFile } from "@spine-event-engine/proto/generated/spine/ts/agent/interaction_events_pb.js";
import { file_spine_ts_agent_content as agentContentFile } from "@spine-event-engine/proto/generated/spine/ts/agent/content_pb.js";
import {
  SignalMetadata,
  SpineServices,
  type AgentExecutionStatus,
  type AgentHistoryReader,
} from "@spine-event-engine/server";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";

import {
  ApproveReleaseNotesSchema,
  EditReleaseNotesSchema,
  OpenReleaseDraftSchema,
  PrepareReleaseNotesExportSchema as PrepareExportSchema,
  RequestReleaseGenerationSchema,
} from "../../generated/spine/examples/releasenotes/commands_pb.js";
import {
  file_spine_examples_releasenotes_events as releaseEventsFile,
  ReleaseGenerationRequestedSchema,
  ReleaseNotesExportPreparedSchema as ExportPreparedSchema,
} from "../../generated/spine/examples/releasenotes/events_pb.js";
import { file_spine_examples_releasenotes_types as releaseTypesFile } from "../../generated/spine/examples/releasenotes/types_pb.js";
import { ReleaseGenerationInputsConflictSchema as GenerationInputsConflictSchema } from "../../generated/spine/examples/releasenotes/rejections_pb.js";
import { ReleaseDraftStateSchema } from "../../generated/spine/examples/releasenotes/states_pb.js";
import {
  GitCommitIdSchema,
  ReleaseChangeSchema,
  ReleaseCommitSchema,
  ReleaseComparisonPolicy,
  ReleaseComparisonSchema,
  ReleaseDraftIdSchema,
  ReleaseEvidenceCatalogSchema,
  ReleaseEvidenceSchema,
  ReleaseGenerationIdSchema,
  ReleaseInstructionSchema,
  ReleaseModelSelectionSchema,
  ReleaseNotesDocumentSchema,
  ReleaseTitleSchema,
  RepositorySelectionIdSchema,
} from "../../generated/spine/examples/releasenotes/types_pb.js";
import { ReleaseNotesAgent, ReleaseNotesContext } from "../domain/index.js";
import { ReleaseMarkdown } from "../domain/markdown.js";
import {
  GitReleaseComparison,
  type GitChange,
  type GitCommit,
  type GitEvidence,
} from "./git-release.js";
import { ReleaseGitRegistration } from "./git-mcp-registration.js";
import type { PlanModelSelection } from "./plan-model-selection.js";

const historyTypes = createRegistry(
  releaseEventsFile,
  releaseTypesFile,
  coreEventFile,
  coreCommandFile,
  entityEventsFile,
  agentHistoryFile,
  interactionEventsFile,
  agentContentFile,
);

/**
 * Fixed local process paths and the trusted account selection service.
 */
export interface StudioStartOptions {
  /**
   * Git executable selected by the trusted Electron main process.
   */
  readonly gitExecutable: string;

  /**
   * Electron or Node executable used for the scoped Git worker.
   */
  readonly workerExecutable: string;

  /**
   * Absolute path to the packaged worker entry.
   */
  readonly workerPath: string;

  /**
   * Fixed working directory passed to the worker process.
   */
  readonly workerCwd: string;

  /**
   * Generated handler registry root for the packaged Bounded Context.
   */
  readonly registryRoot?: URL;

  /**
   * Trusted account model selection and credential connection.
   */
  readonly plan: Pick<PlanModelSelection, "activeBinding">;
}

/**
 * Complete selected comparison without exposing the repository path to the renderer.
 */
export interface StudioComparison {
  /**
   * Identifier retained for the selected immutable comparison.
   */
  readonly selectionId: string;

  /**
   * Resolved base commit identifier.
   */
  readonly base: string;

  /**
   * Resolved target commit identifier.
   */
  readonly target: string;

  /**
   * Net committed file changes in the accepted range.
   */
  readonly changes: readonly GitChange[];

  /**
   * Commits reachable from target beyond the selected base.
   */
  readonly commits: readonly GitCommit[];

  /**
   * Per-parent committed evidence available to the Agent and editor.
   */
  readonly evidence: readonly GitEvidence[];
}

/**
 * Atomic draft state and framework Version for editor concurrency checks.
 */
export interface StudioDraft {
  /**
   * Typed release draft identifier transported as a string.
   */
  readonly id: string;

  /**
   * Actual framework Version paired with this state snapshot.
   */
  readonly version: MessageShape<typeof VersionSchema>;

  /**
   * Release title supplied by the editor.
   */
  readonly title: string;

  /**
   * Reader audience supplied by the editor.
   */
  readonly audience: string;

  /**
   * Immutable comparison selected when the draft was opened.
   */
  readonly comparison: StudioComparison;

  /**
   * Latest authoritative generation status for this draft.
   */
  readonly generationStatus: string;

  /**
   * Structured editable release notes and citations.
   */
  readonly document: MessageShape<typeof ReleaseNotesDocumentSchema>;

  /**
   * Digest of the exactly approved Markdown, when approved.
   */
  readonly approvalDigest?: string;
}

/**
 * One bounded indexed history page encoded as Protobuf JSON for the renderer.
 */
export interface StudioHistoryPage {
  /**
   * Bounded history records encoded as Protobuf JSON.
   */
  readonly items: readonly unknown[];

  /**
   * Cursor for the next older page, when available.
   */
  readonly cursor?: string;
}

interface GenerationAdmission {
  readonly draftId: string;
  readonly comparison: GitReleaseComparison;
  readonly comparisonValue: MessageShape<typeof ReleaseComparisonSchema>;
  readonly command: MessageShape<typeof RequestReleaseGenerationSchema>;
  readonly model: ModelRef;
  actor?: AiScope["actor"];
  sourceEventId?: EventId;
  rejection?: "inputs-conflict";
}

const Admission = {
  /**
   * Matches an accepted generation Event against its submitted Command snapshot.
   *
   * @param admission Immutable comparison and Command retained at admission.
   * @param event Authoritative generation Event delivered by the Bounded Context.
   * @returns Whether every model-visible input field remains identical.
   */
  eventMatches(
    admission: GenerationAdmission,
    event: MessageShape<typeof ReleaseGenerationRequestedSchema>,
  ): boolean {
    return (
      event.id?.value === admission.draftId &&
      event.generation?.value === admission.command.generation?.value &&
      event.inputVersion !== undefined &&
      admission.command.expectedVersion !== undefined &&
      event.comparison !== undefined &&
      event.catalog !== undefined &&
      admission.command.catalog !== undefined &&
      event.selection !== undefined &&
      admission.command.selection !== undefined &&
      equals(VersionSchema, event.inputVersion, admission.command.expectedVersion) &&
      equals(ReleaseComparisonSchema, event.comparison, admission.comparisonValue) &&
      equals(ReleaseEvidenceCatalogSchema, event.catalog, admission.command.catalog) &&
      equals(ReleaseModelSelectionSchema, event.selection, admission.command.selection) &&
      event.instruction?.value === admission.command.instruction?.value &&
      event.conversation?.value === admission.command.conversation?.value
    );
  },

  /**
   * Checks the Agent scope and accepted source Event before model resolution.
   *
   * @param admission Immutable generation admission.
   * @param event Authoritative source Event for the Agent operation.
   * @param scope Framework actor, tenant, and Agent scope.
   * @returns Whether this operation matches the accepted draft and actor.
   */
  matches(
    admission: GenerationAdmission,
    event: MessageShape<typeof ReleaseGenerationRequestedSchema>,
    scope: AiScope,
  ): boolean {
    const agent = scope.agent.id && AnyMessages.unpack(scope.agent.id, ReleaseDraftIdSchema);
    return (
      scope.tenant.kind === "single-tenant" &&
      scope.actor.actor?.value === "guest" &&
      agent?.value === admission.draftId &&
      Admission.eventMatches(admission, event)
    );
  },
};

/**
 * Trusted in-memory release workflow over the public in-process Spine client.
 */
export class ReleaseStudio {
  /**
   * Comparisons pinned to accepted Git object identifiers.
   */
  private readonly comparisons = new Map<string, GitReleaseComparison>();

  /**
   * Model registrations already appended to this Bounded Context.
   */
  private readonly registeredModels = new Set<string>();

  /**
   * Draft identifiers retained for the current in-memory session.
   */
  private readonly drafts = new Set<string>();

  /**
   * Latest generation identifier for each draft in this session.
   */
  private readonly generations = new Map<string, string>();

  /**
   * Source Event subscription activated before generation Commands are posted.
   */
  private sourceSubscription?: { cancel(): Promise<void> };

  /**
   * Typed rejection observation activated before generation Commands are posted.
   */
  private rejectionSubscription?: { cancel(): Promise<void> };

  /**
   * Prevents overlapping selection and generation admission.
   */
  private selectingGeneration = false;

  /**
   * Reserves account and model mutation until its trusted action settles.
   */
  private accountTransition = false;

  /**
   * Shared completion for Bounded Context shutdown.
   */
  private closing?: Promise<void>;

  /**
   * Binds the public client, Bounded Context, and accepted-source maps for one session.
   *
   * @param options Fixed worker and account services.
   * @param context Running release-notes Bounded Context.
   * @param client Public in-process client for Commands and subscriptions.
   * @param registry AI registrations available to this Bounded Context.
   * @param admissions Accepted generation snapshots by generation identifier.
   * @param bySource Accepted generation snapshots by source Event identifier.
   */
  private constructor(
    private readonly options: StudioStartOptions,
    private readonly context: Awaited<ReturnType<typeof ReleaseNotesContext.create>>,
    private readonly client: ReturnType<typeof Client.usingTransport>,
    private readonly registry: AiRegistry,
    private readonly admissions: Map<string, GenerationAdmission>,
    private readonly bySource: Map<string, GenerationAdmission>,
  ) {}

  /**
   * Starts a fresh in-memory session without restoring drafts or inference.
   *
   * @param options Fixed worker and account services from the Electron main process.
   * @returns Ready trusted release workflow.
   */
  static async start(options: StudioStartOptions): Promise<ReleaseStudio> {
    const registry = ReleaseStudio.aiRegistry();
    const admissions = new Map<string, GenerationAdmission>();
    const bySource = new Map<string, GenerationAdmission>();
    ReleaseStudio.registerGit(registry, options, bySource);
    const context = await ReleaseNotesContext.create(registry, new InMemoryStorageFactory(), {
      ...(options.registryRoot ? { registryRoot: options.registryRoot } : {}),
      resolveModel: (kind, scope, source) =>
        ReleaseStudio.bindModel(kind, scope, source, admissions, bySource),
    });
    const services = new SpineServices({ contexts: [context] });
    const client = Client.usingTransport(
      createRouterTransport((router) => services.register(router)),
    );
    const studio = new ReleaseStudio(options, context, client, registry, admissions, bySource);
    try {
      await studio.startSourceObservation();
      await studio.startRejectionObservation();
      return studio;
    } catch (error) {
      await studio.close();
      throw error;
    }
  }

  /**
   * Creates the bounded AI registry with source-aware model resolution.
   *
   * @returns Registry configured for the release-notes Agent.
   */
  private static aiRegistry(): AiRegistry {
    return AiRegistry.create({
      defaultModels: {},
      invocationLimits: {
        operations: 1,
        modelRequests: 3,
        toolCalls: 6,
        recordedReads: 0,
        deadlineMs: 120_000,
        totalInputBytes: 256_000,
        totalOutputBytes: 1_000_000,
        maxRecoveryBytes: 1_000_000,
      },
      concurrentOperations: 1,
      queuedOperations: 0,
    });
  }

  /**
   * Registers the scoped Git MCP worker without accepting model-selected paths.
   *
   * @param registry AI registry for this Bounded Context.
   * @param options Fixed executable and worker paths.
   * @param bySource Accepted comparison binding indexed by source Event.
   */
  private static registerGit(
    registry: AiRegistry,
    options: StudioStartOptions,
    bySource: ReadonlyMap<string, GenerationAdmission>,
  ): void {
    registry.registerTools(
      ReleaseGitRegistration.create({
        executable: options.workerExecutable,
        workerPath: options.workerPath,
        cwd: options.workerCwd,
        resolveComparison: (scope) => {
          const event = scope.source.id && AnyMessages.unpack(scope.source.id, EventIdSchema);
          const admission = event ? bySource.get(event.value) : undefined;
          const agent = scope.agent.id && AnyMessages.unpack(scope.agent.id, ReleaseDraftIdSchema);
          return admission &&
            admission.draftId === agent?.value &&
            admission.actor &&
            scope.tenant.kind === "single-tenant" &&
            equals(ActorContextSchema, scope.actor, admission.actor)
            ? admission.comparison
            : undefined;
        },
      }),
    );
  }

  /**
   * Resolves only the selected model bound to an accepted generation Event.
   *
   * @param kind Agent operation kind being resolved.
   * @param scope Framework actor, tenant, and Agent scope.
   * @param source Original accepted source Event payload.
   * @param admissions Generation snapshots retained before Command posting.
   * @param bySource Accepted source Event bindings for MCP lookup.
   * @returns Authorized model reference, or no model for an unrelated Event.
   */
  private static bindModel(
    kind: string,
    scope: AiScope,
    source: Parameters<
      NonNullable<NonNullable<Parameters<typeof ReleaseNotesContext.create>[2]>["resolveModel"]>
    >[2],
    admissions: ReadonlyMap<string, GenerationAdmission>,
    bySource: Map<string, GenerationAdmission>,
  ): ModelRef | undefined {
    if (kind !== "generation") return undefined;
    const event = AnyMessages.unpack(source, ReleaseGenerationRequestedSchema);
    if (!event) return undefined;
    const admission = admissions.get(event.generation?.value ?? "");
    if (!admission || !Admission.matches(admission, event, scope))
      throw new Error("Accepted release generation identity does not match its binding.");
    const sourceId = scope.source.id && AnyMessages.unpack(scope.source.id, EventIdSchema);
    if (
      !sourceId?.value ||
      (admission.sourceEventId && admission.sourceEventId.value !== sourceId.value)
    )
      throw new Error("Accepted release generation source Event does not match its binding.");
    admission.actor = clone(ActorContextSchema, scope.actor);
    admission.sourceEventId = sourceId;
    bySource.set(sourceId.value, admission);
    return admission.model;
  }

  /**
   * Activates source Event observation before any generation Command is posted.
   *
   * @returns Completion once the subscription can receive authoritative Events.
   */
  private async startSourceObservation(): Promise<void> {
    const topic = create(TopicSchema, {
      id: create(TopicIdSchema, { value: randomUUID() }),
      target: create(TargetSchema, {
        type: TypeUrls.derive(ReleaseGenerationRequestedSchema),
        criterion: { case: "includeAll", value: true },
      }),
      context: new SignalMetadata().actorContext({
        actor: create(UserIdSchema, { value: "guest" }),
      }),
    });
    const subscription = await this.client.asGuest().createSubscription(topic, { kind: "event" });
    this.sourceSubscription = subscription;
    await subscription.activate();
    void this.observeSources(subscription.updates);
  }

  /**
   * Records source Event identifiers independently of model resolution timing.
   *
   * @param updates Activated public Event delivery stream.
   * @returns Completion when observation stops.
   */
  private async observeSources(updates: AsyncIterable<SubscriptionDelivery>): Promise<void> {
    try {
      for await (const delivery of updates) {
        const update = delivery.kind === "update" ? delivery.update : undefined;
        const events = update?.update.case === "eventUpdates" ? update.update.value.event : [];
        for (const event of events) {
          const value =
            event.message && AnyMessages.unpack(event.message, ReleaseGenerationRequestedSchema);
          const admission = this.admissions.get(value?.generation?.value ?? "");
          if (
            admission &&
            value &&
            event.id?.value &&
            Admission.eventMatches(admission, value) &&
            (!admission.sourceEventId || admission.sourceEventId.value === event.id.value)
          )
            admission.sourceEventId = event.id;
        }
      }
    } catch {
      // An unobserved source stays unknown and therefore locked.
    }
  }

  /**
   * Activates the typed generation rejection stream before Command admission.
   *
   * @returns Completion once the subscription can receive rejection Events.
   */
  private async startRejectionObservation(): Promise<void> {
    const topic = create(TopicSchema, {
      id: create(TopicIdSchema, { value: randomUUID() }),
      target: create(TargetSchema, {
        type: TypeUrls.derive(GenerationInputsConflictSchema),
        criterion: { case: "includeAll", value: true },
      }),
      context: new SignalMetadata().actorContext({
        actor: create(UserIdSchema, { value: "guest" }),
      }),
    });
    const subscription = await this.client.asGuest().createSubscription(topic, { kind: "event" });
    this.rejectionSubscription = subscription;
    await subscription.activate();
    void this.observeRejections(subscription.updates);
  }

  /**
   * Records only rejections that match a submitted draft and generation.
   *
   * @param updates Activated public Event delivery stream.
   * @returns Completion when rejection observation stops.
   */
  private async observeRejections(updates: AsyncIterable<SubscriptionDelivery>): Promise<void> {
    try {
      for await (const delivery of updates) {
        const update = delivery.kind === "update" ? delivery.update : undefined;
        const events = update?.update.case === "eventUpdates" ? update.update.value.event : [];
        for (const event of events) {
          const rejected =
            event.message && AnyMessages.unpack(event.message, GenerationInputsConflictSchema);
          const admission = this.admissions.get(rejected?.generation?.value ?? "");
          if (admission && rejected?.id?.value === admission.draftId)
            admission.rejection = "inputs-conflict";
        }
      }
    } catch {
      // A lost observation remains unknown and keeps admission locked.
    }
  }

  /**
   * Records one native-selected repository comparison using full commit object IDs.
   *
   * @param repository Directory returned by the trusted native picker.
   * @param base Revision selector entered by the editor.
   * @param target Revision selector entered by the editor.
   * @returns Selection reference and bounded verified change summary.
   */
  async compare(repository: string, base: string, target: string): Promise<StudioComparison> {
    const comparison = await GitReleaseComparison.open({
      repository,
      gitExecutable: this.options.gitExecutable,
      base,
      target,
    });
    const selectionId = randomUUID();
    this.comparisons.set(selectionId, comparison);
    return this.selection(selectionId, comparison);
  }

  /**
   * Reads only an indexed entry of a pinned, recorded evidence catalog.
   *
   * @param selectionId Trusted comparison reference.
   * @param index Evidence position presented by the read-only catalog.
   * @returns Bounded committed patch or explicit reason for unavailable text.
   */
  async evidencePatch(
    selectionId: string,
    index: number,
  ): Promise<{ complete: boolean; patch?: string; reason?: string }> {
    const comparison = this.comparisons.get(selectionId);
    if (!comparison || !Number.isInteger(index) || index < 0 || index >= comparison.evidence.length)
      throw new Error("Selected evidence is unavailable.");
    const evidence = comparison.evidence[index];
    if (!evidence) throw new Error("Selected evidence is unavailable.");
    return comparison.readChangePatch(evidence);
  }

  /**
   * Opens one draft with the public client using a pinned comparison.
   *
   * @param selectionId Trusted comparison reference returned by compare.
   * @param title Nonblank release title from the editor.
   * @param audience Nonblank intended readership from the editor.
   * @returns State and Version read together after the Command is accepted.
   */
  async openDraft(selectionId: string, title: string, audience: string): Promise<StudioDraft> {
    const comparison = this.comparisons.get(selectionId);
    if (!comparison) throw new Error("Selected comparison is unavailable.");
    if (!title.trim() || title.length > 200 || !audience.trim() || audience.length > 500)
      throw new Error("Release title and audience must be bounded and nonblank.");
    const id = randomUUID();
    const result = await this.client.asGuest().post(
      OpenReleaseDraftSchema,
      create(OpenReleaseDraftSchema, {
        id: create(ReleaseDraftIdSchema, { value: id }),
        title: create(ReleaseTitleSchema, { value: title }),
        comparison: create(ReleaseComparisonSchema, {
          repository: create(RepositorySelectionIdSchema, { value: selectionId }),
          base: create(GitCommitIdSchema, { value: comparison.baseCommit }),
          target: create(GitCommitIdSchema, { value: comparison.targetCommit }),
          policy: ReleaseComparisonPolicy.ANCESTOR_NET_TREE,
        }),
        audience,
      }),
    );
    if (result.kind !== "ok") throw new Error("Opening the release draft was not accepted.");
    this.drafts.add(id);
    return this.awaitDraft(id, () => true);
  }

  /**
   * Reads the authoritative Aggregate state and Version as one committed snapshot.
   *
   * @param id Draft identifier issued by this session.
   * @returns Detached editor snapshot with its exact Version.
   */
  async readDraft(id: string): Promise<StudioDraft> {
    if (!this.drafts.has(id)) throw new Error("Release draft is unavailable.");
    const record = await this.context
      .stand()
      .readVersioned(ReleaseDraftStateSchema, create(ReleaseDraftIdSchema, { value: id }));
    if (!record?.state || !record.version) throw new Error("Release draft is unavailable.");
    const selectionId = record.state.comparison?.repository?.value ?? "";
    const comparison = this.comparisons.get(selectionId);
    if (!comparison) throw new Error("Release comparison is unavailable.");
    return {
      id,
      version: clone(VersionSchema, record.version),
      title: record.state.title?.value ?? "",
      audience: record.state.audience,
      comparison: this.selection(selectionId, comparison),
      generationStatus: record.state.generationStatus,
      document: clone(
        ReleaseNotesDocumentSchema,
        record.state.document ?? create(ReleaseNotesDocumentSchema),
      ),
      ...(record.state.approval ? { approvalDigest: record.state.approval.digest } : {}),
    };
  }

  /**
   * Replaces the structured document at the exact Version displayed by the editor.
   *
   * @param id Selected draft identifier.
   * @param version Version read with the displayed state.
   * @param document Complete structured replacement.
   * @returns Committed draft snapshot after acceptance.
   */
  async edit(
    id: string,
    version: MessageShape<typeof VersionSchema>,
    document: MessageShape<typeof ReleaseNotesDocumentSchema>,
  ): Promise<StudioDraft> {
    if (!this.drafts.has(id)) throw new Error("Release draft is unavailable.");
    await this.assertCurrentVersion(id, version);
    const result = await this.client.asGuest().post(
      EditReleaseNotesSchema,
      create(EditReleaseNotesSchema, {
        id: create(ReleaseDraftIdSchema, { value: id }),
        expectedVersion: clone(VersionSchema, version),
        document: clone(ReleaseNotesDocumentSchema, document),
      }),
    );
    if (result.kind !== "ok") throw new Error("The displayed draft Version is stale.");
    return this.awaitDraft(
      id,
      (draft) =>
        !equals(VersionSchema, draft.version, version) &&
        equals(ReleaseNotesDocumentSchema, draft.document, document),
    );
  }

  /**
   * Renders exact review bytes from one authoritative draft snapshot.
   *
   * @param id Selected draft identifier.
   * @returns Version, immutable Markdown bytes, and matching digest.
   */
  async preview(id: string): Promise<{
    readonly version: MessageShape<typeof VersionSchema>;
    readonly markdown: Uint8Array;
    readonly digest: string;
  }> {
    if (!this.drafts.has(id)) throw new Error("Release draft is unavailable.");
    const read = await this.context
      .stand()
      .readVersioned(ReleaseDraftStateSchema, create(ReleaseDraftIdSchema, { value: id }));
    if (!read?.state.title || !read.state.document || !read.version)
      throw new Error("Release draft is unavailable.");
    const markdown = ReleaseMarkdown.render(read.state.title, read.state.document);
    return {
      version: clone(VersionSchema, read.version),
      markdown,
      digest: ReleaseMarkdown.digest(markdown),
    };
  }

  /**
   * Records approval of only the exact displayed Markdown and Entity Version.
   *
   * @param id Selected draft identifier.
   * @param version Version displayed with the Markdown preview.
   * @param markdown Exact UTF-8 bytes displayed to the editor.
   * @returns Committed draft with its approved digest.
   */
  async approve(
    id: string,
    version: MessageShape<typeof VersionSchema>,
    markdown: Uint8Array,
  ): Promise<StudioDraft> {
    if (!this.drafts.has(id) || markdown.length > 1_000_000)
      throw new Error("Approval is unavailable.");
    await this.assertCurrentVersion(id, version);
    const digest = ReleaseMarkdown.digest(markdown);
    const result = await this.client.asGuest().post(
      ApproveReleaseNotesSchema,
      create(ApproveReleaseNotesSchema, {
        id: create(ReleaseDraftIdSchema, { value: id }),
        expectedVersion: clone(VersionSchema, version),
        markdown: new Uint8Array(markdown),
        digest,
      }),
    );
    if (result.kind !== "ok") throw new Error("Approval no longer matches the current draft.");
    return this.awaitDraft(
      id,
      (draft) => !equals(VersionSchema, draft.version, version) && draft.approvalDigest === digest,
    );
  }

  /**
   * Returns only bytes from a newly correlated authoritative export Event.
   * A missing or uncertain Event never grants permission to write a file.
   *
   * @param id Selected draft identifier.
   * @param version Version displayed with the approved draft.
   * @returns Exact immutable approved Markdown bytes.
   */
  async prepareExport(
    id: string,
    version: MessageShape<typeof VersionSchema>,
  ): Promise<Uint8Array> {
    if (!this.drafts.has(id)) throw new Error("Release draft is unavailable.");
    await this.assertCurrentVersion(id, version);
    const topic = create(TopicSchema, {
      id: create(TopicIdSchema, { value: randomUUID() }),
      target: create(TargetSchema, {
        type: TypeUrls.derive(ExportPreparedSchema),
        criterion: { case: "includeAll", value: true },
      }),
      context: new SignalMetadata().actorContext({
        actor: create(UserIdSchema, { value: "guest" }),
      }),
    });
    const subscription = await this.client.asGuest().createSubscription(topic, { kind: "event" });
    try {
      await subscription.activate();
      const iterator = subscription.updates[Symbol.asyncIterator]();
      const next = iterator.next();
      const result = await this.client.asGuest().post(
        PrepareExportSchema,
        create(PrepareExportSchema, {
          id: create(ReleaseDraftIdSchema, { value: id }),
          expectedVersion: clone(VersionSchema, version),
        }),
      );
      if (result.kind !== "ok") throw new Error("Export preparation was not accepted.");
      return await this.awaitExport(next, iterator, id, version);
    } finally {
      await subscription.cancel();
    }
  }

  /**
   * Awaits a newly delivered export Event that matches the draft and predispatch Version.
   *
   * @param first Delivery already requested before posting the export Command.
   * @param iterator Activated public Event subscription iterator.
   * @param id Draft identifier being exported.
   * @param version Framework Version submitted with export preparation.
   * @returns Exact approved bytes from the correlated Event.
   */
  private async awaitExport(
    first: Promise<IteratorResult<SubscriptionDelivery>>,
    iterator: AsyncIterator<SubscriptionDelivery>,
    id: string,
    version: MessageShape<typeof VersionSchema>,
  ): Promise<Uint8Array> {
    const deadline = Time.currentTimeMillis() + 5_000;
    let pending = first;
    while (Time.currentTimeMillis() < deadline) {
      const delivery = await this.exportDelivery(pending, deadline);
      if (delivery.done) break;
      const update = delivery.value.kind === "update" ? delivery.value.update : undefined;
      const events = update?.update.case === "eventUpdates" ? update.update.value.event : [];
      for (const event of events) {
        const bytes = this.exportBytes(event, id, version);
        if (bytes) return bytes;
      }
      pending = iterator.next();
    }
    throw new Error("Export Event is not yet confirmed.");
  }

  /**
   * Waits for one subscription delivery within the export confirmation deadline.
   *
   * @param pending Next Event delivery from the subscription.
   * @param deadline Absolute runtime time at which confirmation becomes unknown.
   * @returns Delivery observed before the deadline.
   */
  private async exportDelivery(
    pending: Promise<IteratorResult<SubscriptionDelivery>>,
    deadline: number,
  ): Promise<IteratorResult<SubscriptionDelivery>> {
    const timer = new AbortController();
    const timeout = new Promise<never>((_resolve, reject) => {
      const handle = setTimeout(
        () => {
          reject(new Error("Export Event is not yet confirmed."));
        },
        Math.max(1, deadline - Time.currentTimeMillis()),
      );
      timer.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(handle);
        },
        { once: true },
      );
    });
    try {
      return await Promise.race([pending, timeout]);
    } finally {
      timer.abort();
    }
  }

  /**
   * Reads bytes only from the correlated authoritative export Event.
   *
   * @param event Delivered Event envelope.
   * @param id Draft identifier expected as event producer and payload.
   * @param version Predispatch Version of the submitted export Command.
   * @returns Detached approved bytes, or undefined for an unrelated Event.
   */
  private exportBytes(
    event: MessageShape<typeof EventSchema>,
    id: string,
    version: MessageShape<typeof VersionSchema>,
  ): Uint8Array | undefined {
    const prepared = event.message && AnyMessages.unpack(event.message, ExportPreparedSchema);
    const producer =
      event.context?.producerId &&
      AnyMessages.unpack(event.context.producerId, ReleaseDraftIdSchema);
    return prepared?.id?.value === id &&
      producer?.value === id &&
      event.context?.version &&
      equals(VersionSchema, event.context.version, version) &&
      prepared.approval
      ? new Uint8Array(prepared.approval.markdown)
      : undefined;
  }

  /**
   * Rejects an editor action when its displayed framework Version is stale.
   *
   * @param id Draft identifier to reread authoritatively.
   * @param expected Version paired with the displayed editor snapshot.
   * @returns Completion after the equality check.
   */
  private async assertCurrentVersion(
    id: string,
    expected: MessageShape<typeof VersionSchema>,
  ): Promise<void> {
    const read = await this.readDraft(id);
    if (!equals(VersionSchema, read.version, expected))
      throw new Error("The displayed draft Version is stale.");
  }

  /**
   * Awaits the authoritative Aggregate outcome matching one accepted editor action.
   *
   * @param id Draft identifier to reread through Stand.
   * @param accepted Predicate matching the intended outcome, beyond a Version change.
   * @returns Confirmed current draft snapshot.
   */
  private async awaitDraft(
    id: string,
    accepted: (draft: StudioDraft) => boolean,
  ): Promise<StudioDraft> {
    const deadline = Time.currentTimeMillis() + 5_000;
    while (Time.currentTimeMillis() < deadline) {
      const record = await this.context
        .stand()
        .readVersioned(ReleaseDraftStateSchema, create(ReleaseDraftIdSchema, { value: id }));
      if (record?.state && record.version) {
        const draft = await this.readDraft(id);
        if (accepted(draft)) return draft;
      }
      await new Promise((done) => setTimeout(done, 20));
    }
    throw new Error(
      "Draft outcome is not yet confirmed; read current state before another action.",
    );
  }

  /**
   * Admits a complete pinned snapshot only for an active plan account and model.
   *
   * @param id Existing draft in this in-memory session.
   * @param instruction Bounded editor instruction for the model.
   * @returns Generation identifier retained for later status and history reads.
   */
  async requestGeneration(id: string, instruction: string): Promise<string> {
    if (!this.drafts.has(id)) throw new Error("Release draft is unavailable.");
    if (this.selectingGeneration || this.accountTransition)
      throw new Error("Wait for the active generation or stop and quit.");
    this.selectingGeneration = true;
    try {
      if (await this.hasActiveGeneration())
        throw new Error("Wait for the active generation or stop and quit.");
      return await this.submitGeneration(id, instruction);
    } finally {
      this.selectingGeneration = false;
    }
  }

  /**
   * Retries only the retained generation Command after an uncertain acknowledgment.
   *
   * @param generation Identifier retained before the first submission.
   * @returns The original identifier after its Aggregate receipt is confirmed.
   */
  async repeatGeneration(generation: string): Promise<string> {
    const admission = this.admissions.get(generation);
    if (!admission || this.generations.get(admission.draftId) !== generation)
      throw new Error("The original generation Command is unavailable.");
    if (admission.rejection) throw new Error("Generation inputs changed; read the current draft.");
    if (this.selectingGeneration || this.accountTransition)
      throw new Error("Wait for the current account or generation action.");
    this.selectingGeneration = true;
    try {
      return await this.sendGeneration(generation, admission.draftId, admission);
    } finally {
      this.selectingGeneration = false;
    }
  }

  /**
   * Acquires account mutation before admission can begin, through the trusted action.
   *
   * @typeParam Result Result returned by the account or model operation.
   * @param action Validated trusted account or model action.
   * @returns Action result after the reservation is released.
   */
  async withAccountTransition<Result>(action: () => Promise<Result>): Promise<Result> {
    if (this.accountTransition || this.selectingGeneration)
      throw new Error("Wait for the current account or generation action.");
    this.accountTransition = true;
    try {
      return await action();
    } finally {
      this.accountTransition = false;
    }
  }

  /**
   * Captures a complete comparison, account, model, and Version before posting generation.
   *
   * @param id Draft identifier already checked in this session.
   * @param instruction Bounded editor instruction recorded in the Command.
   * @returns Generation identifier after the exact receipt is observed.
   */
  private async submitGeneration(id: string, instruction: string): Promise<string> {
    const binding = await this.options.plan.activeBinding();
    if (!binding) throw new Error("Select an available ChatGPT plan model.");
    if (instruction.length > 2_000) throw new Error("Generation instruction exceeds its bound.");
    const read = await this.context
      .stand()
      .readVersioned(ReleaseDraftStateSchema, create(ReleaseDraftIdSchema, { value: id }));
    const selectionId = read?.state.comparison?.repository?.value ?? "";
    const comparison = this.comparisons.get(selectionId);
    if (!read?.state || !read.version || !read.state.comparison || !comparison)
      throw new Error("Release draft or comparison is unavailable.");
    this.registerModel(binding.registration);
    const ref = binding.registration.ref;
    const generation = randomUUID();
    const command = create(RequestReleaseGenerationSchema, {
      id: create(ReleaseDraftIdSchema, { value: id }),
      generation: create(ReleaseGenerationIdSchema, { value: generation }),
      expectedVersion: clone(VersionSchema, read.version),
      catalog: this.catalog(comparison),
      instruction: create(ReleaseInstructionSchema, {
        value: instruction.trim() || "Summarize the selected release changes.",
      }),
      conversation:
        read.state.conversation ?? create(ConversationIdSchema, { value: randomUUID() }),
      selection: this.selectedModel(binding),
    });
    return this.sendGeneration(generation, id, {
      draftId: id,
      comparison,
      comparisonValue: clone(ReleaseComparisonSchema, read.state.comparison),
      command: clone(RequestReleaseGenerationSchema, command),
      model: ref,
    });
  }

  /**
   * Captures the account and model reference selected for this generation.
   *
   * @param binding Trusted account registration and model choice.
   * @returns Protobuf model selection retained in the accepted Command.
   */
  private selectedModel(
    binding: NonNullable<Awaited<ReturnType<PlanModelSelection["activeBinding"]>>>,
  ): MessageShape<typeof ReleaseModelSelectionSchema> {
    return create(ReleaseModelSelectionSchema, {
      registration: binding.clientId,
      account: binding.subject,
      model: binding.registration.ref,
    });
  }

  /**
   * Registers an authorized model once, even after Bounded Context build.
   *
   * @param registration Authorized plan model registration.
   */
  private registerModel(
    registration: NonNullable<
      Awaited<ReturnType<PlanModelSelection["activeBinding"]>>
    >["registration"],
  ): void {
    const ref = registration.ref;
    const key = `${ref.name?.value ?? ""}\0${ref.revision?.value ?? ""}`;
    if (this.registeredModels.has(key)) return;
    this.registry.register(registration);
    this.registeredModels.add(key);
  }

  /**
   * Posts one generation Command while retaining its immutable admission snapshot.
   *
   * @param generation Identifier assigned to this accepted generation.
   * @param id Draft identifier paired with the generation.
   * @param admission Accepted account, model, comparison, and Command snapshot.
   * @returns Identifier after authoritative receipt confirmation.
   */
  private async sendGeneration(
    generation: string,
    id: string,
    admission: GenerationAdmission,
  ): Promise<string> {
    this.admissions.set(generation, admission);
    this.generations.set(id, generation);
    const result = await this.client
      .asGuest()
      .post(RequestReleaseGenerationSchema, admission.command);
    if (result.kind !== "ok") throw new Error("Release generation outcome requires review.");
    await this.awaitReceipt(id, generation);
    return generation;
  }

  /**
   * Lists only the drafts and latest generation identifiers in this live session.
   *
   * @returns Credential-free references for a reloaded renderer.
   */
  session(): { drafts: readonly string[]; generations: Readonly<Record<string, string>> } {
    return { drafts: [...this.drafts], generations: Object.fromEntries(this.generations) };
  }

  /**
   * Verifies the Aggregate retained the exact generation receipt before reporting admission.
   *
   * @param id Draft identifier to read authoritatively.
   * @param generation Submitted generation identifier.
   * @returns Completion when the receipt is visible.
   */
  private async awaitReceipt(id: string, generation: string): Promise<void> {
    const deadline = Time.currentTimeMillis() + 5_000;
    while (Time.currentTimeMillis() < deadline) {
      if (this.admissions.get(generation)?.rejection)
        throw new Error("Generation inputs changed; read the current draft.");
      if (await this.hasReceipt(id, generation)) return;
      await new Promise((done) => setTimeout(done, 20));
    }
    throw new Error("Generation acceptance is unconfirmed; do not start another generation.");
  }

  /**
   * Checks the Aggregate's retained generation receipt without inferring Agent completion.
   *
   * @param id Release draft identifier in this live session.
   * @param generation Submitted generation identifier.
   * @returns Whether the exact generation was accepted by the Aggregate.
   */
  private async hasReceipt(id: string, generation: string): Promise<boolean> {
    const record = await this.context
      .stand()
      .readVersioned(ReleaseDraftStateSchema, create(ReleaseDraftIdSchema, { value: id }));
    return record?.state.receipts.some((item) => item.generation?.value === generation) ?? false;
  }

  /**
   * Reads Aggregate acceptance, correlated rejection, and exact Agent execution status.
   *
   * @param generation Generation retained before its Command was posted.
   * @returns Receipt, rejection, and Agent phase when its source Event is known.
   */
  async generationObservation(generation: string): Promise<{
    receipt: boolean;
    phase: AgentExecutionStatus | undefined;
    rejection?: "inputs-conflict";
  }> {
    const admission = this.admissions.get(generation);
    if (!admission) return { receipt: false, phase: undefined };
    if (admission.rejection)
      return { receipt: false, phase: undefined, rejection: admission.rejection };
    const receipt = await this.hasReceipt(admission.draftId, generation);
    const phase = receipt ? await this.generationPhase(generation) : undefined;
    return { receipt, phase };
  }

  /**
   * Reads the exact Agent execution phase for an accepted generation Event.
   * Missing records and accepted-but-unobserved events remain nonterminal.
   *
   * @param generation Generation identifier returned after Command acceptance.
   * @returns Recorded phase, or undefined while the source Event is unknown.
   */
  async generationPhase(generation: string): Promise<AgentExecutionStatus | undefined> {
    const admission = this.admissions.get(generation);
    if (!admission?.sourceEventId) return undefined;
    return this.context
      .getRepository(ReleaseNotesAgent)
      .agentExecution(
        create(ReleaseDraftIdSchema, { value: admission.draftId }),
        admission.sourceEventId,
        {},
      );
  }

  /**
   * Checks whether account, model, and new-generation changes must remain locked.
   * Unknown and completed-pending-delivery phases remain locked.
   *
   * @returns Whether any accepted or uncertain generation is nonterminal.
   */
  async hasActiveGeneration(): Promise<boolean> {
    for (const admission of this.admissions.values()) {
      if (admission.rejection) continue;
      const phase = await this.generationPhase(admission.command.generation?.value ?? "");
      if (phase !== "completed" && phase !== "terminated") return true;
    }
    return false;
  }

  /**
   * Checks whether account and model changes must remain fenced.
   *
   * @returns Whether selecting another plan binding is unsafe.
   */
  async selectionLocked(): Promise<boolean> {
    return this.selectingGeneration || this.hasActiveGeneration();
  }

  /**
   * Checks renewal against registrations bound to nonterminal generations.
   *
   * @param clientId Issued client registration requested for renewal.
   * @returns Whether reconnect can leave the accepted account binding unchanged.
   */
  async allowsReconnect(clientId: string): Promise<boolean> {
    if (this.selectingGeneration) return false;
    for (const admission of this.admissions.values()) {
      if (admission.rejection) continue;
      const phase = await this.generationPhase(admission.command.generation?.value ?? "");
      if (
        phase !== "completed" &&
        phase !== "terminated" &&
        admission.command.selection?.registration !== clientId
      )
        return false;
    }
    return true;
  }

  /**
   * Reads one newest-first category page from the production Agent history index.
   *
   * @param id Draft identifier issued by this session.
   * @param category History category selected by the editor.
   * @param pageSize Requested bounded page length.
   * @param cursor Optional opaque continuation returned by the repository.
   * @returns Detached indexed history page.
   */
  async history(
    id: string,
    category: "all" | "conversation" | "system" | "domain",
    pageSize: number,
    cursor?: string,
  ): Promise<StudioHistoryPage> {
    if (!this.drafts.has(id)) throw new Error("Release draft is unavailable.");
    if (!Number.isSafeInteger(pageSize) || pageSize < 1)
      throw new Error("History page size must be a positive safe integer.");
    const read = this.context
      .getRepository(ReleaseNotesAgent)
      .agentHistory(create(ReleaseDraftIdSchema, { value: id }), {});
    const request: HistoryRead = {
      pageSize,
      ...(cursor === undefined
        ? {}
        : {
            cursor: create(AgentHistoryCursorSchema, { value: cursor }),
          }),
    };
    if (category === "all") return this.fullHistory(read, request);
    if (category === "system" || category === "domain")
      return this.eventHistory(read, request, category);
    return this.conversationHistory(read, request, id);
  }

  /**
   * Reads and encodes one indexed full-history page for the renderer.
   *
   * @param read Agent repository history reader.
   * @param request Positive page size and optional older cursor.
   * @returns Detached Protobuf JSON records and continuation.
   */
  private async fullHistory(
    read: AgentHistoryReader,
    request: HistoryRead,
  ): Promise<StudioHistoryPage> {
    const page = await read.fullHistory(request);
    return {
      items: page.items.map((item) =>
        toJson(AgentHistoryEntrySchema, item, { registry: historyTypes }),
      ),
      ...(page.nextCursor ? { cursor: page.nextCursor.value } : {}),
    };
  }

  /**
   * Reads one indexed system or domain Event page.
   *
   * @param read Agent repository history reader.
   * @param request Positive page size and optional older cursor.
   * @param category System or domain Event category.
   * @returns Detached Event records and continuation.
   */
  private async eventHistory(
    read: AgentHistoryReader,
    request: HistoryRead,
    category: "system" | "domain",
  ): Promise<StudioHistoryPage> {
    const page =
      category === "system"
        ? await read.systemEventHistory(request)
        : await read.domainEventHistory(request);
    return {
      items: page.items.map((item) => toJson(EventSchema, item, { registry: historyTypes })),
      ...(page.nextCursor ? { cursor: page.nextCursor.value } : {}),
    };
  }

  /**
   * Reads the draft's indexed model and tool conversation page.
   *
   * @param read Agent repository history reader.
   * @param request Positive page size and optional older cursor.
   * @param id Draft whose conversation identifier is read authoritatively.
   * @returns Detached conversation records and continuation.
   */
  private async conversationHistory(
    read: AgentHistoryReader,
    request: HistoryRead,
    id: string,
  ): Promise<StudioHistoryPage> {
    const draft = await this.context
      .stand()
      .readVersioned(ReleaseDraftStateSchema, create(ReleaseDraftIdSchema, { value: id }));
    if (!draft?.state.conversation) {
      if (request.cursor) throw new Error("No generation conversation is available.");
      return { items: [] };
    }
    const page = await read.conversationHistory({
      ...request,
      conversation: draft.state.conversation,
    });
    return {
      items: page.items.map((item) =>
        toJson(ConversationRecordSchema, item, { registry: historyTypes }),
      ),
      ...(page.nextCursor ? { cursor: page.nextCursor.value } : {}),
    };
  }

  /**
   * Copies the accepted Git evidence into the typed Agent input catalog.
   *
   * @param comparison Immutable committed comparison for this draft.
   * @returns Model-visible evidence catalog with typed commit identifiers.
   */
  private catalog(
    comparison: GitReleaseComparison,
  ): MessageShape<typeof ReleaseEvidenceCatalogSchema> {
    return create(ReleaseEvidenceCatalogSchema, {
      commits: comparison.commits.map((item) =>
        create(ReleaseCommitSchema, {
          id: create(GitCommitIdSchema, { value: item.commit }),
          parents: item.parents.map((value) => create(GitCommitIdSchema, { value })),
          subject: item.subject,
        }),
      ),
      changes: comparison.changes.map((item) => create(ReleaseChangeSchema, item)),
      evidence: comparison.evidence.map((item) =>
        create(ReleaseEvidenceSchema, {
          ...item,
          commit: create(GitCommitIdSchema, { value: item.commit }),
          parent: create(GitCommitIdSchema, { value: item.parent }),
        }),
      ),
    });
  }

  /**
   * Closes the client and Bounded Context without persisting session drafts.
   *
   * @returns Completion after the source subscription and runtime close.
   */
  async close(): Promise<void> {
    this.closing ??= (async () => {
      const cancellations = await Promise.allSettled([
        this.sourceSubscription?.cancel(),
        this.rejectionSubscription?.cancel(),
      ]);
      let failure = cancellations.find((item) => item.status === "rejected");
      try {
        await this.client.close();
      } catch (error) {
        failure ??= { status: "rejected", reason: error };
      }
      try {
        await this.context.close();
      } catch (error) {
        failure ??= { status: "rejected", reason: error };
      }
      if (failure?.status === "rejected") throw failure.reason;
    })();
    await this.closing;
  }

  /**
   * Maps a pinned comparison into bounded renderer evidence metadata.
   *
   * @param id Identifier assigned to the selected comparison.
   * @param comparison Immutable Git comparison and evidence catalog.
   * @returns Credential-free comparison summary.
   */
  private selection(id: string, comparison: GitReleaseComparison): StudioComparison {
    return {
      selectionId: id,
      base: comparison.baseCommit,
      target: comparison.targetCommit,
      changes: comparison.changes.map((change) => ({ ...change })),
      commits: comparison.commits.map((commit) => ({ ...commit, parents: [...commit.parents] })),
      evidence: comparison.evidence.map((entry) => ({ ...entry })),
    };
  }
}
