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

import { createHmac, createPrivateKey, timingSafeEqual } from "node:crypto";
import { SignedSessions } from "@spine-event-engine/auth";
import type { ReaderProofIssuer } from "@spine-event-engine/core/spi/reader-forwarding";
import type { SpineServicesOptions } from "@spine-event-engine/server";

/**
 * The native and browser ports built from protected deployment keys.
 */
export interface SignedBoardAdmission {
  /**
   * Verifies and issues protected bearer credentials.
   */
  readonly sessions: SignedSessions;

  /**
   * Issues operation-bound native reader proof.
   */
  readonly forwardingProof: ReaderProofIssuer;

  /**
   * Verifies direct and forwarded native readers.
   */
  readonly readerAdmission: Required<NonNullable<SpineServicesOptions["readerAdmission"]>>;
}

/**
 * Reads one mandatory signed-admission setting and rejects an empty value.
 */
const required = (environment: NodeJS.ProcessEnv, name: string): string => {
  const value = environment[name];
  if (value === undefined || value.length === 0)
    throw new Error(`Missing required configuration: ${name}.`);
  return value;
};

/**
 * Configures real signed sessions and operation-bound reader assertions.
 */
export const BoardAdmission: Readonly<{
  /**
   * Creates signed session and native reader admission from protected settings.
   */
  signed(environment: NodeJS.ProcessEnv): SignedBoardAdmission;

  /**
   * Selects public admission or the configured signed session mode.
   */
  configured(environment: NodeJS.ProcessEnv): SignedBoardAdmission | undefined;

  /**
   * Verifies direct credentials and operation-bound Gateway proof at the native port.
   */
  readerAdmission(
    sessions: SignedSessions,
    digest: (bytes: Uint8Array) => Buffer,
  ): SignedBoardAdmission["readerAdmission"];
}> = Object.freeze({
  /**
   * Selects explicit public or signed admission without guessing identity from requests.
   */
  configured(environment: NodeJS.ProcessEnv): SignedBoardAdmission | undefined {
    const mode = environment.MESSAGE_BOARD_AUTH_MODE ?? "public";
    if (mode === "public") return undefined;
    if (mode !== "signed") throw new Error("MESSAGE_BOARD_AUTH_MODE must be public or signed.");
    return BoardAdmission.signed(environment);
  },

  /**
   * Builds the two authenticated admission ports from protected server configuration.
   */
  signed(environment: NodeJS.ProcessEnv): SignedBoardAdmission {
    const sessions = new SignedSessions({
      issuer: required(environment, "MESSAGE_BOARD_SESSION_ISSUER"),
      audience: required(environment, "MESSAGE_BOARD_SESSION_AUDIENCE"),
      activeKey: {
        kid: required(environment, "MESSAGE_BOARD_SESSION_KEY_ID"),
        privateKey: createPrivateKey(
          required(environment, "MESSAGE_BOARD_SESSION_PRIVATE_KEY_PEM"),
        ),
      },
    });
    const secret = Buffer.from(
      required(environment, "MESSAGE_BOARD_READER_PROOF_KEY_BASE64"),
      "base64",
    );
    if (secret.length < 32)
      throw new Error("MESSAGE_BOARD_READER_PROOF_KEY_BASE64 must decode to at least 32 bytes.");

    /**
     * Authenticates a native request payload with the configured proof key.
     */
    const digest = (bytes: Uint8Array) => createHmac("sha256", secret).update(bytes).digest();
    return {
      sessions,
      forwardingProof: { issue: (bytes) => digest(bytes).toString("base64url") },
      readerAdmission: BoardAdmission.readerAdmission(sessions, digest),
    };
  },

  /**
   * Verifies Gateway proof and direct bearer sessions at the native read boundary.
   */
  readerAdmission(sessions, digest) {
    return {
      forwarded: {
        verify: (bytes, proof) => {
          if (!/^[A-Za-z0-9_-]{43}$/u.test(proof)) return false;
          const supplied = Buffer.from(proof, "base64url");
          const expected = digest(bytes);
          return supplied.length === expected.length && timingSafeEqual(supplied, expected);
        },
      },
      direct: {
        authenticate: async ({ headers }) => {
          const authorization =
            "get" in headers && typeof headers.get === "function"
              ? headers.get("authorization")
              : (headers as Readonly<Record<string, string>>).authorization;
          if (!authorization?.startsWith("Bearer ")) return undefined;
          const session = await sessions.resolve({ kind: "bearer", value: authorization.slice(7) });
          if (session === undefined) return undefined;
          return {
            principal: session.principal,
            authorityFacts: {
              canReadRestricted: session.principal.attributes?.canReadRestricted === "true",
            },
          };
        },
      },
    };
  },
});
