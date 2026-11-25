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

import { createClient } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import * as privateProto from "@spine-event-engine/proto/generated/spine/delivery/session/private_delivery_pb.js";

import type { CapacityTicket, CapacityUsage } from "./capacity-ledger.js";
import type { CapacityReservationClient } from "./capacity-mutation-gate.js";

/**
 * Sends authenticated capacity tickets from one child to the parent.
 */
export class PrivateCapacityClient implements CapacityReservationClient {
  readonly #sessions: Http2SessionManager;

  readonly #client: ReturnType<typeof createClient<typeof privateProto.PrivateCapacityService>>;

  /**
   * Opens a reusable transport to the parent's private loopback listener.
   *
   * @param baseUrl Identifies the parent's private listener.
   * @param credential Authenticates this child process generation.
   * @param slot Identifies this child's fixed route slot.
   * @param generation Distinguishes this child from a replacement.
   */
  constructor(
    baseUrl: string,
    private readonly credential: string,
    private readonly slot: number,
    private readonly generation: string,
  ) {
    this.#sessions = new Http2SessionManager(baseUrl);
    this.#client = createClient(
      privateProto.PrivateCapacityService,
      createGrpcTransport({
        baseUrl,
        sessionManager: this.#sessions,
      }),
    );
  }

  /**
   * Acquires possible positive growth before the named mutation begins.
   *
   * @param ticket Correlates the mutation and later report.
   * @param growth Holds possible positive row, byte, and shard growth.
   * @param signal Cancels an unanswered private transport call.
   * @returns Completion after the parent reserves capacity.
   */
  async reserve(ticket: CapacityTicket, growth: CapacityUsage,
    signal?: AbortSignal): Promise<void> {
    await this.#client.reserve(
      {
        ticket: PrivateCapacityClient.#ticket(ticket),
        growth: PrivateCapacityClient.#usage(growth),
      },
      this.#options(signal),
    );
  }

  /**
   * Replaces a committed mutation with exact child usage.
   *
   * @param ticket Correlates the mutation's earlier reservation.
   * @param usage Counts resources retained after the mutation.
   * @param revision Orders this report against autonomous expiry.
   * @param signal Cancels an unanswered private transport call.
   * @returns Completion after the parent applies exact usage.
   */
  async report(ticket: CapacityTicket, usage: CapacityUsage, revision: bigint,
    signal?: AbortSignal): Promise<void> {
    await this.#client.report(
      {
        ticket: PrivateCapacityClient.#ticket(ticket),
        usage: PrivateCapacityClient.#usage(usage),
        revision,
      },
      this.#options(signal),
    );
  }

  /**
   * Cancels a reservation for a mutation that did not commit.
   *
   * @param ticket Identifies the original reservation.
   * @param signal Cancels an unanswered private transport call.
   * @returns Completion after the parent retires the ticket.
   */
  async cancel(ticket: CapacityTicket, signal?: AbortSignal): Promise<void> {
    await this.#client.cancel(PrivateCapacityClient.#ticket(ticket), this.#options(signal));
  }

  /**
   * Publishes an autonomous expiry in the child's state transition order.
   *
   * @param snapshot Captures exact resources and their state revision.
   * @returns Completion after the parent applies the snapshot.
   */
  async reportUsage(snapshot: {
    readonly revision: bigint;
    readonly usage: CapacityUsage;
  }): Promise<void> {
    await this.#client.reportUsage(
      {
        slot: BigInt(this.slot),
        generation: this.generation,
        revision: snapshot.revision,
        usage: PrivateCapacityClient.#usage(snapshot.usage),
      },
      this.#options(),
    );
  }

  /**
   * Closes child-to-parent HTTP/2 sessions during process shutdown.
   */
  close(): void {
    this.#sessions.abort();
  }

  /**
   * Adds this child generation's private credential to one RPC.
   *
   * @param signal Cancels an unanswered transport call, when supplied.
   * @returns Request headers for the parent capacity listener.
   */
  #options(signal?: AbortSignal): { readonly headers: Headers; readonly signal?: AbortSignal } {
    const headers = new Headers({ authorization: this.credential });
    return signal === undefined ? { headers } : { headers, signal };
  }

  /**
   * Converts a local ticket to its unsigned wire representation.
   *
   * @param ticket Identifies the child mutation.
   * @returns The wire ticket fields.
   */
  static #ticket(ticket: CapacityTicket) {
    return {
      slot: BigInt(ticket.slot),
      generation: ticket.generation,
      sequence: ticket.sequence,
    };
  }

  /**
   * Converts exact local resource counts to unsigned wire integers.
   *
   * @param usage Counts retained resources in this child.
   * @returns The wire usage fields.
   */
  static #usage(usage: CapacityUsage) {
    return {
      rows: BigInt(usage.rows),
      bytes: BigInt(usage.bytes),
      shards: BigInt(usage.shards),
    };
  }
}
