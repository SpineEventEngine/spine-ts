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
import { Resolver } from "node:dns/promises";

import type { GkeDnsAddress, GkeDnsResolver } from "./gke-node-discovery.js";

/**
 * Supplies cancellable TTL-aware Node DNS address-family lookups.
 */
export interface DnsLookup {
  // prettier-ignore

  /**
   * Resolves TTL-aware IPv4 records.
   *
   * @param name Supplies the DNS name.
   * @param options Requests TTL metadata.
   * @returns The current IPv4 records.
   */
  resolve4(
    name: string,
    options: { readonly ttl: true },
  ): Promise<readonly { readonly address: string; readonly ttl: number }[]>;

  /**
   * Resolves TTL-aware IPv6 records.
   *
   * @param name Supplies the DNS name.
   * @param options Requests TTL metadata.
   * @returns The current IPv6 records.
   */
  resolve6(
    name: string,
    options: { readonly ttl: true },
  ): Promise<readonly { readonly address: string; readonly ttl: number }[]>;

  /**
   * Cancels every active lookup.
   */
  cancel(): void;
}

/**
 * Resolves IPv4 and IPv6 headless-Service records through Node DNS.
 */
export class NodeDnsResolver implements GkeDnsResolver {
  readonly #create: () => DnsLookup;

  /**
   * Creates the Node DNS adapter.
   *
   * @param create Supplies a resolver factory for deterministic integration tests.
   */
  constructor(create: () => DnsLookup = () => new Resolver()) {
    this.#create = create;
  }

  /**
   * Resolves both address families and exposes DNS TTLs when Node supplies them.
   *
   * @param serviceName Supplies the headless-Service DNS name.
   * @param signal Cancels the resolver request.
   * @returns All successful A and AAAA records, or an empty name-not-found answer.
   */
  async resolve(serviceName: string, signal: AbortSignal): Promise<readonly GkeDnsAddress[]> {
    const resolver = this.#create();
    if (signal.aborted) {
      resolver.cancel();
      signal.throwIfAborted();
    }
    const cancel = () => {
      resolver.cancel();
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const lookup = async (
        request: Promise<readonly { readonly address: string; readonly ttl: number }[]>,
      ) => {
        try {
          return await request;
        } catch (error) {
          if (!NodeDnsResolver.empty(error)) resolver.cancel();
          if (NodeDnsResolver.empty(error)) return [];
          throw error;
        }
      };
      const [ipv4, ipv6] = await Promise.all([
        lookup(resolver.resolve4(serviceName, { ttl: true })),
        lookup(resolver.resolve6(serviceName, { ttl: true })),
      ]);
      signal.throwIfAborted();
      const records = [...ipv4, ...ipv6];
      return records.map((record) => ({ address: record.address, ttl: record.ttl }));
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }

  private static empty(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      ((error as { readonly code?: unknown }).code === "ENOTFOUND" ||
        (error as { readonly code?: unknown }).code === "ENODATA")
    );
  }
}
