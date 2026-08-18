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

import type { ILogLayer } from "loglayer";

const allowedFields = new Set([
  "tenantId",
  "actorId",
  "entityType",
  "entityId",
  "commandType",
  "commandId",
  "eventType",
  "eventId",
  "shardId",
  "workerId",
  "nodeId",
  "subscriptionId",
  "contextName",
  "operation",
  "reasonCode",
  "slot",
  "incarnation",
  "attempt",
  "delay",
  "count",
]);
const code = /^[a-z0-9][a-z0-9_.-]{0,63}$/;

/**
 * Records one internal warning without allowing logging failures into runtime work.
 *
 * @param logger Receives the contained record.
 * @param message Supplies the stable warning message.
 * @param facts Supplies allowlisted structured facts.
 */
export function emitServerWarning(
  logger: ILogLayer,
  message: string,
  facts: Readonly<Record<string, unknown>>,
): void {
  emitServerLog(logger, "warn", message, facts);
}

/**
 * Records one internal error without allowing logging failures into runtime work.
 *
 * @param logger Receives the contained record.
 * @param message Supplies the stable error message.
 * @param facts Supplies allowlisted structured facts.
 */
export function emitServerError(
  logger: ILogLayer,
  message: string,
  facts: Readonly<Record<string, unknown>>,
): void {
  emitServerLog(logger, "error", message, facts);
}

function emitServerLog(
  logger: ILogLayer,
  level: "warn" | "error",
  message: string,
  facts: Readonly<Record<string, unknown>>,
): void {
  try {
    const builder = logger.withMetadata(cleanFacts(facts));
    const emit: (message: string) => unknown =
      level === "warn" ? builder.warn.bind(builder) : builder.error.bind(builder);
    const emitted = emit(message);
    if (isPromiseLike(emitted)) {
      // spine-log-boundary: server.log_async_failure
      void Promise.resolve(emitted).catch(() => undefined);
    }
    // spine-log-boundary: server.log_sync_failure
  } catch {
    // Logging must not affect the containing runtime outcome.
  }
}

function cleanFacts(facts: Readonly<Record<string, unknown>>): Record<string, string | number> {
  const cleaned: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(facts)) {
    if (!allowedFields.has(key)) continue;
    if (key === "count") {
      if (Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 2_147_483_647)
        cleaned[key] = value as number;
      continue;
    }
    if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 256) continue;
    if ((key === "operation" || key === "reasonCode") && !code.test(value)) continue;
    cleaned[key] = value;
  }
  return cleaned;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  );
}
