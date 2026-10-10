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

const commands = [
  "session",
  "choose-comparison",
  "open-draft",
  "read-draft",
  "generate",
  "repeat-generation",
  "phase",
  "history",
  "evidence-patch",
  "edit",
  "preview",
  "approve",
  "export",
  "stop-quit",
] as const;

/**
 * Fixed renderer commands permitted at the trusted IPC boundary.
 */
export type StudioIpcCommand = (typeof commands)[number];

/**
 * Checks whether an untrusted command is part of the fixed studio IPC surface.
 *
 * @param command Renderer-supplied name.
 * @returns Whether it is a studio command.
 */
export const isStudioIpcCommand = (command: string): command is StudioIpcCommand =>
  (commands as readonly string[]).includes(command);

const StudioInput = {
  /**
   * Rejects extra fields before an IPC payload reaches the trusted service.
   *
   * @param value Untrusted renderer payload.
   * @param fields Exact permitted field names.
   * @returns Payload after its shape is checked.
   */
  record(value: unknown, fields: readonly string[]): Record<string, unknown> {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== [...fields].sort().join(",")
    )
      throw new Error("Invalid studio action arguments.");
    return value as Record<string, unknown>;
  },

  /**
   * Checks text for control characters forbidden in editor fields.
   *
   * @param value Renderer-supplied text.
   * @returns Whether a control character is present.
   */
  containsControl(value: string): boolean {
    for (let index = 0; index < value.length; index++)
      if (value.charCodeAt(index) < 32) return true;
    return false;
  },

  /**
   * Validates required bounded text without control characters.
   *
   * @param value Untrusted renderer field.
   * @param limit Maximum permitted character count.
   * @returns Validated text.
   */
  text(value: unknown, limit: number): string {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > limit ||
      StudioInput.containsControl(value)
    )
      throw new Error("Invalid studio action text.");
    return value;
  },

  /**
   * Validates a typed identifier transported as a UUID string.
   *
   * @param value Untrusted renderer identifier.
   * @returns Bounded UUID string.
   */
  id(value: unknown): string {
    const result = StudioInput.text(value, 36);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(result))
      throw new Error("Invalid studio reference.");
    return result;
  },

  /**
   * Validates the byte bound and object shape of Protobuf JSON input.
   *
   * @param value Structured-clone editor input.
   * @returns Bounded object for later schema conversion.
   */
  json(value: unknown): unknown {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      JSON.stringify(value).length > 128_000
    )
      throw new Error("Invalid or oversized structured editor value.");
    return value;
  },

  /**
   * Validates comparison revisions without accepting a repository path.
   *
   * @param argument Untrusted comparison input.
   * @returns Bounded base and target revisions.
   */
  comparison(argument: unknown): Record<string, unknown> {
    const input = StudioInput.record(argument, ["base", "target"]);
    return { base: StudioInput.text(input.base, 128), target: StudioInput.text(input.target, 128) };
  },

  /**
   * Validates a draft's selected comparison, title, and audience.
   *
   * @param argument Untrusted draft creation input.
   * @returns Bounded draft metadata.
   */
  draft(argument: unknown): Record<string, unknown> {
    const input = StudioInput.record(argument, ["selectionId", "title", "audience"]);
    return {
      selectionId: StudioInput.id(input.selectionId),
      title: StudioInput.text(input.title, 200),
      audience: StudioInput.text(input.audience, 500),
    };
  },

  /**
   * Validates generation identity and optional editor instruction.
   *
   * @param argument Untrusted generation input.
   * @returns Bounded draft identifier and instruction.
   */
  generation(argument: unknown): Record<string, unknown> {
    const input = StudioInput.record(argument, ["id", "instruction"]);
    if (
      typeof input.instruction !== "string" ||
      input.instruction.length > 2_000 ||
      StudioInput.containsControl(input.instruction)
    )
      throw new Error("Invalid generation instruction.");
    return { id: StudioInput.id(input.id), instruction: input.instruction };
  },

  /**
   * Validates a positive history page size, view, and optional cursor.
   *
   * @param argument Untrusted history paging input.
   * @returns Scoped history query arguments.
   */
  history(argument: unknown): Record<string, unknown> {
    const hasCursor = typeof argument === "object" && argument !== null && "cursor" in argument;
    const input = StudioInput.record(
      argument,
      hasCursor ? ["id", "category", "pageSize", "cursor"] : ["id", "category", "pageSize"],
    );
    if (
      input.category !== "all" &&
      input.category !== "conversation" &&
      input.category !== "system" &&
      input.category !== "domain"
    )
      throw new Error("Invalid history category.");
    if (!Number.isSafeInteger(input.pageSize) || Number(input.pageSize) < 1)
      throw new Error("Invalid history page size.");
    return {
      id: StudioInput.id(input.id),
      category: input.category,
      pageSize: input.pageSize,
      ...(hasCursor ? { cursor: StudioInput.text(input.cursor, 4_096) } : {}),
    };
  },

  /**
   * Validates a position in the accepted committed evidence catalog.
   *
   * @param argument Untrusted evidence selection.
   * @returns Bounded comparison identifier and index.
   */
  evidence(argument: unknown): Record<string, unknown> {
    const input = StudioInput.record(argument, ["selectionId", "index"]);
    if (!Number.isInteger(input.index) || Number(input.index) < 0 || Number(input.index) > 2_000)
      throw new Error("Invalid evidence position.");
    return { selectionId: StudioInput.id(input.selectionId), index: input.index };
  },

  /**
   * Validates a structured edit and the Version paired with it.
   *
   * @param argument Untrusted editor snapshot.
   * @returns Bounded document and Version input.
   */
  edit(argument: unknown): Record<string, unknown> {
    const input = StudioInput.record(argument, ["id", "version", "document"]);
    return {
      id: StudioInput.id(input.id),
      version: StudioInput.json(input.version),
      document: StudioInput.json(input.document),
    };
  },

  /**
   * Copies bounded Markdown bytes before exact approval.
   *
   * @param argument Untrusted approval input.
   * @returns Detached bytes with draft identifier and Version.
   */
  approve(argument: unknown): Record<string, unknown> {
    const input = StudioInput.record(argument, ["id", "version", "markdown"]);
    if (!(input.markdown instanceof Uint8Array) || input.markdown.length > 1_000_000)
      throw new Error("Invalid approval bytes.");
    return {
      id: StudioInput.id(input.id),
      version: StudioInput.json(input.version),
      markdown: new Uint8Array(input.markdown),
    };
  },

  /**
   * Validates export identity and current approved Version.
   *
   * @param argument Untrusted export input.
   * @returns Draft identifier and bounded Version object.
   */
  export(argument: unknown): Record<string, unknown> {
    const input = StudioInput.record(argument, ["id", "version"]);
    return { id: StudioInput.id(input.id), version: StudioInput.json(input.version) };
  },

  /**
   * Validates a single draft or generation identifier.
   *
   * @param argument Untrusted renderer input.
   * @param name Fixed identifier field expected by the action.
   * @returns Bounded identifier under its fixed field name.
   */
  oneId(argument: unknown, name: "id" | "generation"): Record<string, unknown> {
    const input = StudioInput.record(argument, [name]);
    return { [name]: StudioInput.id(input[name]) };
  },
};

/**
 * Validates one renderer action before any trusted service or native dialog receives it.
 * Repository paths and export destinations never pass this boundary.
 *
 * @param command Fixed studio action.
 * @param argument Untrusted structured-clone input.
 * @returns Bounded normalized input for application routing.
 */
export const validateStudioIpc = (
  command: StudioIpcCommand,
  argument: unknown,
): Record<string, unknown> | null => {
  if (command === "stop-quit" || command === "session") {
    if (argument !== null) throw new Error("Unexpected studio action argument.");
    return null;
  }
  switch (command) {
    case "choose-comparison":
      return StudioInput.comparison(argument);
    case "open-draft":
      return StudioInput.draft(argument);
    case "generate":
      return StudioInput.generation(argument);
    case "repeat-generation":
      return StudioInput.oneId(argument, "generation");
    case "history":
      return StudioInput.history(argument);
    case "evidence-patch":
      return StudioInput.evidence(argument);
    case "edit":
      return StudioInput.edit(argument);
    case "approve":
      return StudioInput.approve(argument);
    case "export":
      return StudioInput.export(argument);
    case "phase":
      return StudioInput.oneId(argument, "generation");
    case "read-draft":
    case "preview":
      return StudioInput.oneId(argument, "id");
  }
};
