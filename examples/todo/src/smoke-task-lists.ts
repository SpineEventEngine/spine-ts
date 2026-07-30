import { AnyMessages } from "@spine-event-engine/core";
import type { QueryResponse } from "@spine-event-engine/proto/client";

import { TaskListSchema, type TaskList } from "../generated/spine/example/todo/v1/task_list_pb.js";

const maxInspectedRows = 16;
const maxDiagnosticRows = 4;
const maxDiagnosticInputLength = 256;
const maxDiagnosticLength = 64;

/** Bounded decoded task-list rows and safe diagnostics from a smoke query response. */
export interface InspectedTaskListRows {
  /** Sanitized task-list IDs and unavailable-row summaries for smoke diagnostics. */
  readonly diagnostics: readonly string[];
  /** Decoded task-list states retained from the bounded query response. */
  readonly taskLists: readonly TaskList[];
}

/** Inspects bounded task-list query rows and formats safe smoke diagnostics. */
export class SmokeTaskLists {
  /**
   * Decodes bounded task-list rows and records unavailable or omitted-row diagnostics.
   *
   * @param response - Query response whose entity states are inspected.
   * @returns Retained task lists with sanitized diagnostics.
   */
  static inspectRows(response: QueryResponse): InspectedTaskListRows {
    const taskLists: TaskList[] = [];
    let unavailableRows = 0;
    const inspectedRows = response.message.slice(0, maxInspectedRows);
    const omittedResponseRows = Math.max(0, response.message.length - inspectedRows.length);

    for (const row of inspectedRows) {
      if (row.state === undefined) {
        unavailableRows += 1;
        continue;
      }
      try {
        const taskList = AnyMessages.unpack(row.state, TaskListSchema);
        if (taskList === undefined) {
          unavailableRows += 1;
          continue;
        }
        taskLists.push(taskList);
      } catch {
        unavailableRows += 1;
      }
    }

    const diagnostics = taskLists
      .slice(0, maxDiagnosticRows)
      .map((taskList) => this.sanitizeValue(taskList.id));
    const omittedDiagnosticRows = Math.max(0, taskLists.length - maxDiagnosticRows);
    if (unavailableRows > 0) {
      diagnostics.push(`<${String(unavailableRows)} unavailable rows>`);
    }
    if (omittedDiagnosticRows > 0) {
      diagnostics.push(`<${String(omittedDiagnosticRows)} diagnostic rows omitted>`);
    }
    if (omittedResponseRows > 0) {
      diagnostics.push(`<${String(omittedResponseRows)} response rows omitted>`);
    }

    return { diagnostics, taskLists };
  }

  /**
   * Creates bounded diagnostic text without control characters.
   *
   * @param value - Value to convert into safe diagnostic text.
   * @returns Bounded diagnostic text, or a blank marker.
   */
  static sanitizeValue(value: unknown): string {
    let cleaned = "";
    const boundedValue = String(value).slice(0, maxDiagnosticInputLength);
    for (const character of boundedValue) {
      const code = character.charCodeAt(0);
      cleaned += code <= 31 || code === 127 ? " " : character;
    }
    cleaned = cleaned.trim();
    return cleaned === "" ? "<blank>" : cleaned.slice(0, maxDiagnosticLength);
  }
}
