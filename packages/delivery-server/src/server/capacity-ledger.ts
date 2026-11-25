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
import type { DeliveryStateLimits } from "../core/limits.js";

/**
 * Counts one child process's retained resources.
 */
export interface CapacityUsage {
  /**
   * Counts retained Inbox records.
   */
  readonly rows: number;

  /**
   * Counts encoded bytes retained by Inbox records.
   */
  readonly bytes: number;

  /**
   * Counts shards retained by records or sessions.
   */
  readonly shards: number;
}

/**
 * Identifies one mutation within a child process generation.
 */
export interface CapacityTicket {
  /**
   * Identifies the child's fixed route slot.
   */
  readonly slot: number;

  /**
   * Distinguishes a child process from its replacement.
   */
  readonly generation: string;

  /**
   * Orders mutations issued to this child process.
   */
  readonly sequence: bigint;
}

interface SlotUsage {
  readonly generation: string;
  readonly reservations: Map<bigint, { readonly phase: bigint; readonly growth: CapacityUsage }>;
  readonly retiredGaps: Set<bigint>;
  committed: CapacityUsage;
  retiredThrough: bigint;
  revision: bigint;
}

const zero: CapacityUsage = Object.freeze({ rows: 0, bytes: 0, shards: 0 });

/**
 * Reserves global headroom without waiting for child RPC completion.
 */
export class CapacityLedger {
  readonly #slots = new Map<number, SlotUsage>();

  /**
   * Creates one ledger for the configured server-wide limits.
   *
   * @param limits Preserves the standalone server's retained-state limits.
   */
  constructor(private readonly limits: DeliveryStateLimits) {}

  /**
   * Replaces lost volatile usage with a new empty child generation.
   *
   * @param slot Identifies the fixed child slot.
   * @param generation Identifies its new process.
   */
  replace(slot: number, generation: string): void {
    this.#slots.set(slot, {
      generation,
      reservations: new Map(),
      retiredGaps: new Set(),
      committed: zero,
      retiredThrough: 0n,
      revision: 0n,
    });
  }

  /**
   * Acquires capacity for positive potential growth while other slots use remaining headroom.
   *
   * @param ticket Correlates the child's mutation.
   * @param growth Counts possible positive resource growth.
   * @param phase Orders updated growth estimates for the same ticket.
   */
  reserve(ticket: CapacityTicket, growth: CapacityUsage, phase = 0n): void {
    const slot = this.#current(ticket);
    CapacityLedger.#validateUsage(growth);
    if (phase < 0n) throw new ConnectError("Delivery capacity phase is invalid.", Code.InvalidArgument);
    if (CapacityLedger.#retired(slot, ticket.sequence))
      throw new ConnectError("Delivery capacity ticket is retired.", Code.FailedPrecondition);
    const previous = slot.reservations.get(ticket.sequence);
    if (previous !== undefined) {
      if (phase < previous.phase) return;
      if (phase === previous.phase && !CapacityLedger.#same(previous.growth, growth))
        throw new ConnectError("Delivery capacity ticket changed.", Code.FailedPrecondition);
      if (phase === previous.phase) return;
    }
    const usage = this.usage();
    const prior = previous?.growth ?? zero;
    if (
      usage.rows - prior.rows + growth.rows > this.limits.maxRetainedMessages ||
      usage.bytes - prior.bytes + growth.bytes > this.limits.maxRetainedBytes ||
      usage.shards - prior.shards + growth.shards > this.limits.maxTrackedShards
    )
      throw new ConnectError("Delivery retained-state capacity is full.", Code.ResourceExhausted);
    slot.reservations.set(ticket.sequence, { phase, growth: Object.freeze({ ...growth }) });
  }

  /**
   * Replaces one reservation with the child's exact post-mutation usage.
   *
   * @param ticket Correlates the completed mutation.
   * @param usage Counts the child's retained resources.
   * @param revision Orders this report against autonomous expiry reports.
   */
  report(ticket: CapacityTicket, usage: CapacityUsage, revision: bigint): void {
    const slot = this.#current(ticket);
    CapacityLedger.#validateUsage(usage);
    CapacityLedger.#validateRevision(revision);
    if (CapacityLedger.#retired(slot, ticket.sequence)) return;
    if (!slot.reservations.has(ticket.sequence))
      throw new ConnectError("Delivery capacity ticket was not reserved.", Code.FailedPrecondition);
    if (revision === slot.revision && !CapacityLedger.#same(slot.committed, usage))
      throw new ConnectError(
        "Delivery capacity revision conflicts with committed usage.",
        Code.FailedPrecondition,
      );
    if (revision > slot.revision) {
      slot.committed = Object.freeze({ ...usage });
      slot.revision = revision;
    }
    slot.reservations.delete(ticket.sequence);
    CapacityLedger.#retire(slot, ticket.sequence);
  }

  /**
   * Applies a later autonomous expiry without replaying an older mutation report.
   *
   * @param slotIndex Identifies the fixed child slot.
   * @param generation Identifies its live process.
   * @param revision Orders child state transitions.
   * @param usage Counts resources after the autonomous change.
   */
  reportUsage(slotIndex: number, generation: string, revision: bigint, usage: CapacityUsage): void {
    const slot = this.#current({ slot: slotIndex, generation, sequence: 1n });
    CapacityLedger.#validateUsage(usage);
    CapacityLedger.#validateRevision(revision);
    if (revision < slot.revision) return;
    if (revision === slot.revision) {
      if (!CapacityLedger.#same(slot.committed, usage))
        throw new ConnectError(
          "Delivery capacity revision conflicts with committed usage.",
          Code.FailedPrecondition,
        );
      return;
    }
    slot.committed = Object.freeze({ ...usage });
    slot.revision = revision;
  }

  /**
   * Cancels a mutation that did not commit.
   *
   * @param ticket Correlates the canceled mutation.
   */
  cancel(ticket: CapacityTicket): void {
    const slot = this.#current(ticket);
    if (CapacityLedger.#retired(slot, ticket.sequence)) return;
    slot.reservations.delete(ticket.sequence);
    CapacityLedger.#retire(slot, ticket.sequence);
  }

  /**
   * Returns committed usage and unsettled positive reservations across slots.
   *
   * @returns Server-wide capacity currently unavailable to new mutations.
   */
  usage(): CapacityUsage {
    let rows = 0;
    let bytes = 0;
    let shards = 0;
    for (const slot of this.#slots.values()) {
      rows += slot.committed.rows;
      bytes += slot.committed.bytes;
      shards += slot.committed.shards;
      for (const { growth } of slot.reservations.values()) {
        rows += growth.rows;
        bytes += growth.bytes;
        shards += growth.shards;
      }
    }
    return { rows, bytes, shards };
  }

  /**
   * Selects the live child generation for one ticket.
   */
  #current(ticket: CapacityTicket): SlotUsage {
    if (!Number.isSafeInteger(ticket.slot) || ticket.slot < 0 || ticket.sequence < 1n)
      throw new ConnectError("Delivery capacity ticket is invalid.", Code.InvalidArgument);
    const slot = this.#slots.get(ticket.slot);
    if (slot?.generation !== ticket.generation)
      throw new ConnectError("Delivery child generation is stale.", Code.FailedPrecondition);
    return slot;
  }

  /**
   * Rejects resource counts that cannot be represented exactly in JavaScript.
   */
  static #validateUsage(usage: CapacityUsage): void {
    if (
      !Number.isSafeInteger(usage.rows) ||
      usage.rows < 0 ||
      !Number.isSafeInteger(usage.bytes) ||
      usage.bytes < 0 ||
      !Number.isSafeInteger(usage.shards) ||
      usage.shards < 0
    )
      throw new ConnectError("Delivery capacity usage is invalid.", Code.InvalidArgument);
  }

  /**
   * Compares the three counted resources without using object identity.
   */
  static #same(left: CapacityUsage, right: CapacityUsage): boolean {
    return left.rows === right.rows && left.bytes === right.bytes && left.shards === right.shards;
  }

  /**
   * Checks both contiguous retirement and an out-of-order retired ticket.
   */
  static #retired(slot: SlotUsage, sequence: bigint): boolean {
    return sequence <= slot.retiredThrough || slot.retiredGaps.has(sequence);
  }

  /**
   * Compacts retired tickets as preceding sequences settle.
   */
  static #retire(slot: SlotUsage, sequence: bigint): void {
    slot.retiredGaps.add(sequence);
    while (slot.retiredGaps.delete(slot.retiredThrough + 1n)) slot.retiredThrough++;
  }

  /**
   * Rejects a negative revision before changing ledger state.
   */
  static #validateRevision(revision: bigint): void {
    if (revision < 0n)
      throw new ConnectError("Delivery capacity revision is invalid.", Code.InvalidArgument);
  }
}
