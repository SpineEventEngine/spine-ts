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
import { Time } from "@spine-event-engine/core/time";

import { DeliveryChildPool, type DeliveryChildEndpoint } from "./delivery-child-pool.js";

/**
 * Selects global Admin acknowledgement or independent work-stream behavior.
 */
type Mode = "admin" | "work";

/**
 * Merges one private stream per healthy slot with one unread frame per slot.
 *
 * @typeParam T The generated frame type of one child stream.
 */
export class DeliveryStreamFanIn<T> {
  readonly #controller = new AbortController();

  readonly #slotControllers = new Map<number, AbortController>();

  readonly #selected = new Map<number, DeliveryChildEndpoint>();

  readonly #pending = new Map<number, { frame: T; consumed: () => void }>();

  readonly #ready: PromiseWithResolvers<undefined>[];

  #wake = Promise.withResolvers<undefined>();

  #lifecycle = Promise.withResolvers<undefined>();

  readonly #lifecycleWaiters = new Set<() => void>();

  #error: Error | undefined;

  #version = 0;

  #started = false;

  #detach: (() => void) | undefined;

  /**
   * Starts one independent private subscription for each fixed slot.
   *
   * @param pool Supplies live generation endpoints.
   * @param mode Requires all initial Admin acknowledgements or retries work streams.
   * @param open Opens a typed child stream with its private credential.
   * @param acknowledged Recognizes the child's Admin created frame.
   */
  constructor(
    private readonly pool: DeliveryChildPool,
    private readonly mode: Mode,
    private readonly open: (
      endpoint: DeliveryChildEndpoint,
      signal: AbortSignal,
      onEstablished: () => void,
    ) => AsyncIterable<T>,
    private readonly acknowledged?: (frame: T) => boolean,
  ) {
    this.#ready = Array.from({ length: pool.processCount }, () =>
      Promise.withResolvers<undefined>(),
    );
  }

  /**
   * Yields all private frames after every child acknowledges an Admin subscription.
   *
   * @param signal Cancels the public subscriber.
   * @param closed Cancels all streams when the public listener closes.
   * @param created Supplies the single public Admin acknowledgement.
   * @returns The merged private updates or work notices.
   */
  async *observe(signal: AbortSignal, closed: AbortSignal, created?: T): AsyncIterable<T> {
    const onAbort = () => {
      this.#stop(signal, closed, onAbort);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    closed.addEventListener("abort", onAbort, { once: true });
    this.#detach = this.pool.onChange((slot) => {
      this.#changed(slot);
    });
    try {
      if (signal.aborted || closed.aborted) return;
      this.#started = true;
      for (let slot = 0; slot < this.pool.processCount; slot++) void this.#pump(slot);
      if (this.mode === "admin") {
        await Promise.all(this.#ready.map((ready) => ready.promise));
        this.#assertAdminGenerations();
        if (created !== undefined) yield created;
      }
      for (;;) {
        const next = await this.#next();
        if (next === undefined) return;
        yield next;
      }
    } finally {
      onAbort();
    }
  }

  /**
   * Detaches a canceled public stream even if its reader paused after a frame.
   */
  #stop(signal: AbortSignal, closed: AbortSignal, onAbort: () => void): void {
    if (this.#controller.signal.aborted) return;
    this.#controller.abort();
    signal.removeEventListener("abort", onAbort);
    closed.removeEventListener("abort", onAbort);
    this.#detach?.();
    this.#detach = undefined;
    for (const controller of this.#slotControllers.values()) controller.abort();
    for (const pending of this.#pending.values()) pending.consumed();
    this.#pending.clear();
    this.#lifecycle.resolve(undefined);
    for (const wake of this.#lifecycleWaiters) wake();
    if (this.mode === "admin" && this.#started)
      for (const ready of this.#ready)
        ready.reject(new ConnectError("Admin subscription ended.", Code.Canceled));
    this.#notify();
  }

  /**
   * Moves one slot through ready, stream, and recovery states.
   */
  async #pump(slot: number): Promise<void> {
    let delay = 0;
    while (!this.#controller.signal.aborted) {
      const endpoint = await this.#endpoint(slot);
      if (endpoint === undefined) {
        if (this.mode === "admin") return;
        continue;
      }
      const started = Time.monotonicTime();
      if (this.mode === "admin") this.#selected.set(slot, endpoint);
      const establishment = { reached: false };
      const controller = this.#controllerFor(slot);
      try {
        await this.#readSlot(slot, endpoint, controller.signal, () => {
          establishment.reached = true;
        });
        if (this.mode === "admin")
          throw new ConnectError("Admin child stream ended.", Code.Unavailable);
      } catch (error) {
        if (this.mode === "admin") {
          this.#fail(slot, error);
          return;
        }
      } finally {
        this.#slotControllers.delete(slot);
        controller.abort();
      }
      delay = await this.#recover(endpoint, delay, started, establishment.reached);
    }
  }

  /**
   * Reconnects a live child after a paced transient error, or immediately after replacement.
   */
  async #recover(
    endpoint: DeliveryChildEndpoint,
    prior: number,
    started: number,
    established: boolean,
  ): Promise<number> {
    if (!this.pool.current(endpoint)) return 0;
    const observed = established ? 1 : Math.max(1, Math.ceil(Time.monotonicTime() - started));
    const delay =
      established || prior === 0 ? observed : Math.min(prior * 2, Number.MAX_SAFE_INTEGER);
    await this.#pause(delay, this.#version);
    return delay;
  }

  /**
   * Links one private subscription to the currently active fixed slot.
   */
  #controllerFor(slot: number): AbortController {
    const controller = new AbortController();
    this.#slotControllers.set(slot, controller);
    return controller;
  }

  /**
   * Waits for a missing work slot or fails a global Admin stream.
   */
  async #endpoint(slot: number): Promise<DeliveryChildEndpoint | undefined> {
    const observedVersion = this.#version;
    try {
      return this.pool.endpoint(slot);
    } catch (error) {
      if (this.mode === "admin") this.#fail(slot, error);
      else await this.#changedWait(observedVersion);
      return undefined;
    }
  }

  /**
   * Forwards one child stream while fencing its process generation.
   */
  async #readSlot(
    slot: number,
    endpoint: DeliveryChildEndpoint,
    signal: AbortSignal,
    onEstablished: () => void,
  ): Promise<void> {
    let first = true;
    for await (const frame of this.open(endpoint, signal, onEstablished)) {
      onEstablished();
      if (signal.aborted || !this.pool.current(endpoint)) return;
      if (first && this.mode === "admin") {
        if (!this.acknowledged?.(frame))
          throw new ConnectError("Admin child did not acknowledge subscription.", Code.DataLoss);
        this.#ready[slot]?.resolve(undefined);
      } else await this.#offer(slot, frame);
      first = false;
    }
  }

  /**
   * Holds one unread frame until the public subscriber consumes it.
   */
  async #offer(slot: number, frame: T): Promise<void> {
    const consumed = Promise.withResolvers<undefined>();
    this.#pending.set(slot, {
      frame,
      consumed: () => {
        consumed.resolve(undefined);
      },
    });
    this.#notify();
    await consumed.promise;
  }

  /**
   * Consumes any ready slot without waiting for silent or recovering slots.
   */
  async #next(): Promise<T | undefined> {
    for (;;) {
      if (this.#error !== undefined) throw this.#error;
      if (this.#controller.signal.aborted) return undefined;
      const first = this.#pending.entries().next().value;
      if (first !== undefined) {
        const [slot, pending] = first;
        this.#pending.delete(slot);
        pending.consumed();
        return pending.frame;
      }
      await this.#wake.promise;
    }
  }

  /**
   * Stops the old stream when a slot changes generation or disappears.
   */
  #changed(slot: number): void {
    this.#version++;
    this.#lifecycle.resolve(undefined);
    this.#lifecycle = Promise.withResolvers<undefined>();
    for (const wake of this.#lifecycleWaiters) wake();
    this.#slotControllers.get(slot)?.abort();
    const selected = this.#selected.get(slot);
    if (this.mode === "admin" && selected !== undefined && !this.pool.current(selected))
      this.#fail(slot, new ConnectError("Admin child generation changed.", Code.Unavailable));
    const pending = this.#pending.get(slot);
    if (pending !== undefined) {
      this.#pending.delete(slot);
      pending.consumed();
    }
    this.#notify();
  }

  /**
   * Waits for a child lifecycle event without polling a lost slot.
   */
  async #changedWait(version: number): Promise<void> {
    if (version === this.#version) await this.#lifecycle.promise;
  }

  /**
   * Fails a global Admin subscription after any child loss.
   */
  #fail(slot: number, error: unknown): void {
    if (this.#error !== undefined) return;
    const failure =
      error instanceof ConnectError && error.code === Code.DataLoss
        ? error
        : new ConnectError(`Admin child slot ${String(slot)} is unavailable.`, Code.Unavailable);
    this.#error = failure;
    for (const ready of this.#ready) ready.reject(failure);
    this.#notify();
  }

  /**
   * Refuses an initial global ACK after any selected child was replaced.
   */
  #assertAdminGenerations(): void {
    if (this.#error !== undefined) throw this.#error;
    if (
      this.#selected.size !== this.pool.processCount ||
      [...this.#selected.values()].some((endpoint) => !this.pool.current(endpoint))
    )
      throw new ConnectError("Admin child generation changed.", Code.Unavailable);
  }

  /**
   * Wakes the public reader or a slot awaiting a replacement.
   */
  #notify(): void {
    this.#wake.resolve(undefined);
    this.#wake = Promise.withResolvers<undefined>();
  }

  /**
   * Paces transient private stream reconnection using full Node timer intervals.
   */
  async #pause(remaining: number, version: number): Promise<void> {
    while (remaining > 0 && !this.#controller.signal.aborted && version === this.#version) {
      const slice = Math.min(remaining, 2_147_483_647);
      const started = Time.monotonicTime();
      await new Promise<void>((resolve) => {
        const end = () => {
          clearTimeout(timer);
          this.#controller.signal.removeEventListener("abort", end);
          this.#lifecycleWaiters.delete(end);
          resolve();
        };
        const timer = setTimeout(end, slice);
        this.#controller.signal.addEventListener("abort", end, { once: true });
        this.#lifecycleWaiters.add(end);
        if (this.#controller.signal.aborted) end();
      });
      remaining -= Math.max(1, Time.monotonicTime() - started);
    }
  }
}
