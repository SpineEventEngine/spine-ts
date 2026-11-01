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

import type { MessageShape } from "@bufbuild/protobuf";
import type { MessageSchema } from "@spine-event-engine/core";
import type { TenantId, Version } from "@spine-event-engine/proto";
import type { ReadSideContext } from "./read-side-filter.js";
import type { ReadSideFilterEngine } from "./read-side-filter-engine.js";

/**
 * Preserves committed metadata and detached domain values before public filtering.
 *
 * @typeParam Schema The registered state schema.
 */
export interface StandSourceUpdate<Schema extends MessageSchema = MessageSchema> {
  /**
   * Registered state type URL.
   */
  readonly typeUrl: string;

  /**
   * Typed Entity identifier from the committed update.
   */
  readonly id: unknown;

  /**
   * Committed current state before filtering.
   */
  readonly state: MessageShape<Schema>;

  /**
   * Committed prior state when the update replaced one.
   */
  readonly previousState?: MessageShape<Schema>;

  /**
   * Committed state version when supplied.
   */
  readonly version?: Version;

  /**
   * Tenant recorded with the committed state.
   */
  readonly tenantId?: TenantId;
}

/**
 * Preserves original identity when a read policy removes the domain state.
 */
export interface StandUpdateMetadata {
  /**
   * Registered state type URL.
   */
  readonly typeUrl: string;

  /**
   * Typed Entity identifier from the committed update.
   */
  readonly id: unknown;

  /**
   * Committed state version when supplied.
   */
  readonly version?: Version;

  /**
   * Tenant recorded with the committed state.
   */
  readonly tenantId?: TenantId;
}

/**
 * Delivers a visible state or a removal after the producing Bounded Context's policies.
 *
 * @typeParam Schema The registered state schema.
 */
export type StandUpdate<Schema extends MessageSchema = MessageSchema> =
  | (StandUpdateMetadata & {
      /**
       * Indicates that the current state survived read policies.
       */
      readonly kind: "state";

      /**
       * Visible current state.
       */
      readonly state: MessageShape<Schema>;

      /**
       * Visible prior state when it survived independently.
       */
      readonly previousState?: MessageShape<Schema>;
    })
  | (StandUpdateMetadata & {
      /**
       * Indicates that read policies removed the current state.
       */
      readonly kind: "removal";

      /**
       * Marks a state no longer visible to this reader.
       */
      readonly noLongerMatching: true;
    });

/**
 * Receives serial filtered values and one terminal local delivery error.
 *
 * @typeParam Schema The registered state schema.
 */
export interface StandObserver<Schema extends MessageSchema> {
  /**
   * Processes one visible state or removal before the next filter starts.
   *
   * @param update Visible state or removal with original committed metadata.
   * @returns Completion of this delivery before the next update begins.
   */
  next(update: StandUpdate<Schema>): void | Promise<void>;

  /**
   * Notifies the observer of a terminal policy, callback, or waiting-capacity fault.
   *
   * @param error The local delivery fault that closed this observer.
   * @returns Completion of local error notification, which cannot affect committed writes.
   */
  error(error: Error): void | Promise<void>;
}

/**
 * Indicates that one direct subscriber exhausted its waiting-update capacity.
 */
export class StandSubscriptionCapacityError extends Error {
  /**
   * Creates a local fault with the configured waiting capacity.
   *
   * @param limit Maximum number of waiting updates after the active update.
   */
  constructor(limit: number) {
    super(`Stand subscription exceeded ${String(limit)} waiting updates.`);
    this.name = "StandSubscriptionCapacityError";
  }
}

/**
 * Serializes one direct observer independently of peer subscriptions.
 *
 * @typeParam Schema The registered state schema.
 */
export class StandDirectDelivery<Schema extends MessageSchema> {
  readonly #pending: StandSourceUpdate<Schema>[] = [];

  readonly #abort = new AbortController();

  #active = false;

  #closed = false;

  /**
   * Captures this subscription's policy and trusted invocation facts.
   *
   * @param schema Registered state schema.
   * @param observer Local observer receiving visible values or one terminal fault.
   * @param filters Producing Bounded Context read policies, if installed.
   * @param facts Detached actor, tenant, and verified reader facts.
   * @param queueLimit Maximum waiting updates beyond the active update.
   * @param onClose Removes this observer from its Stand registration.
   * @param externalSignal Caller cancellation signal, if provided.
   */
  constructor(
    readonly schema: Schema,
    readonly observer: StandObserver<Schema>,
    readonly filters: ReadSideFilterEngine | undefined,
    readonly facts: ReadSideContext,
    readonly queueLimit: number,
    readonly onClose: () => void,
    readonly externalSignal: AbortSignal | undefined,
  ) {
    externalSignal?.addEventListener("abort", this.close, { once: true });
    if (externalSignal?.aborted) this.close();
  }

  /**
   * Returns whether this subscriber still accepts source updates.
   *
   * @returns True after cancellation, overflow, a policy fault, or close.
   */
  get closed(): boolean {
    return this.#closed;
  }

  /**
   * Admits one detached update without waiting for policy code.
   *
   * @param update Committed source update for this subscriber.
   */
  admit(update: StandSourceUpdate<Schema>): void {
    if (this.#closed) return;
    if (!this.#active) {
      this.#active = true;
      void this.#run(update);
      return;
    }
    if (this.#pending.length >= this.queueLimit) {
      this.#fail(new StandSubscriptionCapacityError(this.queueLimit));
      return;
    }
    this.#pending.push(update);
  }

  /**
   * Closes active work and clears queued snapshots without waiting on policy code.
   */
  readonly close = (): void => {
    if (this.#closed) return;
    this.#closed = true;
    this.#pending.length = 0;
    this.#abort.abort();
    this.externalSignal?.removeEventListener("abort", this.close);
    this.onClose();
  };

  /**
   * Completes one filter and delivery before beginning the next.
   *
   * @param source Detached committed update selected for active processing.
   */
  async #run(source: StandSourceUpdate<Schema>): Promise<void> {
    try {
      const update =
        this.filters === undefined
          ? this.#visible(source)
          : await this.#filtered(source, this.filters);
      if (!this.#closed) await this.observer.next(update);
    } catch (error) {
      if (!this.#closed) this.#fail(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.#active = false;
      const next = this.#pending.shift();
      if (!this.#closed && next !== undefined) {
        this.#active = true;
        void this.#run(next);
      }
    }
  }

  /**
   * Applies current and previous policies in source order, retaining original metadata.
   *
   * @param source Detached committed update.
   * @param filters Installed read policy engine.
   * @returns Visible state or removal with original metadata.
   */
  async #filtered(
    source: StandSourceUpdate<Schema>,
    filters: ReadSideFilterEngine,
  ): Promise<StandUpdate<Schema>> {
    const context: ReadSideContext = {
      ...this.facts,
      signal: this.#abort.signal,
    };
    const state = await filters.apply(this.schema, source.state, context);
    if (this.#closed || state === null) return this.#removal(source);
    const previousState =
      source.previousState === undefined
        ? undefined
        : await filters.apply(this.schema, source.previousState, context);
    return {
      ...this.#metadata(source),
      kind: "state",
      state,
      ...(previousState === undefined || previousState === null ? {} : { previousState }),
    };
  }

  /**
   * Passes a detached source value when the context installed no read policies.
   *
   * @param source Detached committed update.
   * @returns State delivery without policy transformation.
   */
  #visible(source: StandSourceUpdate<Schema>): StandUpdate<Schema> {
    return {
      ...this.#metadata(source),
      kind: "state",
      state: source.state,
      ...(source.previousState === undefined ? {} : { previousState: source.previousState }),
    };
  }

  /**
   * Keeps removal identity independent of edited domain values.
   *
   * @param source Detached committed update.
   * @returns Removal with original identity and version.
   */
  #removal(source: StandSourceUpdate<Schema>): StandUpdate<Schema> {
    return { ...this.#metadata(source), kind: "removal", noLongerMatching: true };
  }

  /**
   * Selects original version and tenant fields from this committed notification.
   *
   * @param source Detached committed update.
   * @returns Original metadata unaffected by policy mutations.
   */
  #metadata(source: StandSourceUpdate<Schema>): StandUpdateMetadata {
    return {
      typeUrl: source.typeUrl,
      id: source.id,
      ...(source.version === undefined ? {} : { version: source.version }),
      ...(source.tenantId === undefined ? {} : { tenantId: source.tenantId }),
    };
  }

  /**
   * Terminates only this subscriber and contains errors from the error observer.
   *
   * @param error Policy, callback, or waiting-capacity fault.
   */
  #fail(error: Error): void {
    this.close();
    try {
      void Promise.resolve(this.observer.error(error)).catch(() => undefined);
    } catch {
      /* A terminal observer cannot affect an already committed update. */
    }
  }
}
