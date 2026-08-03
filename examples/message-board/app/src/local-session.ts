import { create } from "@bufbuild/protobuf";
import { TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt";
import type { Clock, SessionResolver } from "@spine-event-engine/auth";

const localBearer = "message-board-local-fixture";
const localSessionLifetimeSeconds = 8 * 60 * 60;

/**
 * Local-only MessageBoard session policy used by the example browser server.
 */
export const LocalBoardSession: Readonly<{
  readonly clock: Clock;
  timestamp(offsetSeconds: number): Timestamp;
  resolver(): SessionResolver;
}> = Object.freeze({
  clock: { now: () => LocalBoardSession.timestamp(0) },

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
                principal: { id: "ada", attributes: { boards: "general" } },
                expiresAt: LocalBoardSession.timestamp(localSessionLifetimeSeconds),
              }
            : undefined,
        ),
    };
  },
});
