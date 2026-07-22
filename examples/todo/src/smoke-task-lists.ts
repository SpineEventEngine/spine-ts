import { unpackAny } from "@spine-ts/core";
import type { QueryResponse } from "@spine-ts/proto/client";

import { TaskListSchema, type TaskList } from "../generated/spine/example/todo/v1/task_list_pb.js";

const maxInspectedRows = 16;
const maxDiagnosticRows = 4;
const maxDiagnosticInputLength = 256;
const maxDiagnosticLength = 64;

export interface InspectedTaskListRows {
  readonly diagnostics: readonly string[];
  readonly taskLists: readonly TaskList[];
}

export function inspectTaskListRows(response: QueryResponse): InspectedTaskListRows {
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
      const taskList = unpackAny(row.state, TaskListSchema);
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
    .map((taskList) => sanitizeSmokeValue(taskList.id));
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

export function sanitizeSmokeValue(value: unknown): string {
  let cleaned = "";
  const boundedValue = String(value).slice(0, maxDiagnosticInputLength);
  for (const character of boundedValue) {
    const code = character.charCodeAt(0);
    cleaned += code <= 31 || code === 127 ? " " : character;
  }
  cleaned = cleaned.trim();
  return cleaned === "" ? "<blank>" : cleaned.slice(0, maxDiagnosticLength);
}
