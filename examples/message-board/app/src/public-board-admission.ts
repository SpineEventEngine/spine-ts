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

/**
 * Admits requests to the intentionally public demonstration board without a
 * browser credential. The Gateway still reconstructs actor context from each
 * decoded request; this admission principal is never presented to the browser.
 */

import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import type { Clock, SessionResolver } from "@spine-event-engine/auth";

const publicDemoPrincipal = Object.freeze({ id: "message-board-public-demo" });

/**
 * Supplies credential-agnostic Gateway admission for the public Message Board demo.
 */
export const PublicBoardAdmission: Readonly<{
  readonly clock: Clock;
  resolver(): SessionResolver;
  timestamp(offsetSeconds: number): ReturnType<Clock["now"]>;
}> = Object.freeze({
  clock: { now: () => PublicBoardAdmission.timestamp(0) },

  resolver(): SessionResolver {
    return {
      resolve: () =>
        Promise.resolve({
          principal: publicDemoPrincipal,
          expiresAt: PublicBoardAdmission.timestamp(5 * 60),
        }),
    };
  },

  timestamp(offsetSeconds: number) {
    return create(TimestampSchema, {
      seconds: BigInt(Math.floor(Date.now() / 1_000) + offsetSeconds),
    });
  },
});
