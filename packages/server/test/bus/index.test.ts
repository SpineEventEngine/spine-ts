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
import { describe, expect, expectTypeOf, it } from "vitest";

import * as serverRoot from "../../src/index.js";
import {
  CommandBus,
  EventBus,
  type CommandDispatcher,
  type EventDispatcher,
} from "../../src/index.js";

describe("server bus exports", () => {
  it("exports the public bus surface", () => {
    expect(serverRoot.CommandBus).toBe(CommandBus);
    expect(serverRoot.EventBus).toBe(EventBus);
    expect("dispatch" in new CommandBus()).toBe(false);
    expect("dispatch" in new EventBus({} as never)).toBe(false);
    expect("eventTypes" in new EventBus({} as never)).toBe(false);
    expect("eventSchemas" in new EventBus({} as never)).toBe(false);
    expectTypeOf<CommandBus>().not.toHaveProperty("dispatch");
    expectTypeOf<EventBus>().not.toHaveProperty("dispatch");
    expectTypeOf<EventBus>().not.toHaveProperty("eventTypes");
    expectTypeOf<EventBus>().not.toHaveProperty("eventSchemas");
    expectTypeOf<CommandDispatcher>().toExtend<{
      messageSchemas(): readonly object[];
      dispatch(command: object): Promise<void>;
    }>();
    expectTypeOf<EventDispatcher>().toExtend<{
      messageSchemas(): readonly object[];
      accept?(event: object): Promise<void>;
      dispatch(event: object): Promise<void>;
    }>();
  });
});
