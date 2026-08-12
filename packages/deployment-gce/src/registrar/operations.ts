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
/**
 * Schedules deterministic registrar renewal work.
 */
export interface GceScheduler {
  // prettier-ignore

  /**
   * Schedules one renewal callback.
   *
   * @param delayMs Supplies a positive delay in milliseconds.
   * @param onTick Receives the callback to run once after the delay.
   * @returns Cancels the scheduled callback.
   */
  schedule(delayMs: number, onTick: () => void): () => void;
}

/**
 * Creates one cancellable deadline for cooperative registrar operations.
 */
export interface GceDeadlineFactory {
  // prettier-ignore

  /**
   * Creates an operation deadline.
   *
   * @param timeoutMs Supplies a positive timeout in milliseconds.
   * @returns An abort signal and an operation that releases the deadline handle.
   */
  create(timeoutMs: number): { readonly signal: AbortSignal; close(): void };
}

/**
 * Supplies production renewal scheduling with unreferenced Node.js timer handles.
 */
export const systemGceScheduler: GceScheduler = {
  // prettier-ignore

  /**
   * Schedules one unreferenced renewal callback.
   *
   * @param delayMs Supplies the renewal delay in milliseconds.
   * @param onTick Receives the callback to run once after the delay.
   * @returns Cancels the scheduled callback.
   */
  schedule: (delayMs, onTick) => {
    const timer = setTimeout(onTick, delayMs);
    timer.unref();
    return () => {
      clearTimeout(timer);
    };
  },
};

/**
 * Supplies production deadlines with unreferenced Node.js timer handles.
 */
export const systemGceDeadlines: GceDeadlineFactory = {
  // prettier-ignore

  /**
   * Creates one unreferenced operation deadline.
   *
   * @param timeoutMs Supplies the deadline duration in milliseconds.
   * @returns The signal and its deadline-handle closer.
   */
  create(timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    timer.unref();
    return {
      signal: controller.signal,
      close: () => {
        clearTimeout(timer);
      },
    };
  },
};

/**
 * Runs registrar work under its deadline and optional shutdown signal.
 */
export class GceOperationRunner {
  // prettier-ignore

  /**
   * Creates an operation owner for one registrar lifecycle.
   *
   * @param deadlines Supplies the deadline factory.
   * @param timeoutMs Supplies the operation timeout.
   * @param shutdown Supplies the registrar shutdown signal.
   */
  constructor(
    private readonly deadlines: GceDeadlineFactory,
    private readonly timeoutMs: number,
    private readonly shutdown: AbortSignal,
  ) {}

  /**
   * Executes one registrar mutation and always releases its deadline handle.
   *
   * @param operation Receives the composed cancellation signal.
   * @param includeShutdown Selects whether registrar shutdown cancels this operation.
   * @returns The operation result.
   */
  async run<Result>(
    operation: (signal: AbortSignal) => Promise<Result>,
    includeShutdown = true,
  ): Promise<Result> {
    const deadline = this.deadlines.create(this.timeoutMs);
    try {
      return await operation(
        includeShutdown ? AbortSignal.any([this.shutdown, deadline.signal]) : deadline.signal,
      );
    } finally {
      deadline.close();
    }
  }
}
