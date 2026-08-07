import { Resolver } from "node:dns/promises";

import type { GkeDnsAddress, GkeDnsResolver } from "./gke-node-discovery.js";

interface DnsLookup {
  resolve4(
    name: string,
    options: { readonly ttl: true },
  ): Promise<readonly { readonly address: string; readonly ttl: number }[]>;
  resolve6(
    name: string,
    options: { readonly ttl: true },
  ): Promise<readonly { readonly address: string; readonly ttl: number }[]>;
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
      const [ipv4, ipv6] = await Promise.allSettled([
        resolver.resolve4(serviceName, { ttl: true }),
        resolver.resolve6(serviceName, { ttl: true }),
      ]);
      signal.throwIfAborted();
      const records = [ipv4, ipv6].flatMap((result) => {
        if (result.status === "fulfilled") return result.value;
        if (NodeDnsResolver.empty(result.reason)) return [];
        throw result.reason;
      });
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
