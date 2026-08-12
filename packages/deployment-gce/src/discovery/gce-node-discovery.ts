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

import {
  ScheduledNodeDiscovery,
  type ApplicationNode,
  type LeasedNodeRegistry,
  type NodeDiscovery,
  type NodeScheduler,
} from "@spine-event-engine/deployment";
import type { ILogLayer } from "loglayer";

import { GceRegistryReader } from "../registry/gce-registry-reader.js";

/**
 * Publishes GCE registry membership and closes its owned registry on stop.
 */
export class GceNodeDiscovery implements NodeDiscovery {
  readonly #registry: LeasedNodeRegistry;
  readonly #discovery: ScheduledNodeDiscovery;
  #closing: Promise<void> | undefined;

  /**
   * Creates a registry-backed GCE discovery owner.
   *
   * @param options Supplies the registry this owner closes and optional deterministic refresh seams.
   */
  constructor(options: GceNodeDiscoveryOptions) {
    this.#registry = options.registry;
    this.#discovery = new ScheduledNodeDiscovery({
      reader: new GceRegistryReader(options.registry, options.now),
      ...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }),
      ...(options.intervalMs === undefined ? {} : { intervalMs: options.intervalMs }),
    });
  }

  /**
   * Starts complete registry snapshot delivery.
   *
   * @param onSnapshot Receives each complete live-node snapshot.
   * @returns Stops discovery and closes the owned registry.
   */
  watch(onSnapshot: (nodes: readonly ApplicationNode[]) => void): () => Promise<void> {
    this.#discovery.watch(onSnapshot);
    return () => this.close();
  }

  /**
   * Stops discovery before closing the owned registry.
   *
   * @returns Completes after both owned resources settle.
   */
  close(): Promise<void> {
    this.#closing ??= this.#close();
    return this.#closing;
  }

  async #close(): Promise<void> {
    let discoveryError: unknown;
    try {
      await this.#discovery.close();
    } catch (error: unknown) {
      discoveryError = error;
    }
    try {
      await this.#registry.close();
    } catch (registryError: unknown) {
      if (discoveryError !== undefined)
        throw new AggregateError(
          [this.#error(discoveryError), this.#error(registryError)],
          "GCE discovery and registry close both failed.",
        );
      throw this.#error(registryError);
    }
    if (discoveryError !== undefined) throw this.#error(discoveryError);
  }

  #error(value: unknown): Error {
    return value instanceof Error ? value : new Error(String(value));
  }
}

/**
 * Configures one GCE registry-backed discovery owner.
 */
export interface GceNodeDiscoveryOptions {
  // prettier-ignore

  /**
   * Supplies the owned leased registry.
   */
  readonly registry: LeasedNodeRegistry;

  /**
   * Returns the clock time used to evaluate registry lease expiry.
   *
   * @returns The current Unix time in milliseconds.
   */
  readonly now?: () => number;

  /**
   * Supplies the refresh scheduler for deterministic tests.
   */
  readonly scheduler?: NodeScheduler;

  /**
   * Supplies the refresh interval in milliseconds.
   */
  readonly intervalMs?: number;

  /**
   * Application-owned logger reserved for component-local records. The component
   * does not retain or close the supplied logger.
   */
  readonly logger?: ILogLayer;
}
