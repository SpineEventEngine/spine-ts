import {
  ScheduledNodeDiscovery,
  type ApplicationNode,
  type LeasedNodeRegistry,
  type NodeDiscovery,
  type NodeScheduler,
} from "@spine-event-engine/deployment";

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
   * Supplies the clock used to evaluate registry lease expiry.
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
}
