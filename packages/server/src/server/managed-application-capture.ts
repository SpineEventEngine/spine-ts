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

import { AsyncLocalStorage } from "node:async_hooks";
import type { Application, ApplicationBuilder } from "./application.js";
import type { RunningServer } from "./server.js";

/**
 * Application or incomplete builder retained through a managed child callback.
 */
export type ManagedApplicationResource = Application | ApplicationBuilder;

const captures = new AsyncLocalStorage<{
  readonly applications: Set<ManagedApplicationResource>;
  readonly endpoints: Set<RunningServer>;
}>();

/**
 * Retains Applications selected during a managed child callback, including failed starts.
 *
 * @internal
 */
export const managedApplicationCapture: Readonly<{
  /**
   * Runs a child factory with an isolated capture.
   *
   * @typeParam T Callback result.
   * @param applications Receives Applications selected by Server builders.
   * @param work Managed child factory.
   * @returns The factory result.
   */
  run<T>(
    applications: Set<ManagedApplicationResource>,
    endpoints: Set<RunningServer>,
    work: () => Promise<T>,
  ): Promise<T>;

  /**
   * Records a builder before asynchronous Application assembly starts.
   */
  recordBuilder(builder: ApplicationBuilder): void;

  /**
   * Replaces a completed builder with its resulting Application.
   */
  recordBuilt(builder: ApplicationBuilder, application: Application): void;

  /**
   * Records the Application selected by a Server builder.
   */
  record(application: Application): void;

  /**
   * Records a started child endpoint before its factory callback returns.
   */
  recordEndpoint(endpoint: RunningServer): void;

  /**
   * Replaces a native endpoint with its managed wrapper.
   */
  replaceEndpoint(native: RunningServer | undefined, wrapped: RunningServer): void;
}> = Object.freeze({
  /**
   * Runs one managed child factory with an isolated Application capture.
   *
   * @typeParam T Callback result.
   * @param applications Receives Applications selected by Server builders.
   * @param work Managed child factory.
   * @returns The factory result.
   */
  run<T>(
    applications: Set<ManagedApplicationResource>,
    endpoints: Set<RunningServer>,
    work: () => Promise<T>,
  ): Promise<T> {
    return captures.run({ applications, endpoints }, work);
  },

  /**
   * Records a builder before asynchronous Application assembly starts.
   *
   * @param builder Application builder entering build.
   */
  recordBuilder(builder: ApplicationBuilder): void {
    captures.getStore()?.applications.add(builder);
  },

  /**
   * Replaces a completed builder with its resulting Application.
   *
   * @param builder Completed Application builder.
   * @param application Built Application.
   */
  recordBuilt(builder: ApplicationBuilder, application: Application): void {
    const capture = captures.getStore();
    if (capture === undefined) return;
    capture.applications.delete(builder);
    capture.applications.add(application);
  },

  /**
   * Records an Application selected by a Server in the current child callback.
   *
   * @param application Selected Application.
   */
  record(application: Application): void {
    captures.getStore()?.applications.add(application);
  },

  /**
   * Records a listening endpoint while its child factory callback is active.
   *
   * @param endpoint Started endpoint to close before its Application.
   */
  recordEndpoint(endpoint: RunningServer): void {
    captures.getStore()?.endpoints.add(endpoint);
  },

  /**
   * Records the endpoint wrapper that performs complete listener cleanup.
   *
   * @param native Native endpoint already captured, when present.
   * @param wrapped Wrapper returned to the child factory.
   */
  replaceEndpoint(native: RunningServer | undefined, wrapped: RunningServer): void {
    const endpoints = captures.getStore()?.endpoints;
    if (endpoints === undefined) return;
    if (native !== undefined) endpoints.delete(native);
    endpoints.add(wrapped);
  },
});
