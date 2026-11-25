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

import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";
import * as privateProto from "@spine-event-engine/proto/generated/spine/delivery/session/private_delivery_pb.js";

import { CapacityLedger, type CapacityTicket, type CapacityUsage } from "./capacity-ledger.js";

/**
 * Maps a private bearer credential to one active child process generation.
 */
export interface ChildCredential {
  /**
   * Identifies the child's fixed route slot.
   */
  readonly slot: number;

  /**
   * Distinguishes a child process from its replacement.
   */
  readonly generation: string;
}

/**
 * Serves global capacity grants only to authenticated child processes.
 */
export class PrivateCapacityHandlers {
  /**
   * Creates private capacity handlers over one global ledger.
   *
   * @param ledger Preserves the server-wide retained-state limits.
   * @param credentials Maps unguessable bearer credentials to live children.
   */
  constructor(
    private readonly ledger: CapacityLedger,
    private readonly credentials: ReadonlyMap<string, ChildCredential>,
  ) {}

  /**
   * Returns the private gRPC descriptor implementation.
   *
   * @returns Authenticated capacity operations.
   */
  service(): ServiceImpl<typeof privateProto.PrivateCapacityService> {
    return {
      reserve: (request, context) => {
        const ticket = this.#ticket(request.ticket, context.requestHeader);
        if (request.growth === undefined)
          throw new ConnectError("Delivery capacity growth is missing.", Code.InvalidArgument);
        this.ledger.reserve(ticket, PrivateCapacityHandlers.#usage(request.growth), request.phase);
        return {};
      },
      report: (request, context) => {
        const ticket = this.#ticket(request.ticket, context.requestHeader);
        if (request.usage === undefined)
          throw new ConnectError("Delivery capacity usage is missing.", Code.InvalidArgument);
        if (request.revision === undefined)
          throw new ConnectError("Delivery capacity revision is missing.", Code.InvalidArgument);
        this.ledger.report(ticket, PrivateCapacityHandlers.#usage(request.usage), request.revision);
        return {};
      },
      cancel: (request, context) => {
        this.ledger.cancel(this.#ticket(request, context.requestHeader));
        return {};
      },
      reportUsage: (request, context) => this.#reportUsage(request, context.requestHeader),
    };
  }

  /**
   * Applies one authenticated autonomous usage update.
   *
   * @param request Carries the child's state revision and totals.
   * @param headers Authenticates its process generation.
   * @returns An empty successful response.
   */
  #reportUsage(request: privateProto.CapacitySnapshot, headers: Headers): Record<string, never> {
    const credential = this.#credential(headers);
    if (request.slot !== BigInt(credential.slot) || request.generation !== credential.generation)
      throw new ConnectError("Delivery child generation is stale.", Code.FailedPrecondition);
    if (request.usage === undefined)
      throw new ConnectError("Delivery capacity usage is missing.", Code.InvalidArgument);
    if (request.revision === undefined)
      throw new ConnectError("Delivery capacity revision is missing.", Code.InvalidArgument);
    this.ledger.reportUsage(
      credential.slot,
      credential.generation,
      request.revision,
      PrivateCapacityHandlers.#usage(request.usage),
    );
    return {};
  }

  /**
   * Authenticates a ticket against its live child slot and generation.
   *
   * @param request Supplies the ticket fields, when present.
   * @param headers Carries the private bearer credential.
   * @returns The validated local ticket.
   */
  #ticket(
    request: { slot: bigint; generation: string; sequence: bigint } | undefined,
    headers: Headers,
  ): CapacityTicket {
    const credential = this.#credential(headers);
    if (request === undefined)
      throw new ConnectError("Delivery capacity ticket is missing.", Code.InvalidArgument);
    if (request.slot !== BigInt(credential.slot) || request.generation !== credential.generation)
      throw new ConnectError("Delivery child generation is stale.", Code.FailedPrecondition);
    return { slot: credential.slot, generation: credential.generation, sequence: request.sequence };
  }

  /**
   * Resolves one live child credential before any ledger mutation.
   *
   * @param headers Carries the private bearer credential.
   * @returns The matching child slot and generation.
   */
  #credential(headers: Headers): ChildCredential {
    const credential = this.credentials.get(headers.get("authorization") ?? "");
    if (credential === undefined)
      throw new ConnectError("Private Delivery child credential is invalid.", Code.Unauthenticated);
    return credential;
  }

  /**
   * Converts unsigned wire counts and leaves exact-range checks to the ledger.
   *
   * @param value Carries wire row, byte, and shard counts.
   * @returns Local numeric resource counts.
   */
  static #usage(value: { rows: bigint; bytes: bigint; shards: bigint }): CapacityUsage {
    return {
      rows: Number(value.rows),
      bytes: Number(value.bytes),
      shards: Number(value.shards),
    };
  }
}
