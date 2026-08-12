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
import { describe, expect, it } from "vitest";

import { LocalBoardGateway } from "../src/board-config.js";

describe("LocalBoardGateway", () => {
  it("accepts the default and an explicit loopback HTTP port", () => {
    expect(LocalBoardGateway.url({})).toBe("http://127.0.0.1:8090");
    expect(LocalBoardGateway.url({ VITE_MESSAGE_BOARD_GATEWAY_URL: "http://127.0.0.1:3210" })).toBe(
      "http://127.0.0.1:3210",
    );
  });

  it.each(["not-a-url", "https://127.0.0.1:8090", "http://localhost:8090", "http://127.0.0.1:0"])(
    "rejects %s",
    (value) => {
      expect(() => LocalBoardGateway.url({ VITE_MESSAGE_BOARD_GATEWAY_URL: value })).toThrow();
    },
  );
});
