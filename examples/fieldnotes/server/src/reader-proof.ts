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

import { timingSafeEqual } from "node:crypto";
import { CompactSign, compactVerify } from "jose";
import type {
  ReaderProofIssuer,
  ReaderProofVerifier,
} from "@spine-event-engine/core/spi/reader-forwarding";

/**
 * Signs the framework's canonical reader bytes for one loopback forwarding peer.
 */
export class FieldnotesReaderProof implements ReaderProofIssuer, ReaderProofVerifier<unknown> {
  readonly #secret: Uint8Array;

  #closed = false;

  /**
   * Copies a dedicated stable host secret for HS256 proof.
   *
   * @param secret Deployment key with at least 256 bits of entropy.
   */
  constructor(secret: Uint8Array) {
    if (secret.byteLength < 32) throw new Error("Reader proof secret must be at least 32 bytes.");
    this.#secret = new Uint8Array(secret);
  }

  /**
   * Creates a signature over exactly the operation-bound bytes supplied by Spine.
   *
   * @param bytes Canonical service, method, reader, and request bytes.
   * @returns Compact JWS proof for the private native listener.
   */
  issue(bytes: Uint8Array): Promise<string> {
    if (this.#closed) return Promise.reject(new Error("Reader proof is closed."));
    return new CompactSign(bytes).setProtectedHeader({ alg: "HS256" }).sign(this.#secret);
  }

  /**
   * Verifies the pinned algorithm and exact canonical payload.
   *
   * @param bytes Expected operation-bound bytes.
   * @param proof Gateway assertion carried on the native request.
   * @returns Whether the trusted signing peer asserted these exact bytes.
   */
  async verify(bytes: Uint8Array, proof: string): Promise<boolean> {
    if (this.#closed) return false;
    try {
      const verified = await compactVerify(proof, this.#secret, { algorithms: ["HS256"] });
      return verified.payload.length === bytes.length && timingSafeEqual(verified.payload, bytes);
    } catch {
      return false;
    }
  }

  /**
   * Clears this adapter's copied signing material after host shutdown.
   *
   * @returns Completion after the key copy is cleared.
   */
  close(): Promise<void> {
    this.#closed = true;
    this.#secret.fill(0);
    return Promise.resolve();
  }
}
