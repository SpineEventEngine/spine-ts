import { describe, expect, expectTypeOf, it } from "vitest";

import * as clientRoot from "../src/index.js";
import type {
  ClientKernel,
  ClientOperationOptions,
  ClientOptions,
  ClientOutcome,
  ClientRequest,
  ClientTransport,
  Subscription,
} from "../src/index.js";

type ClientRoot = typeof import("../src/index.js");

describe("@spine-event-engine/client-node", () => {
  it("uses the browser-safe public client contract with Node transport factories", () => {
    expect(clientRoot.Client).toBeTypeOf("object");
    expect(() => Reflect.construct(clientRoot.Client as never, [])).toThrow();
    expect(clientRoot.ClientProtocolError).toBeTypeOf("function");
    expect(clientRoot.EntityColumn).toBeTypeOf("function");
    expectTypeOf<"query" extends keyof ClientRoot ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<
      "subscribeToState" extends keyof ClientRoot ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      "subscribeToEvents" extends keyof ClientRoot ? true : false
    >().toEqualTypeOf<false>();
  });

  it("re-exports the client-web declaration contract from the Node package", () => {
    expectTypeOf<ClientKernel>().toMatchTypeOf<{
      asGuest(): ClientRequest;
      close(): Promise<void>;
    }>();
    expectTypeOf<ClientOperationOptions>().toMatchTypeOf<{ readonly signal?: AbortSignal }>();
    expectTypeOf<ClientOptions>().toMatchTypeOf<{ readonly tenant?: string }>();
    expectTypeOf<ClientOutcome>().toMatchTypeOf<{ readonly kind: string }>();
    expectTypeOf<ClientTransport>().toMatchTypeOf<{ createRequestId(): string }>();
    expectTypeOf<Subscription>().toMatchTypeOf<{
      activate(): Promise<void>;
      cancel(): Promise<void>;
    }>();
  });
});
