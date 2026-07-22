import { describe, expect, expectTypeOf, it } from "vitest";
import type { Message, MessageShape } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";

import * as clientRoot from "../src/index.js";
import type {
  ClientObserveOptions,
  ClientOutcome,
  ClientPostOptions,
  ClientRequest,
  ObservedClientOutcome,
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
});
