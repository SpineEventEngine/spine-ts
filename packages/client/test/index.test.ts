import { describe, expect, expectTypeOf, it } from "vitest";
import type { Message, MessageShape } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";

import * as clientRoot from "../src/index.js";
import { ProjectionStateSchema } from "../test-fixtures/projection-column-fixtures.js";
import type {
  ClientObserveOptions,
  ClientOutcome,
  ClientPostOptions,
  ClientRequest,
  CommandEvent,
  ObservedClientOutcome,
  QueryState,
} from "../src/index.js";

type ClientRoot = typeof import("../src/index.js");

describe("@spine-ts/client", () => {
  it("exports the public client facade alongside Projection query construction", () => {
    expect(clientRoot.Client).toBeTypeOf("function");
    expect(clientRoot.ClientProtocolError).toBeTypeOf("function");
    expect(clientRoot.ProjectionColumn).toBeTypeOf("function");
    expect("AggregateColumn" in clientRoot).toBe(false);
    expect("ProcessManagerColumn" in clientRoot).toBe(false);
    expectTypeOf<
      "AggregateColumn" extends keyof ClientRoot ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      "ProcessManagerColumn" extends keyof ClientRoot ? true : false
    >().toEqualTypeOf<false>();
  });

  it("accepts both broad and observed post option variables", () => {
    function compile<Schema extends GenMessage<Message>>(
      request: ClientRequest,
      schema: Schema,
      message: MessageShape<Schema>,
      options: ClientPostOptions,
      observed: ClientObserveOptions,
    ) {
      expectTypeOf(request.post(schema, message, options)).toEqualTypeOf<
        Promise<ClientOutcome | ObservedClientOutcome>
      >();
      expectTypeOf(request.post(schema, message, observed)).toEqualTypeOf<
        Promise<ObservedClientOutcome>
      >();
    }

    expectTypeOf(compile).toBeFunction();
  });

  it("rejects mutation of published decoded observations", () => {
    const queryState = null as unknown as QueryState<typeof ProjectionStateSchema>;
    const commandEvent = null as unknown as CommandEvent;
    function compileOnly() {
      // @ts-expect-error Public query states are deeply readonly.
      queryState.state.title = "mutated";
      // @ts-expect-error Byte observations are readonly too.
      queryState.state.fingerprint[0] = 1;
      // @ts-expect-error Query versions are readonly.
      queryState.version.number = 2;
      // @ts-expect-error Command messages are readonly.
      commandEvent.message.$typeName = "mutated";
      // @ts-expect-error Command contexts are readonly.
      commandEvent.context.$typeName = "mutated";
    }
    expectTypeOf(compileOnly).toBeFunction();
    expectTypeOf(queryState).toBeObject();
  });
});
