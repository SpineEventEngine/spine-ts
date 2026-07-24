export function registerBlackBoxContract(
  test: (name: string, body: () => Promise<void>) => void,
  testing: {
    readonly BlackBox: {
      from(
        context: Parameters<typeof import("@spine-event-engine/testing").BlackBox.from>[0],
        options?: Parameters<typeof import("@spine-event-engine/testing").BlackBox.from>[1],
      ): Promise<unknown>;
    };
    readonly BlackBoxClosedError: new () => Error;
    readonly BlackBoxTimeoutError: new (timeoutMs: number) => Error;
  },
): void;

import type { BlackBox } from "@spine-event-engine/testing";

type Assert<Condition extends true> = Condition;
type PublicBlackBoxMember = keyof BlackBox;
type ExpectedPublicBlackBoxMember = "asGuest" | "onBehalfOf" | "eventually" | "close";

type BlackBoxHasNoInternalMembers = Assert<
  Exclude<PublicBlackBoxMember, ExpectedPublicBlackBoxMember> extends never ? true : false
>;
type BlackBoxHasAllFacadeMembers = Assert<
  Exclude<ExpectedPublicBlackBoxMember, PublicBlackBoxMember> extends never ? true : false
>;
