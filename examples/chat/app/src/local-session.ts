import { create } from "@bufbuild/protobuf";
import { TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt";
import type { Clock, SessionResolver } from "@spine-event-engine/auth";

const localBearer = "chat-local-fixture";

/**
 * Local-only Chat session policy used by the example browser server.
 */
export const LocalChatSession: Readonly<{
  readonly clock: Clock;
  timestamp(offsetSeconds: number): Timestamp;
  resolver(): SessionResolver;
}> = Object.freeze({
  clock: { now: () => LocalChatSession.timestamp(0) },

  timestamp(offsetSeconds: number): Timestamp {
    return create(TimestampSchema, {
      seconds: BigInt(Math.floor(Date.now() / 1_000) + offsetSeconds),
    });
  },

  resolver(): SessionResolver {
    return {
      resolve: (credential) =>
        Promise.resolve(
          credential.kind === "bearer" && credential.value === localBearer
            ? {
                principal: { id: "ada", attributes: { rooms: "general" } },
                expiresAt: LocalChatSession.timestamp(60),
              }
            : undefined,
        ),
    };
  },
});
