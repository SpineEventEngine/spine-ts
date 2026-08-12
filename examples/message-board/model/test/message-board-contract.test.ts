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
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("MessageBoard PostMessage contract", () => {
  it("declares server-authored required messages for username and text", async () => {
    const source = await readFile(
      new URL("../proto/spine/examples/messageboard/commands.proto", import.meta.url),
      "utf8",
    );

    expect(source).toContain("package spine.examples.messageboard;");
    expect(source).toContain(
      'string username = 4 [(required) = true, (if_missing).error_msg = "Enter a username."];',
    );
    expect(source).toContain(
      'string text = 5 [(required) = true, (if_missing).error_msg = "Enter a message."];',
    );
  });

  it("relies on implicit required declaration-first Command and Entity IDs", async () => {
    const commands = await readFile(
      new URL("../proto/spine/examples/messageboard/commands.proto", import.meta.url),
      "utf8",
    );
    const entities = await readFile(
      new URL("../proto/spine/examples/messageboard/message_board.proto", import.meta.url),
      "utf8",
    );

    expect(commands).toContain("MessageId id = 1 [(validate) = true];");
    expect(commands).not.toMatch(/MessageId id = 1 \[[^\]]*\(required\)/u);
    expect(
      entities.match(/MessageId id = 1 \[\(validate\) = true, \(set_once\) = true\];/gu),
    ).toHaveLength(2);
    expect(entities).toContain("BoardId id = 1 [(validate) = true, (set_once) = true];");
  });
});
