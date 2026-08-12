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
