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

import { createHash } from "node:crypto";
import { clone, create } from "@bufbuild/protobuf";
import type { Any } from "@bufbuild/protobuf/wkt";
import type { CommandId, EventId } from "@spine-event-engine/proto";
import {
  AgentAcceptanceKeySchema,
  AgentAcceptanceReceiptSchema,
  type AgentAcceptanceKey,
  type AgentAcceptanceReceipt,
} from "@spine-event-engine/proto/generated/spine/server/agent/acceptance_receipt_pb.js";
import {
  RecordSpec,
  StorageGroup,
  type RecordStorage,
  type StorageContext,
  type StorageFactory,
} from "@spine-event-engine/storage";
import { TenantBoundary } from "@spine-event-engine/storage/provider";
import type { DeliveryLabel } from "../delivery/inbox.js";

/**
 * Declarative physical family shared by runtime use and explicit preparation.
 */
export const agentAcceptanceReceiptSpec: RecordSpec<string, AgentAcceptanceReceipt> =
  new RecordSpec<string, AgentAcceptanceReceipt>({
    idKind: "string",
    recordType: AgentAcceptanceReceiptSchema,
    extractId: (receipt) => {
      if (receipt.key === undefined) throw new TypeError("Agent receipt has no identity.");
      return ReceiptIdentity.slot(receipt.key);
    },
  });

/**
 * Stable physical group for Agent acceptance evidence.
 */
export const agentAcceptanceReceiptGroup: StorageGroup = new StorageGroup("spine_agent_acceptance");

/**
 * Typed source and recipient of one Agent delivery.
 */
export interface AgentAcceptanceInput {
  /**
   * Generated Agent state type.
   */
  readonly stateType: string;

  /**
   * Original typed recipient, including the exact Any type URL.
   */
  readonly recipientId: Any;

  /**
   * Original typed Command or Event identifier.
   */
  readonly source:
    | { readonly kind: "command"; readonly id: CommandId }
    | { readonly kind: "event"; readonly id: EventId };

  /**
   * Delivery route that selected the Agent.
   */
  readonly action: DeliveryLabel;
}

/**
 * Retains one atomic receipt handle per complete tenant boundary.
 *
 * @internal
 */
export class AgentAcceptanceReceipts {
  readonly #factory: StorageFactory;

  readonly #storages = new Map<string | symbol, RecordStorage<string, AgentAcceptanceReceipt>>();

  #active = 0;

  #resolveIdle: (() => void) | undefined;

  #closing: Promise<void> | undefined;

  /**
   * Creates an inert receipt helper without opening storage.
   *
   * @param factory Provider factory used only when the first receipt is admitted.
   */
  constructor(factory: StorageFactory) {
    this.#factory = factory;
  }

  /**
   * Accepts one typed delivery atomically; only `true` may permit live execution.
   *
   * @param context Complete physical tenant scope.
   * @param input Typed delivery identity.
   * @returns Whether this attempt first established the immutable receipt.
   */
  async accept(context: StorageContext, input: AgentAcceptanceInput): Promise<boolean> {
    if (this.#closing !== undefined) throw new Error("Agent acceptance receipts are closed.");
    this.#active++;
    try {
      const key = clone(AgentAcceptanceKeySchema, this.#key(input));
      const slot = ReceiptIdentity.slot(key);
      const storage = this.#storage(context);
      if (!storage.atomicCompareAndSet)
        throw new Error("Agent acceptance requires atomic compare-and-set storage.");
      if (
        await storage.compareAndSet(slot, undefined, create(AgentAcceptanceReceiptSchema, { key }))
      )
        return true;
      const previous = await storage.read(slot);
      if (previous?.key === undefined)
        throw new Error("Agent acceptance receipt is missing after lost CAS.");
      if (ReceiptIdentity.text(previous.key) !== ReceiptIdentity.text(key))
        throw new Error("Agent acceptance receipt identity conflict.");
      return false;
    } finally {
      this.#active--;
      if (this.#active === 0) this.#resolveIdle?.();
    }
  }

  /**
   * Closes retained handles after fencing new admissions and draining admitted CAS operations.
   *
   * @returns Repeatable completion after admitted CAS operations and all handles settle.
   */
  close(): Promise<void> {
    if (this.#closing !== undefined) return this.#closing;
    const idle =
      this.#active === 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            this.#resolveIdle = () => {
              resolve();
            };
          });
    this.#closing = idle.then(() => {
      this.#closeStorages();
    });
    return this.#closing;
  }

  /**
   * Constructs one generated identity without changing the supplied type URL.
   * @param input Typed delivery identity.
   * @returns Its generated complete identity evidence.
   */
  #key(input: AgentAcceptanceInput): AgentAcceptanceKey {
    if (input.stateType.trim().length === 0 || input.recipientId.typeUrl.length === 0)
      throw new TypeError("Agent acceptance requires a state type and typed recipient.");
    return create(AgentAcceptanceKeySchema, {
      stateType: input.stateType,
      recipientId: input.recipientId,
      source:
        input.source.kind === "command"
          ? { case: "command", value: input.source.id }
          : { case: "event", value: input.source.id },
      action: input.action,
    });
  }

  /**
   * Finds or creates one handle for a complete physical tenant scope.
   * @param context Complete physical scope.
   * @returns Retained atomic record handle.
   */
  #storage(context: StorageContext): RecordStorage<string, AgentAcceptanceReceipt> {
    const boundary = TenantBoundary.of(context);
    const retained = this.#storages.get(boundary.key);
    if (retained !== undefined) return retained;
    const selected =
      boundary.tenantId === undefined
        ? { name: context.name, multitenant: false as const }
        : { name: context.name, multitenant: true as const, tenantId: boundary.tenantId };
    const storage = this.#factory.createRecordStorage(
      selected,
      agentAcceptanceReceiptSpec,
      agentAcceptanceReceiptGroup,
    );
    this.#storages.set(boundary.key, storage);
    return storage;
  }

  /**
   * Attempts every retained close and preserves all cleanup failures.
   */
  #closeStorages(): void {
    const errors: unknown[] = [];
    for (const storage of this.#storages.values()) {
      try {
        storage.close();
      } catch (error) {
        errors.push(error);
      }
    }
    this.#storages.clear();
    if (errors.length !== 0) throw new AggregateError(errors, "Agent receipt cleanup failed.");
  }
}

/**
 * Encodes one complete typed identity for provider slots and collision checks.
 */
const ReceiptIdentity = Object.freeze({
  /**
   * Encodes declared identity fields with stable framing and exact Any bytes.
   *
   * @param key Complete generated identity evidence.
   * @returns Stable v1 tuple text for slot derivation and collision checking.
   */
  text(key: AgentAcceptanceKey): string {
    const recipient = key.recipientId;
    const source = key.source;
    const sourceId =
      source.case === "command"
        ? source.value.uuid
        : source.case === "event"
          ? source.value.value
          : undefined;
    if (!key.stateType || !recipient?.typeUrl || !sourceId || !key.action)
      throw new TypeError("Agent acceptance receipt has incomplete identity.");
    return JSON.stringify([
      "spine.server.agent.AgentAcceptanceKey/v1",
      key.stateType,
      recipient.typeUrl,
      Buffer.from(recipient.value).toString("base64"),
      source.case,
      sourceId,
      key.action,
    ]);
  },

  /**
   * Calculates the fixed provider slot from the complete typed identity.
   *
   * @param key Complete generated identity evidence.
   * @returns Versioned 67-character record slot.
   */
  slot(key: AgentAcceptanceKey): string {
    return `v1:${createHash("sha256").update(this.text(key), "utf8").digest("hex")}`;
  },
});
