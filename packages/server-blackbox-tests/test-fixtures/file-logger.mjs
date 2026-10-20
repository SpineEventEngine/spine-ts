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

import { appendFileSync } from "node:fs";
import { LogLayer, StructuredTransport } from "loglayer";

/**
 * Records framework diagnostics durably for one isolated matrix process.
 */
export function fileLogger(path) {
  const record = (line) => {
    appendFileSync(path, `${line}\n`, { flush: true });
  };
  return new LogLayer({
    transport: new StructuredTransport({
      logger: { trace: record, debug: record, info: record, warn: record, error: record },
      level: "warn",
      stringify: true,
      messageField: "message",
      dateField: "timestamp",
      levelField: "severity",
      levelFn: (level) => level.toUpperCase(),
    }),
  });
}
