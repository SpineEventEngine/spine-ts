/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at https://www.apache.org/licenses/LICENSE-2.0
 */

import { base64Decode, base64Encode, getTextEncoding } from "@bufbuild/protobuf/wire";
import { snapshotTrustedReader, type TrustedReaderContext } from "./trusted-reader.js";

const envelopeHeader = "spine-internal-reader";
const proofHeader = "spine-internal-reader-proof";

/**
 * Incoming headers from a native transport or generated forwarding record.
 */
export type ReaderHeaders =
  | Readonly<Record<string, string>>
  | {
      /**
       * Reads an incoming transport header by its canonical name.
       *
       * @param name Header name.
       * @returns Header value or null when absent.
       */
      get(name: string): string | null;
    };

/**
 * Replaceable gateway proof producer for an authenticated forwarding peer.
 * The application supplies the signing mechanism and protects its key material.
 */
export interface ReaderProofIssuer {
  /**
   * Creates one operation-bound identity assertion.
   *
   * @param bytes Canonical service, method, reader and request bytes.
   * @returns A transport-safe proof.
   */
  issue(bytes: Uint8Array): string | Promise<string>;
}

/**
 * Replaceable app-node proof verifier. Implementations must authenticate the
 * forwarding peer as well as verify its assertion over the supplied bytes.
 *
 * @typeParam Peer Native peer context exposed by the receiving transport.
 */
export interface ReaderProofVerifier<Peer> {
  /**
   * Verifies a forwarding peer and its operation-bound assertion.
   *
   * @param bytes Canonical service, method, reader and request bytes.
   * @param proof Forwarding proof received with the internal envelope.
   * @param peer Receiving transport's peer context.
   * @returns Whether this assertion came from the configured trusted peer.
   */
  verify(bytes: Uint8Array, proof: string, peer: Peer): boolean | Promise<boolean>;
}

/**
 * File-private assertion framing and bounded header decoding.
 */
const ReaderForwardingWire = Object.freeze({
  /**
   * Decodes bounded assertion metadata and rejects malformed JSON shapes.
   *
   * @param encoded Base64 assertion envelope.
   * @param proof Transport-safe proof value.
   * @param maxBytes Existing native request-size bound.
   * @returns Canonical envelope bytes and its parsed record.
   */
  decodeEnvelope(encoded: string, proof: string, maxBytes: number) {
    try {
      const payload = base64Decode(encoded);
      ReaderForwardingWire.assertBound(payload.byteLength, maxBytes);
      ReaderForwardingWire.assertBound(proof.length, maxBytes);
      const decoded: unknown = JSON.parse(getTextEncoding().decodeUtf8(payload, true));
      if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded))
        throw new Error("Invalid forwarding proof.");
      return { payload, decoded };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Forwarded reader envelope exceeds request limit."
      )
        throw error;
      throw new Error("Invalid forwarding proof.");
    }
  },

  /**
   * Builds signed bytes so neither request nor envelope can be exchanged.
   *
   * @param payload Bounded internal reader envelope.
   * @param request Canonical request message bytes.
   * @returns Binary input for the configured proof port.
   */
  proofBytes(payload: Uint8Array, request: Uint8Array): Uint8Array {
    const framed = new Uint8Array(payload.byteLength + 1 + request.byteLength);
    framed.set(payload);
    framed.set(request, payload.byteLength + 1);
    return framed;
  },

  /**
   * Applies the receiving native transport's existing message-size bound.
   *
   * @param size Serialized internal envelope bytes.
   * @param maxBytes Configured native request-size bound.
   */
  assertBound(size: number, maxBytes: number): void {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || size > maxBytes)
      throw new Error("Forwarded reader envelope exceeds request limit.");
  },

  /**
   * Reads one reserved header from a native header collection or plain record.
   *
   * @param headers Received header collection.
   * @param name Lowercase reserved header name.
   * @returns Header value when present.
   */
  headerValue(headers: ReaderHeaders, name: string): string | undefined {
    return "get" in headers && typeof headers.get === "function"
      ? (headers.get(name) ?? undefined)
      : (headers as Readonly<Record<string, string>>)[name];
  },
});

/**
 * Package-internal wire conversion for per-request verified reader assertions.
 * It does not copy the incoming transport credential or track session expiry.
 * Application ports remain responsible for the facts they supply, and no
 * assertion is accepted without a configured peer verifier.
 *
 * @internal
 */
export const ReaderForwarding: Readonly<{
  /**
   * Checks whether reserved forwarding headers are present.
   *
   * @param headers Incoming native request headers.
   * @returns Whether either reserved header is present.
   */
  hasAssertion(headers: ReaderHeaders): boolean;

  /**
   * Encodes detached reader facts for one canonical operation and request.
   *
   * @param service The canonical RPC service name.
   * @param method The canonical RPC method name.
   * @param value Canonical request message bytes.
   * @param reader The verified reader facts for this operation.
   * @param issuer The configured forwarding proof producer.
   * @param maxBytes The existing native message-size bound.
   * @returns Internal metadata for the backend request.
   */
  seal(
    service: string,
    method: string,
    value: Uint8Array,
    reader: TrustedReaderContext,
    issuer: ReaderProofIssuer,
    maxBytes: number,
  ): Promise<Readonly<Record<string, string>>>;

  /**
   * Verifies an operation-bound assertion through the configured peer port.
   *
   * @param headers Incoming native request headers.
   * @param service The canonical RPC service name.
   * @param method The canonical RPC method name.
   * @param value Canonical request message bytes.
   * @param verifier The configured forwarding peer verifier.
   * @param peer The native transport peer context.
   * @param maxBytes The existing native message-size bound.
   * @returns Detached verified reader facts.
   * @typeParam Peer Native transport peer context.
   */
  open<Peer>(
    headers: ReaderHeaders,
    service: string,
    method: string,
    value: Uint8Array,
    verifier: ReaderProofVerifier<Peer> | undefined,
    peer: Peer,
    maxBytes: number,
  ): Promise<TrustedReaderContext>;
}> = Object.freeze({
  /**
   * Identifies a caller-supplied copy of internal reader metadata.
   *
   * @param headers Incoming native request headers.
   * @returns Whether either reserved header is present.
   */
  hasAssertion(headers: ReaderHeaders): boolean {
    return (
      ReaderForwardingWire.headerValue(headers, envelopeHeader) !== undefined ||
      ReaderForwardingWire.headerValue(headers, proofHeader) !== undefined
    );
  },

  /**
   * Encodes detached reader data against one canonical operation and message.
   *
   * @param service Canonical RPC service name.
   * @param method Canonical RPC method name.
   * @param value Canonical request message bytes.
   * @param reader Gateway-verified reader and authority facts.
   * @param issuer Configured peer proof producer.
   * @param maxBytes Existing native request-size bound.
   * @returns Internal metadata for one backend request.
   */
  async seal(
    service: string,
    method: string,
    value: Uint8Array,
    reader: TrustedReaderContext,
    issuer: ReaderProofIssuer,
    maxBytes: number,
  ): Promise<Readonly<Record<string, string>>> {
    const payload = getTextEncoding().encodeUtf8(
      JSON.stringify({
        service,
        method,
        reader: snapshotTrustedReader(reader),
      }),
    );
    ReaderForwardingWire.assertBound(payload.byteLength, maxBytes);
    const proof = await issuer.issue(ReaderForwardingWire.proofBytes(payload, value));
    if (typeof proof !== "string" || !proof) throw new Error("Invalid forwarding proof.");
    ReaderForwardingWire.assertBound(proof.length, maxBytes);
    return Object.freeze({ [envelopeHeader]: base64Encode(payload), [proofHeader]: proof });
  },

  /**
   * Opens one bounded assertion only after the configured port authenticates its peer.
   *
   * @param headers Native request headers.
   * @param service Canonical RPC service name.
   * @param method Canonical RPC method name.
   * @param value Canonical request message bytes.
   * @param verifier Configured trusted-forwarding peer verifier.
   * @param peer Receiving transport's peer context.
   * @param maxBytes Existing native request-size bound.
   * @returns Detached verified reader facts.
   * @typeParam Peer Native transport peer context.
   */
  async open<Peer>(
    headers: ReaderHeaders,
    service: string,
    method: string,
    value: Uint8Array,
    verifier: ReaderProofVerifier<Peer> | undefined,
    peer: Peer,
    maxBytes: number,
  ): Promise<TrustedReaderContext> {
    const encoded = ReaderForwardingWire.headerValue(headers, envelopeHeader);
    const proof = ReaderForwardingWire.headerValue(headers, proofHeader);
    if (verifier === undefined || encoded === undefined || proof === undefined || !proof)
      throw new Error("Invalid forwarding proof.");
    const { payload, decoded } = ReaderForwardingWire.decodeEnvelope(encoded, proof, maxBytes);
    if (
      !("service" in decoded) ||
      decoded.service !== service ||
      !("method" in decoded) ||
      decoded.method !== method ||
      !("reader" in decoded) ||
      decoded.reader === undefined
    )
      throw new Error("Invalid forwarding proof.");
    if (!(await verifier.verify(ReaderForwardingWire.proofBytes(payload, value), proof, peer)))
      throw new Error("Invalid forwarding proof.");
    try {
      return snapshotTrustedReader(decoded.reader as TrustedReaderContext);
    } catch {
      throw new Error("Invalid forwarding proof.");
    }
  },
});
