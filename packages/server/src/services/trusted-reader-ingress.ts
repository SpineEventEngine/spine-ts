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

import { Code, ConnectError } from "@connectrpc/connect";
import {
  ReaderForwarding,
  type ReaderHeaders,
  type ReaderProofVerifier,
} from "@spine-event-engine/core/spi/reader-forwarding";
import {
  snapshotTrustedReader,
  type TrustedReaderContext,
} from "@spine-event-engine/core/spi/trusted-reader";

/**
 * Verified native reader facts and optional process-local invalidation.
 */
export interface ReaderAdmissionResult {
  // prettier-ignore

  /**
   * Detached identity and authority facts for this invocation.
   */
  readonly reader: TrustedReaderContext;

  /**
   * Ends this invocation when its authentication ceases to be valid.
   */
  readonly invalidated?: AbortSignal;
}

/**
 * Direct native authentication port; an undefined result denies admission.
 *
 * @typeParam Peer Transport-specific peer context authenticated by this port.
 */
export interface DirectReaderAuthenticator<Peer> {
  /**
   * Verifies one direct native request using its transport peer and credentials.
   *
   * @param request Canonical operation, transport peer, and host lifetime.
   * @returns One admission with optional invalidation, or undefined to deny.
   */
  authenticate(request: {
    readonly service: string;
    readonly method: string;
    readonly value: Uint8Array;
    readonly headers: ReaderHeaders;
    readonly peer: Peer;
    readonly signal: AbortSignal;
  }): ReaderAdmissionResult | undefined | Promise<ReaderAdmissionResult | undefined>;
}

/**
 * Inputs for one native reader-admission decision.
 *
 * @typeParam Peer Transport-specific peer context for this request.
 */
export interface TrustedReaderAdmission<Peer> {
  /**
   * Canonical RPC service.
   */
  readonly service: string;

  /**
   * Canonical RPC method.
   */
  readonly method: string;

  /**
   * Serialized Protobuf request.
   */
  readonly request: Uint8Array;

  /**
   * Incoming transport headers.
   */
  readonly headers: ReaderHeaders;

  /**
   * Native peer facts from the transport.
   */
  readonly peer: Peer;

  /**
   * Host-managed lifetime beginning before authentication.
   */
  readonly signal: AbortSignal;

  /**
   * Existing native request size limit.
   */
  readonly maxBytes: number;

  /**
   * Configured trusted forwarding peer verifier.
   */
  readonly forwarded?: ReaderProofVerifier<Peer>;

  /**
   * Trusts structurally valid unsigned reader facts from this restricted listener.
   */
  readonly trustedNetwork?: boolean;

  /**
   * Configured direct native authenticator.
   */
  readonly direct?: DirectReaderAuthenticator<Peer>;
}

/**
 * Resolves one reader from signed forwarding, direct authentication, or
 * explicit trusted-network admission. Internal headers are rejected by default.
 */
export const TrustedReaderIngress: Readonly<{
  /**
   * Resolves a reader only from a verified forwarding assertion or direct port.
   *
   * @param input Canonical operation, peer context, headers, and configured ports.
   * @returns Detached reader facts after admission.
   * @typeParam Peer Receiving transport's peer context.
   */
  admit<Peer>(input: TrustedReaderAdmission<Peer>): Promise<ReaderAdmissionResult>;

  /**
   * Authenticates a direct native request through the configured port.
   *
   * @param input Canonical operation and receiving transport facts.
   * @returns Detached verified reader facts.
   * @typeParam Peer Receiving transport's peer context.
   */
  directReader<Peer>(input: TrustedReaderAdmission<Peer>): Promise<ReaderAdmissionResult>;

  /**
   * Sanitizes port failures while preserving known transport status classes.
   *
   * @param error Failure from a replaceable authentication port.
   * @returns Public Connect status without private failure details.
   */
  portFailure(error: unknown): ConnectError;
}> = Object.freeze({
  /**
   * Verifies the incoming operation before service validation or routing.
   *
   * @param input Canonical operation, incoming transport, and configured ports.
   * @returns Detached trusted reader, including an empty public reader when allowed.
   * @typeParam Peer Receiving transport's peer context.
   */
  async admit<Peer>(input: TrustedReaderAdmission<Peer>): Promise<ReaderAdmissionResult> {
    input.signal.throwIfAborted();
    if (ReaderForwarding.hasAssertion(input.headers)) {
      try {
        const reader =
          input.trustedNetwork === true
            ? ReaderForwarding.decode(input.headers, input.service, input.method, input.maxBytes)
            : await ReaderForwarding.open(
                input.headers,
                input.service,
                input.method,
                input.request,
                input.forwarded,
                input.peer,
                input.maxBytes,
              );
        input.signal.throwIfAborted();
        return Object.freeze({ reader: snapshotTrustedReader(reader) });
      } catch (error) {
        if (input.signal.aborted)
          throw new ConnectError("Reader authentication cancelled.", Code.Canceled);
        if (error instanceof Error && error.message === "Invalid forwarding proof.")
          throw new ConnectError("Reader authentication failed.", Code.Unauthenticated);
        throw TrustedReaderIngress.portFailure(error);
      }
    }
    if (input.direct === undefined) {
      if (input.forwarded !== undefined)
        throw new ConnectError("Reader authentication failed.", Code.Unauthenticated);
      return Object.freeze({ reader: Object.freeze({}) });
    }
    return TrustedReaderIngress.directReader(input);
  },

  /**
   * Verifies a direct native invocation through the configured port.
   *
   * @param input Canonical operation and receiving transport facts.
   * @returns Detached verified reader facts.
   * @typeParam Peer Receiving transport's peer context.
   */
  async directReader<Peer>(input: TrustedReaderAdmission<Peer>): Promise<ReaderAdmissionResult> {
    try {
      const admission = await input.direct?.authenticate({
        service: input.service,
        method: input.method,
        value: input.request,
        headers: input.headers,
        peer: input.peer,
        signal: input.signal,
      });
      input.signal.throwIfAborted();
      if (admission === undefined)
        throw new ConnectError("Reader authentication failed.", Code.Unauthenticated);
      const reader = snapshotTrustedReader(admission.reader);
      const invalidated = admission.invalidated;
      if (invalidated !== undefined && !(invalidated instanceof AbortSignal))
        throw new TypeError("Invalid reader invalidation signal.");
      return Object.freeze({ reader, ...(invalidated === undefined ? {} : { invalidated }) });
    } catch (error) {
      if (input.signal.aborted)
        throw new ConnectError("Reader authentication cancelled.", Code.Canceled);
      throw TrustedReaderIngress.portFailure(error);
    }
  },

  /**
   * Keeps explicit transport cancellation and availability distinct from denial.
   *
   * @param error Private port failure.
   * @returns Sanitized public status with no private detail.
   */
  portFailure(error: unknown): ConnectError {
    if (error instanceof ConnectError) {
      if (error.code === Code.Canceled)
        return new ConnectError("Reader authentication cancelled.", Code.Canceled);
      if (error.code === Code.Unavailable)
        return new ConnectError("Reader authentication unavailable.", Code.Unavailable);
      if (error.code === Code.Unauthenticated || error.code === Code.PermissionDenied)
        return new ConnectError("Reader authentication failed.", error.code);
    }
    return new ConnectError("Reader authentication failed.", Code.Internal);
  },
});
