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

import { fromJson, toJson, type JsonValue } from "@bufbuild/protobuf";
import { app, dialog, type BrowserWindow } from "electron";
import { VersionSchema } from "@spine-event-engine/proto";

import { ReleaseNotesDocumentSchema } from "../../generated/spine/examples/releasenotes/types_pb.js";
import type { StudioIpcCommand } from "./studio-ipc.js";
import type { ReleaseStudio, StudioDraft } from "./studio-service.js";
import { StudioFiles } from "./studio-files.js";

const field = (input: Record<string, unknown> | null, name: string): unknown => input?.[name];
const text = (input: Record<string, unknown> | null, name: string): string =>
  field(input, name) as string;
const version = (input: Record<string, unknown> | null) =>
  fromJson(VersionSchema, field(input, "version") as JsonValue);

/**
 * Projects draft state and routes native release actions for the renderer.
 */
export const StudioDesktop = {
  /**
   * Maps an authoritative draft into credential-free renderer data.
   *
   * @param value Draft state paired with its framework Version.
   * @returns Detached document and comparison fields for IPC.
   */
  draft(value: StudioDraft): Record<string, unknown> {
    return {
      id: value.id,
      version: toJson(VersionSchema, value.version),
      title: value.title,
      audience: value.audience,
      comparison: value.comparison,
      generationStatus: value.generationStatus,
      document: {
        sections: value.document.sections.map((section) => ({
          heading: section.heading,
          entries: section.entries.map((entry) => ({
            text: entry.text,
            evidence: entry.evidence.map((reference) => ({
              commit: { value: reference.commit?.value ?? "" },
              parent: { value: reference.parent?.value ?? "" },
              path: reference.path,
            })),
          })),
        })),
      },
      ...(value.approvalDigest ? { approvalDigest: value.approvalDigest } : {}),
    };
  },

  /**
   * Opens a native directory dialog before accepting a Git comparison.
   *
   * @param window Isolated application window for the dialog.
   * @param studio Trusted in-memory release workflow.
   * @param input Validated base and target revisions.
   * @returns Recorded comparison, or null after cancellation.
   */
  async selectComparison(
    window: BrowserWindow,
    studio: ReleaseStudio,
    input: Record<string, unknown> | null,
  ): Promise<unknown> {
    const selected = await dialog.showOpenDialog(window, {
      title: "Choose release repository",
      properties: ["openDirectory"],
    });
    if (selected.canceled || selected.filePaths.length !== 1) return null;
    return studio.compare(selected.filePaths[0] ?? "", text(input, "base"), text(input, "target"));
  },

  /**
   * Writes only correlated approved bytes to a native-selected path.
   *
   * @param window Isolated application window for the dialog.
   * @param studio Trusted in-memory release workflow.
   * @param input Validated draft identifier and Version.
   * @returns Whether the exact approved export was saved.
   */
  async exportApproved(
    window: BrowserWindow,
    studio: ReleaseStudio,
    input: Record<string, unknown> | null,
  ): Promise<{ saved: boolean }> {
    const selected = await dialog.showSaveDialog(window, {
      title: "Export approved release notes",
      defaultPath: "release-notes.md",
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (selected.canceled || !selected.filePath) return { saved: false };
    const bytes = await studio.prepareExport(text(input, "id"), version(input));
    await StudioFiles.writeApproved(selected.filePath, bytes);
    return { saved: true };
  },

  /**
   * Executes one validated action without accepting paths or executable names from the renderer.
   *
   * @param window Isolated application window for native dialogs.
   * @param studio In-memory release workflow.
   * @param command Validated fixed action.
   * @param input Validated bounded arguments.
   * @returns Credential-free renderer result.
   */
  async action(
    window: BrowserWindow,
    studio: ReleaseStudio,
    command: StudioIpcCommand,
    input: Record<string, unknown> | null,
  ): Promise<unknown> {
    if (
      command === "session" ||
      command === "choose-comparison" ||
      command === "open-draft" ||
      command === "read-draft" ||
      command === "generate" ||
      command === "repeat-generation" ||
      command === "phase" ||
      command === "history" ||
      command === "evidence-patch"
    )
      return this.draftAndHistory(window, studio, command, input);
    return this.reviewAndLifecycle(window, studio, command, input);
  },

  /**
   * Dispatches session, comparison, generation, and history actions.
   *
   * @param window Isolated application window for native comparison selection.
   * @param studio Trusted in-memory release workflow.
   * @param command Fixed action selected by IPC validation.
   * @param input Validated action arguments.
   * @returns Credential-free draft or history result.
   */
  async draftAndHistory(
    window: BrowserWindow,
    studio: ReleaseStudio,
    command: StudioIpcCommand,
    input: Record<string, unknown> | null,
  ): Promise<unknown> {
    switch (command) {
      case "session":
        return studio.session();
      case "choose-comparison":
        return this.selectComparison(window, studio, input);
      case "open-draft":
        return this.openDraft(studio, input);
      case "read-draft":
        return this.draft(await studio.readDraft(text(input, "id")));
      case "generate":
        return {
          generation: await studio.requestGeneration(text(input, "id"), text(input, "instruction")),
        };
      case "repeat-generation":
        return { generation: await studio.repeatGeneration(text(input, "generation")) };
      case "phase":
        return studio.generationObservation(text(input, "generation"));
      case "history":
        return this.history(studio, input);
      case "evidence-patch":
        return studio.evidencePatch(text(input, "selectionId"), field(input, "index") as number);
      default:
        throw new Error("Invalid draft or history action.");
    }
  },

  /**
   * Dispatches editor review, exact export, and shutdown actions.
   *
   * @param window Isolated application window for native export selection.
   * @param studio Trusted in-memory release workflow.
   * @param command Fixed action selected by IPC validation.
   * @param input Validated action arguments.
   * @returns Credential-free review or lifecycle result.
   */
  async reviewAndLifecycle(
    window: BrowserWindow,
    studio: ReleaseStudio,
    command: StudioIpcCommand,
    input: Record<string, unknown> | null,
  ): Promise<unknown> {
    switch (command) {
      case "edit":
        return this.editDraft(studio, input);
      case "preview": {
        const result = await studio.preview(text(input, "id"));
        return {
          version: toJson(VersionSchema, result.version),
          markdown: result.markdown,
          digest: result.digest,
        };
      }
      case "approve":
        return this.approveDraft(studio, input);
      case "export":
        return this.exportApproved(window, studio, input);
      case "stop-quit":
        await studio.close();
        window.destroy();
        app.quit();
        return null;
      default:
        throw new Error("Invalid review or lifecycle action.");
    }
  },

  /**
   * Creates a draft using a previously recorded comparison.
   *
   * @param studio Trusted in-memory release workflow.
   * @param input Validated comparison identifier and draft metadata.
   * @returns Authoritative draft projection.
   */
  async openDraft(studio: ReleaseStudio, input: Record<string, unknown> | null): Promise<unknown> {
    return this.draft(
      await studio.openDraft(
        text(input, "selectionId"),
        text(input, "title"),
        text(input, "audience"),
      ),
    );
  },

  /**
   * Reads a bounded page from an indexed Agent history view.
   *
   * @param studio Trusted in-memory release workflow.
   * @param input Validated category, cursor, and page size.
   * @returns History page with an optional older cursor.
   */
  history(studio: ReleaseStudio, input: Record<string, unknown> | null): Promise<unknown> {
    return studio.history(
      text(input, "id"),
      text(input, "category") as "all" | "conversation" | "system" | "domain",
      field(input, "pageSize") as number,
      field(input, "cursor") as string | undefined,
    );
  },

  /**
   * Applies an editor document against its displayed framework Version.
   *
   * @param studio Trusted in-memory release workflow.
   * @param input Validated draft, Version, and structured document.
   * @returns Updated authoritative draft projection.
   */
  async editDraft(studio: ReleaseStudio, input: Record<string, unknown> | null): Promise<unknown> {
    return this.draft(
      await studio.edit(
        text(input, "id"),
        version(input),
        fromJson(ReleaseNotesDocumentSchema, field(input, "document") as JsonValue),
      ),
    );
  },

  /**
   * Records approval of only the reviewed Markdown bytes and current Version.
   *
   * @param studio Trusted in-memory release workflow.
   * @param input Validated draft, Version, and detached Markdown bytes.
   * @returns Approved authoritative draft projection.
   */
  async approveDraft(
    studio: ReleaseStudio,
    input: Record<string, unknown> | null,
  ): Promise<unknown> {
    return this.draft(
      await studio.approve(
        text(input, "id"),
        version(input),
        field(input, "markdown") as Uint8Array,
      ),
    );
  },
};
