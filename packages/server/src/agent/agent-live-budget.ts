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

import type { AiInvocationLimits } from "@spine-event-engine/ai";
import { AgentLiveFault } from "./agent-live-fault.js";

/**
 * One reserved physical response credit within a live invocation.
*/
export interface AgentPhysicalTicket {
  /**
   * Identity of one admitted physical attempt.
   */
  readonly id: symbol;

  /**
   * Reserved output allowance, when bounded.
   */
  readonly maxOutputBytes: number | undefined;
}

interface PhysicalReceipt {
  readonly reserved: bigint | undefined;
  observed: bigint;
}

/**
 * Counts one live invocation without durable replay or unacknowledged writes.
*/
export class AgentLiveBudget {
  readonly #tickets = new Map<symbol, PhysicalReceipt>();

  #operations = 0;

  #modelRequests = 0;

  #toolCalls = 0;

  #reads = 0;

  #inputBytes = 0n;

  #outputBytes = 0n;

  /**
   * Captures application limits for the complete accepted signal.
   *
   * @param limits Configured resource limits.
  */
  constructor(private readonly limits: AiInvocationLimits) {}

  /**
   * Acquires one named AI operation before entering user or provider code.
  */
  reserveOperation(): void {
    this.#operations = this.count(
      this.#operations,
      this.limits.operations,
      "operation",
      "MODEL_BUDGET_EXCEEDED",
    );
  }

  /**
   * Acquires one external tool call before dispatch.
  */
  reserveToolCall(): void {
    this.#toolCalls = this.count(
      this.#toolCalls,
      this.limits.toolCalls,
      "tool call",
      "TOOL_BUDGET_EXCEEDED",
    );
  }

  /**
   * Acquires one complete history or projection read before provider work.
  */
  reserveRead(): void {
    this.#reads = this.count(
      this.#reads,
      this.limits.recordedReads,
      "read",
      "READ_BUDGET_EXCEEDED",
    );
  }

  /**
   * Acquires input and full unknown response credit before a physical send.
   * @param inputBytes Encoded physical request size.
   * @param requestedOutputBytes Maximum response bytes requested from the adapter.
   * @param kind Whether the send is a model request or MCP protocol message.
   * @returns A ticket whose credit remains charged until a measured response settles it.
  */
  reservePhysical(
    inputBytes: number,
    requestedOutputBytes: number | undefined,
    kind: "model" | "protocol",
  ): AgentPhysicalTicket {
    this.bytes(inputBytes);
    if (requestedOutputBytes !== undefined) this.bytes(requestedOutputBytes);
    const credit = this.credit(inputBytes, requestedOutputBytes);
    const nextModels =
      kind === "model"
        ? this.count(
            this.#modelRequests,
            this.limits.modelRequests,
            "request",
            "MODEL_BUDGET_EXCEEDED",
          )
        : this.#modelRequests;
    const id = Symbol("Agent physical request");
    this.#modelRequests = nextModels;
    this.#inputBytes += BigInt(inputBytes);
    this.#outputBytes += BigInt(credit ?? 0);
    this.#tickets.set(id, {
      reserved: credit === undefined ? undefined : BigInt(credit),
      observed: 0n,
    });
    return { id, maxOutputBytes: credit };
  }

  /**
   * Rejects a decoded chunk that would exceed the physical ticket's credit.
   * @param ticket Original physical reservation.
   * @param bytes Newly received decoded response bytes.
  */
  onReceived(ticket: AgentPhysicalTicket, bytes: number): void {
    this.bytes(bytes);
    const receipt = this.#tickets.get(ticket.id);
    if (receipt === undefined) throw new Error("Agent physical ticket is no longer active.");
    const observed = receipt.observed + BigInt(bytes);
    if (receipt.reserved !== undefined && observed > receipt.reserved)
      throw new AgentLiveFault(
        "MODEL_BUDGET_EXCEEDED",
        "Agent response byte credit was exceeded.",
      );
    receipt.observed = observed;
  }

  /**
   * Calculates full unknown response credit before changing counters.
   *
   * @param inputBytes Measured input payload bytes.
   * @param requestedOutputBytes Requested output byte allowance.
   * @returns The full reserved credit for an unknown model response.
  */
  private credit(inputBytes: number, requestedOutputBytes: number | undefined): number | undefined {
    if (
      this.limits.totalInputBytes !== undefined &&
      this.#inputBytes + BigInt(inputBytes) > BigInt(this.limits.totalInputBytes)
    )
      throw new AgentLiveFault(
        "MODEL_BUDGET_EXCEEDED",
        "Agent invocation input byte budget is exhausted.",
      );
    const remaining =
      this.limits.totalOutputBytes === undefined
        ? undefined
        : BigInt(this.limits.totalOutputBytes) - this.#outputBytes;
    if (remaining !== undefined && remaining < 1n)
      throw new AgentLiveFault(
        "MODEL_BUDGET_EXCEEDED",
        "Agent invocation output byte credit is exhausted.",
      );
    const available = remaining === undefined ? undefined : Number(remaining);
    const credit =
      requestedOutputBytes === undefined
        ? available
        : available === undefined
          ? requestedOutputBytes
          : Math.min(requestedOutputBytes, available);
    if (credit !== undefined && !Number.isSafeInteger(credit))
      throw new RangeError("Agent response credit exceeds a safe byte count.");
    return credit;
  }

  /**
   * Replaces unknown credit with measured response bytes after a confirmed result.
   * @param ticket Original physical request reservation.
   * @param receivedBytes Complete measured response size.
  */
  settlePhysical(ticket: AgentPhysicalTicket, receivedBytes: number): void {
    this.bytes(receivedBytes);
    const receipt = this.#tickets.get(ticket.id);
    if (receipt === undefined) throw new Error("Agent physical ticket is no longer active.");
    const reserved = receipt.reserved;
    if (reserved !== undefined && BigInt(receivedBytes) > reserved)
      throw new AgentLiveFault(
        "MODEL_BUDGET_EXCEEDED",
        "Agent response byte credit was exceeded.",
      );
    if (receipt.observed !== 0n && receipt.observed !== BigInt(receivedBytes))
      throw new Error("Agent response receipt byte counts disagree.");
    this.#tickets.delete(ticket.id);
    this.#outputBytes += BigInt(receivedBytes) - (reserved ?? 0n);
  }

  /**
   * Applies one count ceiling without mutating state on failure.
   *
   * @param label Inbox routing label.
   * @param limit Maximum allowed count or bytes.
   * @param reason Cause of cancellation or failure.
   * @param value Typed value being processed.
   * @returns The count after validation against the configured ceiling.
  */
  private count(
    value: number,
    limit: number | undefined,
    label: string,
    reason: "MODEL_BUDGET_EXCEEDED" | "TOOL_BUDGET_EXCEEDED" | "READ_BUDGET_EXCEEDED",
  ): number {
    if (limit !== undefined && value >= limit)
      throw new AgentLiveFault(reason, `Agent ${label} budget is exhausted.`);
    return value + 1;
  }

  /**
   * Rejects negative, fractional, or unsafe byte counts.
   *
   * @param value Typed value being processed.
  */
  private bytes(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new RangeError("Agent byte count must be a nonnegative safe integer.");
  }
}
