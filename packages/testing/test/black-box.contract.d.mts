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

import type { Command, Event } from "@spine-event-engine/proto";
import type { BlackBox } from "@spine-event-engine/testing";

type Assert<Condition extends true> = Condition;
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type PublicBlackBoxMember = keyof BlackBox;
type ExpectedPublicBlackBoxMember =
  "asGuest" | "onBehalfOf" | "assertCommands" | "assertEvents" | "eventually" | "close";

type BlackBoxHasNoInternalMembers = Assert<
  Exclude<PublicBlackBoxMember, ExpectedPublicBlackBoxMember> extends never ? true : false
>;
type BlackBoxHasAllFacadeMembers = Assert<
  Exclude<ExpectedPublicBlackBoxMember, PublicBlackBoxMember> extends never ? true : false
>;
type BlackBoxCommandsAreReadonlySnapshots = Assert<
  Equal<ReturnType<BlackBox["assertCommands"]>, readonly Command[]>
>;
type BlackBoxEventsAreReadonlySnapshots = Assert<
  Equal<ReturnType<BlackBox["assertEvents"]>, readonly Event[]>
>;
