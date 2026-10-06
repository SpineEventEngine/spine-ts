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

import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { Time } from "@spine-event-engine/core/time";
import { expect, it } from "vitest";

import { SystemClock } from "../src/system-clock.js";

it("uses the shared precise Time provider for Message Board gateway context", () => {
  const timestamp = create(TimestampSchema, { seconds: 1_789_000_000n, nanos: 123_456_000 });
  const previous = Time.setProvider({ currentTime: () => timestamp });
  try {
    expect(new SystemClock().now()).toEqual(timestamp);
  } finally {
    Time.setProvider(previous);
  }
});
