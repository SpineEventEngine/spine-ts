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

import { randomUUID } from "node:crypto";
import { fork, type ChildProcess, type ForkOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Code, ConnectError } from "@connectrpc/connect";
import { Time } from "@spine-event-engine/core/time";

import type { DeliveryConfiguration } from "./config.js";
import type { PrivateDeliveryChildOptions } from "./private-delivery-child.js";

/**
 * Identifies one ready private child process and its authenticated endpoint.
 */
export interface DeliveryChildEndpoint {
  /**
   * Identifies the fixed route slot.
   */
  readonly slot: number;

  /**
   * Distinguishes this process from replacements.
   */
  readonly generation: string;

  /**
   * Authenticates parent calls on this private child listener.
   */
  readonly credential: string;

  /**
   * Identifies the private loopback gRPC listener.
   */
  readonly baseUrl: string;

  /**
   * Identifies the live Node child process.
   */
  readonly pid: number;
}

/**
 * Keeps the live fork and private credential for one route slot.
 */
interface SlotProcess {
  /**
   * Routes requests with shard number modulo the fixed process count.
   */
  readonly slot: number;

  /**
   * Rejects replies from a prior fork in this slot.
   */
  readonly generation: string;

  /**
   * Authenticates parent calls to this child's private data listener.
   */
  readonly credential: string;

  /**
   * Provides the IPC lifecycle channel and process exit events.
   */
  readonly process: ChildProcess;

  /**
   * Measures a failed startup attempt without using wall time.
   */
  readonly started: number;

  /**
   * Records whether this fork reached a usable private listener.
   */
  ready: boolean;

  /**
   * Identifies the authenticated loopback listener after readiness.
   */
  baseUrl: string | undefined;
}

/**
 * Starts a child with the same arguments as the production Node fork.
 */
type ChildFork = (entry: string, args: readonly string[], options: ForkOptions) => ChildProcess;

/**
 * Keeps a fixed set of volatile child slots alive.
 */
export class DeliveryChildPool {
  readonly #slots = new Map<number, SlotProcess>();

  readonly #children = new Set<ChildProcess>();

  readonly #restartTimers = new Map<number, ReturnType<typeof setTimeout>>();

  readonly #retryDelay = new Map<number, number>();

  readonly #changes = new Set<(slot: number) => void>();

  #start: Promise<void> | undefined;

  #close: Promise<void> | undefined;

  /**
   * Creates a fixed number of child slots without binding or forking.
   *
   * @param processCount Selects the explicit positive child count.
   * @param configuration Supplies each child's local retained-state and session settings.
   * @param forkChild Starts child processes through Node's fork operation.
   */
  constructor(
    readonly processCount: number,
    readonly configuration: DeliveryConfiguration,
    private readonly forkChild: ChildFork = fork,
  ) {
    if (!Number.isSafeInteger(processCount) || processCount < 1)
      throw new RangeError("Delivery child process count is invalid.");
  }

  /**
   * Starts one child in every fixed slot.
   *
   * @returns Completion after each initial child starts or reports failure.
   */
  start(): Promise<void> {
    if (this.#close !== undefined)
      return Promise.reject(new Error("Delivery child pool is closed."));
    this.#start ??= this.#startOnce();
    return this.#start;
  }

  /**
   * Reads a ready child endpoint without waiting for a recovering slot.
   *
   * @param slot Identifies the fixed route slot.
   * @returns The live child endpoint and process generation.
   */
  endpoint(slot: number): DeliveryChildEndpoint {
    const current = this.#slots.get(slot);
    if (current?.baseUrl === undefined || current.process.pid === undefined)
      throw new ConnectError("Delivery child slot is unavailable.", Code.Unavailable);
    return {
      slot,
      generation: current.generation,
      credential: current.credential,
      baseUrl: current.baseUrl,
      pid: current.process.pid,
    };
  }

  /**
   * Checks that an asynchronous response still came from the live generation.
   *
   * @param endpoint Identifies the child that started the request.
   * @returns Whether the same process remains ready.
   */
  current(endpoint: DeliveryChildEndpoint): boolean {
    const slot = this.#slots.get(endpoint.slot);
    return slot?.generation === endpoint.generation && slot.baseUrl !== undefined;
  }

  /**
   * Registers child readiness, replacement, and terminal closure notifications.
   *
   * @param onChange Receives the changed fixed slot.
   * @returns A function that detaches the listener.
   */
  onChange(onChange: (slot: number) => void): () => void {
    this.#changes.add(onChange);
    return () => {
      this.#changes.delete(onChange);
    };
  }

  /**
   * Stops restarts and asks every child to close.
   *
   * @returns Completion after all children exit.
   */
  close(): Promise<void> {
    this.#close ??= this.#closeOnce();
    return this.#close;
  }

  /**
   * Launches every child slot.
   */
  async #startOnce(): Promise<void> {
    await Promise.all(Array.from({ length: this.processCount }, (_, slot) => this.#spawn(slot)));
  }

  /**
   * Launches one new generation and retries a failed fork in the same slot.
   *
   * @param slot Identifies the fixed route slot.
   */
  async #spawn(slot: number): Promise<void> {
    if (this.#close !== undefined) return;
    const current = this.#fork(slot);
    if (current === undefined) return;
    this.#slots.set(slot, current);
    await this.#awaitReady(current, {
      credential: current.credential,
      configuration: this.configuration,
    });
  }

  /**
   * Creates one private credential and a Node fork for a slot.
   *
   * @param slot Identifies the fixed route slot.
   * @returns The launched process, or undefined after a failed fork.
   */
  #fork(slot: number): SlotProcess | undefined {
    const generation = randomUUID();
    const credential = `Bearer ${randomUUID()}`;
    let child: ChildProcess;
    try {
      child = this.forkChild(DeliveryChildPool.#entry(), [], {
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        execArgv: DeliveryChildPool.#childExecArgv(process.execArgv),
      });
    } catch {
      this.#scheduleFailedStart(slot, 1);
      return undefined;
    }
    this.#children.add(child);
    child.once("exit", () => {
      this.#children.delete(child);
    });
    return {
      slot,
      generation,
      credential,
      process: child,
      started: Time.monotonicTime(),
      ready: false,
      baseUrl: undefined,
    };
  }

  /**
   * Removes flags that describe the parent's stdin or evaluation entry point.
   *
   * @param args Supplies the parent Node execution flags.
   * @returns Compatible flags, including instrumentation, for a file-backed child.
   */
  static #childExecArgv(args: readonly string[]): string[] {
    const compatible: string[] = [];
    for (let index = 0; index < args.length; index++) {
      const arg = args[index];
      if (arg === undefined) continue;
      if (["--input-type", "--eval", "--print", "-e", "-p"].includes(arg)) {
        index++;
        continue;
      }
      if (
        arg.startsWith("--input-type=") ||
        arg.startsWith("--eval=") ||
        arg.startsWith("--print=") ||
        /^-[ep].+/.test(arg) ||
        ["--check", "-c", "--interactive", "-i", "--test"].includes(arg)
      )
        continue;
      compatible.push(arg);
    }
    return compatible;
  }

  /**
   * Waits for one fork's ready, failed, or exit lifecycle event.
   */
  #awaitReady(current: SlotProcess, options: PrivateDeliveryChildOptions): Promise<void> {
    const child = current.process;
    return new Promise<void>((resolve) => {
      const message = (value: { kind?: string; baseUrl?: string }) => {
        if (value.kind === "ready" && typeof value.baseUrl === "string") {
          current.baseUrl = value.baseUrl;
          current.ready = true;
          for (const listener of this.#changes) listener(current.slot);
          child.off("message", message);
          this.#retryDelay.delete(current.slot);
          resolve();
        } else if (value.kind === "failed") {
          child.off("message", message);
          this.#retire(current);
          resolve();
        }
      };
      child.on("message", message);
      child.once("exit", () => {
        child.off("message", message);
        this.#retire(current);
        resolve();
      });
      child.once("error", () => {
        child.off("message", message);
        this.#retire(current);
        resolve();
      });
      this.#sendStart(current, options, resolve);
    });
  }

  /**
   * Retires a fork when its IPC startup message cannot be delivered.
   */
  #sendStart(
    current: SlotProcess,
    options: PrivateDeliveryChildOptions,
    onFailure: () => void,
  ): void {
    try {
      current.process.send({ kind: "start", options }, (error) => {
        if (error !== null) {
          this.#retire(current);
          onFailure();
        }
      });
    } catch {
      this.#retire(current);
      onFailure();
    }
  }

  /**
   * Invalidates a departed generation.
   *
   * @param current Identifies the process whose exit was observed.
   */
  #retire(current: SlotProcess): void {
    if (this.#slots.get(current.slot) !== current) return;
    this.#slots.delete(current.slot);
    if (current.process.pid === undefined) this.#children.delete(current.process);
    for (const listener of this.#changes) listener(current.slot);
    if (this.#close !== undefined) return;
    if (current.ready) {
      this.#retryDelay.delete(current.slot);
      this.#scheduleRestart(current.slot, 0);
    } else {
      this.#scheduleFailedStart(
        current.slot,
        Math.max(1, Math.ceil(Time.monotonicTime() - current.started)),
      );
    }
  }

  /**
   * Paces repeated startup failures using their observed duration.
   *
   * @param slot Identifies the failed fixed slot.
   * @param observed Measures this failed attempt in milliseconds.
   */
  #scheduleFailedStart(slot: number, observed: number): void {
    const previous = this.#retryDelay.get(slot) ?? 0;
    const delay = previous === 0 ? observed : Math.min(previous * 2, Number.MAX_SAFE_INTEGER);
    this.#retryDelay.set(slot, delay);
    this.#scheduleRestart(slot, delay);
  }

  /**
   * Waits for the full adaptive restart delay using representable Node timers.
   */
  #scheduleRestart(slot: number, remaining: number): void {
    if (this.#close !== undefined) return;
    const slice = Math.min(remaining, 2_147_483_647);
    const timer = setTimeout(() => {
      this.#restartTimers.delete(slot);
      if (remaining > slice) this.#scheduleRestart(slot, remaining - slice);
      else void this.#spawn(slot);
    }, slice);
    this.#restartTimers.set(slot, timer);
  }

  /**
   * Stops replacement and waits for every reached child to close.
   */
  async #closeOnce(): Promise<void> {
    for (let slot = 0; slot < this.processCount; slot++)
      for (const listener of this.#changes) listener(slot);
    for (const timer of this.#restartTimers.values()) clearTimeout(timer);
    this.#restartTimers.clear();
    await Promise.all([...this.#children].map((child) => this.#stopChild(child)));
    await this.#start?.catch(() => undefined);
  }

  /**
   * Waits for each reached fork, including a retired child that reported startup failure.
   */
  #stopChild(child: ChildProcess): Promise<void> {
    return new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) {
        resolve();
        return;
      }
      child.once("exit", () => {
        resolve();
      });
      const ready = [...this.#slots.values()].some((slot) => slot.process === child);
      if (!ready || !child.connected) child.kill("SIGTERM");
      else
        child.send({ kind: "close" }, (error) => {
          if (error !== null) child.kill("SIGTERM");
        });
    });
  }

  /**
   * Finds the compiled child entry for source and built-package test runs.
   *
   * @returns The Node child entry path.
   */
  static #entry(): string {
    const adjacent = fileURLToPath(new URL("./private-delivery-child-process.js", import.meta.url));
    if (existsSync(adjacent)) return adjacent;
    return fileURLToPath(
      new URL("../../dist/server/private-delivery-child-process.js", import.meta.url),
    );
  }
}
