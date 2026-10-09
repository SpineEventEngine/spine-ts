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

import { clone, create, equals, toBinary } from "@bufbuild/protobuf";
import { createHash } from "node:crypto";
import type { AiRegistry } from "@spine-event-engine/ai";
import { VersionSchema } from "@spine-event-engine/proto";
import {
  Agent,
  Aggregate,
  Assign,
  BoundedContext,
  Projection,
  React,
  Subscribe,
  Throws,
  type RepositoryOptions,
} from "@spine-event-engine/server";
import type { StorageFactory } from "@spine-event-engine/storage";

import {
  type ApproveReleaseNotes,
  type ChangeReleaseInputs,
  RequestReleaseGenerationSchema,
  type EditReleaseNotes,
  type OpenReleaseDraft,
  type PrepareReleaseNotesExport,
  type RequestReleaseGeneration,
} from "../../generated/spine/examples/releasenotes/commands_pb.js";
import {
  ReleaseInputsChangedSchema,
  ReleaseGenerationStatusChangedSchema as GenerationStatusSchema,
  ReleaseGenerationFailedSchema,
  ReleaseNotesProposedSchema,
  ReleaseNotesApprovedSchema,
  ReleaseNotesExportPreparedSchema as ExportPreparedSchema,
  ReleaseDraftOpenedSchema,
  ReleaseGenerationAlreadyRequestedSchema as GenerationAcknowledgedSchema,
  ReleaseGenerationRequestedSchema,
  ReleaseNotesEditedSchema,
  ReleaseNotesStagedSchema,
  ReleaseProposalDiscardedSchema,
  type ReleaseDraftOpened,
  type ReleaseInputsChanged,
  type ReleaseGenerationFailed,
  type ReleaseGenerationStatusChanged,
  type ReleaseNotesApproved,
  type ReleaseNotesExportPrepared,
  type ReleaseGenerationAlreadyRequested,
  type ReleaseGenerationRequested,
  type ReleaseNotesEdited,
  type ReleaseNotesProposed,
  type ReleaseNotesStaged,
  type ReleaseProposalDiscarded,
} from "../../generated/spine/examples/releasenotes/events_pb.js";
import {
  ReleaseDraftAlreadyOpen,
  ReleaseGenerationConflict,
  ReleaseExportUnavailable,
  ReleaseInputsConflict,
  StaleReleaseApproval,
  StaleReleaseEdit,
} from "../../generated/spine/examples/releasenotes/rejections.js";
import {
  ReleaseDraftStateSchema,
  ReleaseDraftViewSchema,
  ReleaseNotesAgentStateSchema as AgentStateSchema,
} from "../../generated/spine/examples/releasenotes/states_pb.js";
import {
  ReleaseApprovalSchema,
  ReleaseGenerationReceiptSchema,
  ReleaseNotesDocumentSchema,
  type ReleaseDraftId,
} from "../../generated/spine/examples/releasenotes/types_pb.js";
import { ReleaseMarkdown } from "./markdown.js";
import { draftReleaseNotes } from "./model.js";

/**
 * Retains an editor's current release draft and accepted generation identities.
 */
export class ReleaseDraft extends Aggregate<ReleaseDraftId, typeof ReleaseDraftStateSchema> {
  // prettier-ignore

  /**
   * Opens one draft with a fixed repository selection.
   *
   * @param command Initial editor inputs.
   * @returns The first authoritative draft event.
   */
  @Assign
  @Throws(ReleaseDraftAlreadyOpen)
  open(command: OpenReleaseDraft): ReleaseDraftOpened {
    if (this.version.number !== 0)
      throw ReleaseDraftAlreadyOpen.create({ id: this.id });
    this.update((state) => Object.assign(state, create(ReleaseDraftStateSchema, {
      id: this.id,
      title: command.title,
      comparison: command.comparison,
      audience: command.audience,
      document: create(ReleaseNotesDocumentSchema),
    })));
    return create(ReleaseDraftOpenedSchema, {
      id: this.id,
      title: command.title,
      comparison: command.comparison,
      audience: command.audience,
    });
  }

  // prettier-ignore

  /**
   * Replaces reviewed inputs while retaining the fixed repository selection.
   *
   * @param command New comparison and audience at the displayed Entity Version.
   * @returns Authoritative changed-input event.
   */
  @Assign
  @Throws(ReleaseInputsConflict)
  changeInputs(command: ChangeReleaseInputs): ReleaseInputsChanged {
    if (!command.expectedVersion || !equals(VersionSchema, command.expectedVersion, this.version) ||
        command.comparison?.repository?.value !== this.state.comparison?.repository?.value)
      throw ReleaseInputsConflict.create({ id: this.id });
    const comparisonChanged = command.comparison?.base?.value !== this.state.comparison?.base?.value ||
      command.comparison?.target?.value !== this.state.comparison?.target?.value ||
      command.comparison?.policy !== this.state.comparison?.policy;
    const document = comparisonChanged ? create(ReleaseNotesDocumentSchema) : this.state.document;
    this.update((state) => {
      state.comparison = command.comparison;
      state.audience = command.audience;
      state.document = document;
      state.approval = undefined;
      state.pendingGeneration = undefined;
      state.pendingInputVersion = undefined;
      state.generationStatus = "inputs-changed";
    });
    return create(ReleaseInputsChangedSchema, {
      id: this.id, comparison: command.comparison,
      audience: command.audience, document,
    });
  }

  // prettier-ignore

  /**
   * Publishes a complete snapshot or acknowledges an exact accepted replay.
   *
   * @param command Trusted catalog, instruction, and fixed model selection.
   * @returns An Agent-triggering Event or an idempotent acknowledgement.
   */
  @Assign
  @Throws(ReleaseGenerationConflict, ReleaseInputsConflict)
  requestGeneration(command: RequestReleaseGeneration): ReleaseGenerationRequested | ReleaseGenerationAlreadyRequested {
    const inputDigest = createHash("sha256")
      .update(toBinary(RequestReleaseGenerationSchema, command)).digest("hex");
    const prior = this.state.receipts.find((receipt) =>
      receipt.generation?.value === command.generation?.value);
    if (prior !== undefined) {
      if (prior.inputDigest !== inputDigest)
        throw ReleaseGenerationConflict.create({ id: this.id, generation: command.generation });
      return create(GenerationAcknowledgedSchema, {
        id: this.id, generation: command.generation, inputDigest,
      });
    }
    if (!command.expectedVersion || !equals(VersionSchema, command.expectedVersion, this.version) ||
        command.conversation === undefined ||
        (this.state.conversation !== undefined &&
          this.state.conversation.value !== command.conversation.value))
      throw ReleaseInputsConflict.create({ id: this.id });
    return this.beginGeneration(command, inputDigest);
  }

  /**
   * Starts one accepted generation after the Aggregate checks its Version and identity.
   *
   * @param command Complete accepted input.
   * @param inputDigest Digest of the original submitted command.
   * @returns Snapshot for the per-draft Agent.
   */
  private beginGeneration(
    command: RequestReleaseGeneration,
    inputDigest: string,
  ): ReleaseGenerationRequested {
    this.update((state) => {
      state.pendingGeneration = command.generation;
      state.pendingInputVersion = clone(VersionSchema, this.version);
      state.generationStatus = "requested";
      state.conversation = command.conversation;
      state.receipts.push(
        create(ReleaseGenerationReceiptSchema, {
          generation: command.generation,
          inputDigest,
        }),
      );
    });
    return create(ReleaseGenerationRequestedSchema, {
      id: this.id,
      generation: command.generation,
      inputVersion: clone(VersionSchema, this.version),
      comparison: this.state.comparison,
      catalog: command.catalog,
      audience: this.state.audience,
      instruction: command.instruction,
      currentDocument: this.state.document,
      conversation: command.conversation,
      selection: command.selection,
      inputDigest,
      title: this.state.title,
    });
  }

  // prettier-ignore

  /**
   * Replaces structured notes and invalidates any outstanding proposal.
   *
   * @param command Editor replacement based on the displayed Entity Version.
   * @returns Authoritative edited-document event.
   */
  @Assign
  @Throws(StaleReleaseEdit)
  edit(command: EditReleaseNotes): ReleaseNotesEdited {
    if (!command.expectedVersion || !equals(VersionSchema, command.expectedVersion, this.version) ||
        command.document === undefined)
      throw StaleReleaseEdit.create({ id: this.id });
    this.update((state) => {
      state.document = command.document;
      state.approval = undefined;
      state.pendingGeneration = undefined;
      state.pendingInputVersion = undefined;
      state.generationStatus = "edited";
    });
    return create(ReleaseNotesEditedSchema, { id: this.id, document: command.document });
  }

  // prettier-ignore

  /**
   * Records the exact Markdown rendered from the current structured draft.
   *
   * @param command Displayed Entity Version, digest, and Markdown bytes.
   * @returns Immutable approved snapshot.
   */
  @Assign
  @Throws(StaleReleaseApproval)
  approve(command: ApproveReleaseNotes): ReleaseNotesApproved {
    const title = this.state.title;
    const document = this.state.document;
    if (!command.expectedVersion || !equals(VersionSchema, command.expectedVersion, this.version) || !title || !document)
      throw StaleReleaseApproval.create({ id: this.id });
    const expected = ReleaseMarkdown.render(title, document);
    if (!ReleaseMarkdown.matches(command.markdown, expected) || command.digest !== ReleaseMarkdown.digest(expected))
      throw StaleReleaseApproval.create({ id: this.id });
    const approval = create(ReleaseApprovalSchema, {
      reviewedVersion: clone(VersionSchema, this.version), digest: command.digest, markdown: expected,
    });
    this.update((state) => {
      state.approval = approval;
      state.pendingGeneration = undefined;
      state.pendingInputVersion = undefined;
    });
    return create(ReleaseNotesApprovedSchema, { id: this.id, approval });
  }

  // prettier-ignore

  /**
   * Prepares only a currently approved immutable Markdown snapshot.
   *
   * @param command Current approved Entity Version.
   * @returns Correlated snapshot for a trusted local export.
   */
  @Assign
  @Throws(ReleaseExportUnavailable)
  prepareExport(command: PrepareReleaseNotesExport): ReleaseNotesExportPrepared {
    const approval = this.state.approval;
    const title = this.state.title;
    const document = this.state.document;
    if (!approval || !title || !document ||
        !command.expectedVersion || !equals(VersionSchema, command.expectedVersion, this.version) ||
        !ReleaseMarkdown.matches(approval.markdown, ReleaseMarkdown.render(title, document)) ||
        approval.digest !== ReleaseMarkdown.digest(approval.markdown))
      throw ReleaseExportUnavailable.create({ id: this.id });
    return create(ExportPreparedSchema, { id: this.id, approval });
  }

  // prettier-ignore

  /**
   * Admits only the latest proposal against its historical input Version.
   *
   * @param event Agent proposal with audited operation identity.
   * @returns Staged notes or an explicit stale-proposal decision.
   */
  @React onProposed(event: ReleaseNotesProposed): ReleaseNotesStaged | ReleaseProposalDiscarded {
    if (event.generation?.value !== this.state.pendingGeneration?.value ||
        !event.inputVersion || !this.state.pendingInputVersion ||
        !equals(VersionSchema, event.inputVersion, this.state.pendingInputVersion))
      return create(ReleaseProposalDiscardedSchema, {
        id: this.id, generation: event.generation,
      });
    this.update((state) => {
      state.document = event.document;
      state.approval = undefined;
      state.pendingGeneration = undefined;
      state.pendingInputVersion = undefined;
      state.generationStatus = "staged";
    });
    return create(ReleaseNotesStagedSchema, {
      id: this.id, generation: event.generation, document: event.document,
    });
  }

  // prettier-ignore

  /**
   * Records only a failure for the latest eligible generation.
   *
   * @param event Safe Agent failure with its original generation identity.
   * @returns Authoritative status or no change for an older generation.
   */
  @React onFailed(event: ReleaseGenerationFailed): ReleaseGenerationStatusChanged | undefined {
    if (event.generation?.value !== this.state.pendingGeneration?.value ||
        !event.inputVersion || !this.state.pendingInputVersion ||
        !equals(VersionSchema, event.inputVersion, this.state.pendingInputVersion)) return undefined;
    this.update((state) => {
      state.pendingGeneration = undefined;
      state.pendingInputVersion = undefined;
      state.generationStatus = `failed:${event.reason}`;
    });
    return create(GenerationStatusSchema, {
      id: this.id, generation: event.generation,
      reason: event.reason,
    });
  }
}

/**
 * Drafts one evidence-backed proposal per accepted generation Command.
 */
export class ReleaseNotesAgent extends Agent<ReleaseDraftId, typeof AgentStateSchema> {
  // prettier-ignore

  /**
   * Invokes the selected model for a complete accepted draft snapshot.
   *
   * @param event Original accepted Event and verified evidence catalog.
   * @returns Audited proposal or safe failure for Aggregate admission.
   */
  @React async onRequested(event: ReleaseGenerationRequested): Promise<ReleaseNotesProposed | ReleaseGenerationFailed> {
    if (!event.conversation || !event.generation || !event.inputVersion)
      throw new TypeError("Generation requires its conversation, identity, and input Version.");
    const result = await this.ai.invoke(draftReleaseNotes, {
      call: "draft-release-notes",
      conversation: event.conversation,
      input: event,
    });
    this.update((state) => {
      state.id = this.id;
      state.conversation = event.conversation;
      state.generation = event.generation;
    });
    if (!result.ok) return create(ReleaseGenerationFailedSchema, {
      id: this.id, generation: event.generation,
      inputVersion: event.inputVersion, reason: result.failure.code,
      operation: result.operationId,
    });
    return create(ReleaseNotesProposedSchema, {
      id: this.id, generation: event.generation,
      inputVersion: event.inputVersion, document: result.value,
      operation: result.operationId,
    });
  }
}

/**
 * Shows only authoritative Aggregate decisions to the editor.
 */
export class ReleaseDraftProjection extends Projection<
  ReleaseDraftId,
  typeof ReleaseDraftViewSchema
> {
  /**
   * Records the initial draft after its Aggregate has committed.
   *
   * @param event Accepted draft opening.
   */
  @Subscribe onOpened(event: ReleaseDraftOpened): void {
    this.update((state) =>
      Object.assign(
        state,
        create(ReleaseDraftViewSchema, {
          id: event.id,
          title: event.title,
          comparison: event.comparison,
          audience: event.audience,
          document: create(ReleaseNotesDocumentSchema),
        }),
      ),
    );
  }

  /**
   * Records the latest accepted generation.
   *
   * @param event Authoritative accepted generation Event.
   */
  @Subscribe onRequested(event: ReleaseGenerationRequested): void {
    this.update((state) => {
      state.generation = event.generation;
      state.generationStatus = "requested";
    });
  }

  /**
   * Applies an authoritative comparison or audience change.
   *
   * @param event Accepted replacement inputs and resulting document.
   */
  @Subscribe onInputsChanged(event: ReleaseInputsChanged): void {
    this.update((state) => {
      state.comparison = event.comparison;
      state.audience = event.audience;
      state.document = event.document;
      state.approval = undefined;
      state.generationStatus = "inputs-changed";
    });
  }

  /**
   * Applies an authoritative editor change.
   *
   * @param event Committed editor replacement.
   */
  @Subscribe onEdited(event: ReleaseNotesEdited): void {
    this.update((state) => {
      state.document = event.document;
      state.approval = undefined;
      state.generationStatus = "edited";
    });
  }

  /**
   * Applies a proposal admitted by the Aggregate.
   *
   * @param event Committed proposal decision.
   */
  @Subscribe onStaged(event: ReleaseNotesStaged): void {
    this.update((state) => {
      state.document = event.document;
      state.approval = undefined;
      state.generationStatus = "staged";
      state.generation = event.generation;
    });
  }

  /**
   * Records an Aggregate-confirmed failure for the current generation.
   *
   * @param event Authoritative generation status.
   */
  @Subscribe onGenerationStatusChanged(event: ReleaseGenerationStatusChanged): void {
    this.update((state) => {
      state.generation = event.generation;
      state.generationStatus = `failed:${event.reason}`;
    });
  }

  /**
   * Exposes the authoritative approved snapshot.
   *
   * @param event Exact committed approved snapshot.
   */
  @Subscribe onApproved(event: ReleaseNotesApproved): void {
    this.update((state) => {
      state.approval = event.approval;
    });
  }
}

/**
 * Private application inputs for assembling the Agent repository.
 */
export interface ReleaseContextOptions {
  /**
   * Generated registry root in the current executable layout.
   */
  readonly registryRoot?: URL;

  /**
   * Resolves only the deployment bound to an accepted generation Event.
   */
  readonly resolveModel?: NonNullable<
    RepositoryOptions<typeof ReleaseNotesAgent>["ai"]
  >["resolveModel"];
}

/**
 * Builds the local ReleaseNotes Bounded Context with a trusted AI registry.
 */
export const ReleaseNotesContext: Readonly<{
  create(
    ai: AiRegistry,
    storage?: StorageFactory,
    options?: ReleaseContextOptions,
  ): Promise<BoundedContext>;
}> = Object.freeze({
  /**
   * Builds the in-memory-capable release-notes Bounded Context.
   *
   * @param ai Registry with an authorized concrete generation deployment.
   * @param storage Optional storage factory for tests and local runtime.
   * @param options Application model resolver and generated registry path.
   * @returns Built Bounded Context; the caller closes it after use.
   */
  async create(
    ai: AiRegistry,
    storage?: StorageFactory,
    options: ReleaseContextOptions = {},
  ): Promise<BoundedContext> {
    const builder = BoundedContext.singleTenant("ReleaseNotes")
      .withGeneratedRegistryRoot(options.registryRoot ?? new URL("../..", import.meta.url))
      .withAi(ai)
      .persistSystemEvents()
      .add(ReleaseDraft)
      .add(ReleaseNotesAgent, {
        agentCodeRevision: "release-notes-draft-v1",
        ai: {
          models: [draftReleaseNotes],
          ...(options.resolveModel === undefined ? {} : { resolveModel: options.resolveModel }),
        },
      })
      .add(ReleaseDraftProjection);
    if (storage !== undefined) builder.withStorageFactory(storage);
    return builder.buildAsync();
  },
});
