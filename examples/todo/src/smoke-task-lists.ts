import { unpackAny } from "@spine-ts/core";
import type { QueryResponse } from "@spine-ts/proto/generated/spine/client/query_pb.js";

import { TaskListSchema, type TaskList } from "../generated/spine/example/todo/v1/task_list_pb.js";

const maxDiagnosticRows = 4;
const maxDiagnosticLength = 64;

export interface InspectedTaskListRows {
  readonly diagnostics: readonly string[];
  readonly taskLists: readonly TaskList[];
}

export function inspectTaskListRows(response: QueryResponse): InspectedTaskListRows {
  const taskLists: TaskList[] = [];
  let unavailableRows = 0;

  for (const row of response.message) {
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
  const omittedRows = Math.max(0, taskLists.length - maxDiagnosticRows);
  if (unavailableRows > 0) {
    diagnostics.push(`<${String(unavailableRows)} unavailable rows>`);
  }
  if (omittedRows > 0) {
    diagnostics.push(`<${String(omittedRows)} rows omitted>`);
  }

  return { diagnostics, taskLists };
}

export function sanitizeSmokeValue(value: unknown): string {
  let cleaned = "";
  for (const character of String(value)) {
    const code = character.charCodeAt(0);
    cleaned += code <= 31 || code === 127 ? " " : character;
  }
  cleaned = cleaned.trim();
  return cleaned === "" ? "<blank>" : cleaned.slice(0, maxDiagnosticLength);
}
