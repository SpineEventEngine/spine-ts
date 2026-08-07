import { Resolver } from "node:dns/promises";

import type { GkeDnsAddress, GkeDnsResolver } from "./gke-node-discovery.js";

/**
 * Resolves IPv4 and IPv6 headless-Service records through Node DNS.
 */
export class NodeDnsResolver implements GkeDnsResolver {
  /**
   * Resolves both address families and exposes DNS TTLs when Node supplies them.
   *
   * @param serviceName Supplies the headless-Service DNS name.
   * @param signal Cancels the resolver request.
   * @returns All successful A and AAAA records, or an empty name-not-found answer.
   */
  async resolve(serviceName: string, signal: AbortSignal): Promise<readonly GkeDnsAddress[]> {
    const resolver = new Resolver();
    const cancel = () => {
      resolver.cancel();
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const [ipv4, ipv6] = await Promise.allSettled([
        resolver.resolve4(serviceName, { ttl: true }),
        resolver.resolve6(serviceName, { ttl: true }),
      ]);
      if (signal.aborted) throw new DOMException("DNS resolution was cancelled.", "AbortError");
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
