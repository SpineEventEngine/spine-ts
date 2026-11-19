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

/**
 * Named fields read from an Agent history entry's Protobuf JSON value.
 */
type Fields = Record<string, unknown>;

/**
 * Returns object fields only when the recorded value is an object.
 */
const fields = (value: unknown): Fields | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Fields)
    : undefined;

/**
 * Separates a Protobuf JSON field name for a readable request preview.
 */
const label = (value: string): string =>
  value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");

/**
 * Parses nested request JSON for the preview without changing the original record.
 */
const readable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(readable);
  const object = fields(value);
  if (!object) return value;
  return Object.fromEntries(
    Object.entries(object).map(([key, part]) => {
      if (typeof part === "string" && /^(promptJson|outputSchemaJson|argumentsJson)$/.test(key)) {
        try {
          return [label(key), readable(JSON.parse(part))];
        } catch {
          return [label(key), part];
        }
      }
      return [label(key), readable(part)];
    }),
  );
};

/**
 * Collects assistant message parts while leaving provider reasoning in recorded fields.
 */
const visibleText = (content: Fields | undefined): string[] => {
  if (!content) return [];
  if (typeof content.rawOutput === "string" && content.rawOutput) return [content.rawOutput];
  const anthropic = fields(content.anthropicContent);
  const anthropicText = Array.isArray(anthropic?.blocks)
    ? anthropic.blocks.flatMap((block: unknown) => {
        const text = fields(block)?.text;
        return typeof text === "string" ? [text] : [];
      })
    : [];
  const openai = fields(content.openaiContent);
  const openaiText = Array.isArray(openai?.items)
    ? openai.items.flatMap((item: unknown) => {
        const message = fields(fields(item)?.message);
        return Array.isArray(message?.parts)
          ? message.parts.flatMap((piece: unknown) => {
              const part = fields(piece);
              return [part?.outputText, part?.refusal].filter(
                (text): text is string => typeof text === "string",
              );
            })
          : [];
      })
    : [];
  return [...anthropicText, ...openaiText];
};

/**
 * Returns the original record identity used by indexed history paging.
 *
 * @param entry Recorded audit entry.
 * @returns Identity from the recorded event or conversation record.
 */
export const historyKey = (entry: unknown): string => {
  const item = fields(entry);
  const request = fields(item?.modelRequest);
  const preparedId = fields(fields(request?.request)?.id)?.uuid;
  if (typeof preparedId === "string") return `request:${preparedId}`;
  for (const category of ["submissionAttempt", "handledOutcome", "abandonment"]) {
    const id = fields(item?.[category])?.id;
    if (typeof id === "string") return `${category}:${id}`;
  }
  const conversation = fields(item?.conversationRecord);
  const event = fields(item?.systemEvent ?? item?.domainEvent);
  const id = fields(conversation?.id ?? event?.id);
  return typeof id?.value === "string" ? id.value : JSON.stringify(entry);
};

/**
 * Merges indexed pages in repository order while removing repeated records.
 *
 * @param current Records already displayed.
 * @param incoming Newly read records.
 * @returns Combined records without duplicate identities.
 */
export const historyMerge = (
  current: readonly unknown[],
  incoming: readonly unknown[],
): unknown[] => {
  const seen = new Set<string>();
  return [...incoming, ...current].filter((entry) => {
    const key = historyKey(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * Uses calendar month ends when computing a release's elapsed months.
 */
const elapsedMonths = (from: Date, to: Date): number => {
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth();
  const year = from.getUTCFullYear() + Math.floor((from.getUTCMonth() + months) / 12);
  const month = (from.getUTCMonth() + months) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const anniversary = new Date(
    Date.UTC(
      year,
      month,
      Math.min(from.getUTCDate(), lastDay),
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds(),
    ),
  );
  if (anniversary > to) months--;
  return months;
};

/**
 * Formats elapsed time from a release's creation using calendar months and years.
 *
 * @param created Original creation time in UTC.
 * @param now Current time for the live label.
 * @returns Short elapsed label.
 */
export const historyAge = (created: string | undefined, now: Date): string => {
  if (!created) return "this session";
  const from = new Date(created);
  if (Number.isNaN(from.getTime())) return "this session";
  const minutes = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${String(minutes)}m ago`;
  if (minutes < 1440) return `${String(Math.floor(minutes / 60))}h ago`;
  const months = elapsedMonths(from, now);
  if (months < 1) return `${String(Math.floor(minutes / 1440))}d ago`;
  if (months < 12) return `${String(months)}mo ago`;
  const rest = months % 12;
  return `${String(Math.floor(months / 12))}y${rest ? ` ${String(rest)}mo` : ""} ago`;
};

const titles: Readonly<Record<string, string>> = {
  GenerationRequest: "Request",
  GenerationResponse: "Response",
  ToolRequest: "Call",
  ToolResponse: "Result",
  OpenAiAssistantContent: "Assistant",
  AnthropicAssistantContent: "Assistant",
  AgentAiOperationStarted: "Writing started",
  AgentAiOperationCompleted: "Writing completed",
  AgentAiOperationFailed: "Writing failed",
  ReleaseGenerationRequested: "Writing requested",
  ReleaseNotesProposed: "Draft proposed",
};

/**
 * Selects the timeline category from the recorded type, without guessing content.
 */
const recordKind = (
  record: Fields | undefined,
  entry: Fields | undefined,
  name: string,
): string => {
  if (!record) return entry?.systemEvent ? "System" : "Domain";
  if (
    /^(GenerationResponse|OpenAiAssistantContent|AnthropicAssistantContent|DecisionResponse)$/.test(
      name,
    )
  )
    return "Model";
  return name === "ToolResponse" || name === "ToolRequest" ? "Tool" : "App";
};

/**
 * Builds readable request text while leaving raw detail unchanged.
 */
const requestText = (content: Fields | undefined): string => {
  const input = fields(content?.input);
  return [
    typeof content?.instructions === "string" ? content.instructions : "",
    input ? `Input\n${JSON.stringify(readable(input), null, 2)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
};

/**
 * Chooses the primary visible text for a conversation record.
 */
const recordText = (content: Fields | undefined, name: string): string => {
  if (name === "GenerationRequest") return requestText(content);
  const tool = fields(content?.tool);
  if (name === "ToolRequest")
    return [
      `Run ${typeof tool?.value === "string" ? tool.value : "tool"}`,
      typeof content?.argumentsJson === "string" ? content.argumentsJson : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  if (name === "ToolResponse") {
    const text = Array.isArray(content?.text)
      ? content.text.filter((part): part is string => typeof part === "string")
      : [];
    const structured = content?.structuredJson;
    if (typeof structured !== "string" || !structured) return text.join("\n\n");
    try {
      return [...text, `Result\n${JSON.stringify(JSON.parse(structured), null, 2)}`].join("\n\n");
    } catch {
      return [...text, `Result\n${structured}`].join("\n\n");
    }
  }
  return visibleText(content).join("\n\n");
};

/**
 * Reads a typed value from the JSON form of a model call.
 *
 * @param value Field containing a value wrapper.
 * @returns Human-readable value when present.
 */
const wrappedValue = (value: unknown): string | undefined => {
  const result = fields(value)?.value;
  return typeof result === "string" ? result : undefined;
};

/**
 * Names a model history entry from its recorded category and outcome.
 *
 * @param request Prepared request fields, when present.
 * @param attempt Submission attempt fields, when present.
 * @param handled Handled outcome fields, when present.
 * @param outcomeType Saved outcome type URL, when present.
 * @returns Timeline title for the model action.
 */
const modelHistoryTitle = (
  request: Fields | undefined,
  attempt: Fields | undefined,
  handled: Fields | undefined,
  outcomeType: unknown,
): string => {
  if (request) return "Model request prepared";
  if (attempt) return "Model submission attempted";
  if (!handled) return "Model call abandoned";
  return typeof outcomeType === "string" && outcomeType.endsWith(".ModelCallFailed")
    ? "Model failure handled"
    : "Model reply handled";
};

/**
 * Summarizes one model call for its history row.
 *
 * @param call Saved CallModel metadata, when present.
 * @param handled Saved handled outcome, when present.
 * @param abandonment Saved abandonment, when present.
 * @returns Human-readable call, capability, and conversation.
 */
const modelHistorySummary = (
  call: Fields | undefined,
  handled: Fields | undefined,
  abandonment: Fields | undefined,
): string => {
  const callId = wrappedValue(call?.id) ?? wrappedValue(handled?.call ?? abandonment?.call);
  const conversation = wrappedValue(
    call?.conversation ?? handled?.conversation ?? abandonment?.conversation,
  );
  const capability = wrappedValue(call?.capability);
  const revision = wrappedValue(call?.capabilityRevision);
  return [
    callId ? `Call ${callId}` : "Model call",
    capability ? `for ${capability}${revision ? `@${revision}` : ""}` : "",
    conversation ? `in conversation ${conversation}` : "",
  ]
    .filter(Boolean)
    .join(" ");
};

/**
 * Formats the complete source, request, and outcome shown in history detail.
 *
 * @param summary Short model action summary.
 * @param source Triggering Command or Event, when saved.
 * @param payload Model Command payload, when saved.
 * @param outcome Handled outcome envelope, when saved.
 * @returns Readable complete history detail.
 */
const modelHistoryDetail = (
  summary: string,
  source: Fields | undefined,
  payload: Fields | undefined,
  outcome: Fields | undefined,
): string => {
  const sourceType = fields(source?.message)?.["@type"];
  return [
    summary,
    typeof sourceType === "string"
      ? `Triggered by ${sourceType.split(".").at(-1) ?? sourceType}`
      : "",
    payload ? JSON.stringify(readable(payload), null, 2) : "",
    outcome ? JSON.stringify(readable(fields(outcome.message) ?? outcome), null, 2) : "",
  ]
    .filter(Boolean)
    .join("\n\n");
};

/**
 * Presents framework model history using its saved request and outcome envelopes.
 *
 * @param item Combined history entry fields.
 * @param entry Original JSON record retained for detail.
 * @returns Display record for a model action, when present.
 */
const modelHistoryRecord = (
  item: Fields | undefined,
  entry: unknown,
): HistoryRecord | undefined => {
  const request = fields(item?.modelRequest);
  const attempt = fields(item?.submissionAttempt);
  const handled = fields(item?.handledOutcome);
  const abandonment = fields(item?.abandonment);
  if (!request && !attempt && !handled && !abandonment) return undefined;
  const command = fields(request?.request ?? attempt?.command);
  const payload = fields(command?.message);
  const call = fields(payload?.call);
  const outcome = fields(handled?.outcome);
  const outcomeType = fields(outcome?.message)?.["@type"];
  const title = modelHistoryTitle(request, attempt, handled, outcomeType);
  const summary = modelHistorySummary(call, handled, abandonment);
  const source = fields(
    request?.command ?? request?.event ?? abandonment?.command ?? abandonment?.event,
  );
  const exact = modelHistoryDetail(summary, source, payload, outcome);
  return {
    kind: "App",
    speaker: "App",
    title,
    preview: summary,
    exact,
    detail: JSON.stringify(entry, null, 2),
    occurredAt: typeof item?.whenOccurred === "string" ? item.whenOccurred : undefined,
  };
};

/**
 * Human summary plus unchanged recorded fields for one audit entry.
 */
export interface HistoryRecord {
  /**
   * Timeline category used to distinguish conversation and event entries.
   */
  readonly kind: string;

  /**
   * Name shown for the app, model, or MCP tool that produced the record.
   */
  readonly speaker: string;

  /**
   * Human-readable event or record type.
   */
  readonly title: string;

  /**
   * Short visible content for the timeline.
   */
  readonly preview: string;

  /**
   * Full readable message content.
   */
  readonly exact: string;

  /**
   * Complete original recorded fields as formatted JSON.
   */
  readonly detail: string;

  /**
   * Original audit timestamp when recorded.
   */
  readonly occurredAt?: string | undefined;
}

/**
 * Converts a Protobuf JSON history entry into its visible audit presentation.
 *
 * @param entry Recorded audit entry.
 * @returns Readable timeline content and unchanged recorded fields.
 */
export const historyRecord = (entry: unknown): HistoryRecord => {
  const item = fields(entry);
  const model = modelHistoryRecord(item, entry);
  if (model !== undefined) return model;
  const record = fields(item?.conversationRecord);
  const event = fields(item?.systemEvent ?? item?.domainEvent);
  const content = fields(record?.content);
  const type = content?.["@type"] ?? fields(event?.message)?.["@type"];
  const name = typeof type === "string" ? (type.split(".").at(-1) ?? "") : "";
  const title = titles[name] ?? label(name || (record ? "Exchange" : "Event"));
  const kind = recordKind(record, item, name);
  const exact = recordText(content, name);
  const occurredAt = typeof item?.whenOccurred === "string" ? item.whenOccurred : undefined;
  return {
    kind,
    speaker: kind === "Tool" ? "MCP" : kind === "System" || kind === "Domain" ? "App" : kind,
    title,
    preview: kind === "Tool" ? (exact.split("\n")[0] ?? title) : exact || title,
    exact,
    detail: JSON.stringify(entry, null, 2),
    occurredAt,
  };
};
