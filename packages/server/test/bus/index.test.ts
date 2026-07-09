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
