/**
 * A stable application-node identity and canonical reachable endpoint.
 */
export class ApplicationNode {
  /** Stable opaque node identity. */
  readonly id: string;

  /** Canonical HTTP(S) origin without its trailing slash. */
  readonly endpoint: string;

  /** Canonical TLS authority, only for HTTPS nodes. */
  readonly tlsServerName: string | undefined;

  /**
   * Validates and canonicalizes one discovered application node.
   * @param input Supplies the stable identity, endpoint, and optional TLS authority.
   */
  constructor(input: { readonly id: string; readonly endpoint: string; readonly tlsServerName?: string }) {
    if (!input.id.trim()) throw new Error("Application node ID must be non-empty.");
    let url: URL;
    try {
      url = new URL(input.endpoint);
    } catch {
      throw new Error("Application node endpoint must be an absolute HTTP(S) origin.");
    }
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/"
    ) throw new Error("Application node endpoint must be an absolute HTTP(S) origin.");
    if (input.tlsServerName !== undefined && url.protocol !== "https:")
      throw new Error("TLS server names require HTTPS.");
    const authority = input.tlsServerName === undefined ? undefined : ApplicationNode.tls(input.tlsServerName);
    this.id = input.id;
    this.endpoint = url.origin;
    this.tlsServerName = authority;
  }

  static tls(value: string): string {
    const parsed = new URL(`https://${value}`);
    if (parsed.hostname !== value.toLowerCase() || parsed.port || value.endsWith(".") || parsed.hostname.includes(":"))
      throw new Error("TLS server name must be one DNS hostname.");
    return parsed.hostname.toLowerCase();
  }
}

/** Receives complete application-node snapshots. */
export interface NodeDiscovery {
  /** Starts snapshot delivery and returns its deterministic close operation. */
  watch(onSnapshot: (nodes: readonly ApplicationNode[]) => void): Promise<() => Promise<void>> | (() => Promise<void>);
}

/** A mutable static source for local and combined deployments. */
export class StaticNodeDiscovery implements NodeDiscovery {
  #nodes: readonly ApplicationNode[];
  readonly #watchers = new Set<(nodes: readonly ApplicationNode[]) => void>();

  /** @param nodes Supplies the initial complete static node set. */
  constructor(nodes: readonly ApplicationNode[]) { this.#nodes = [...nodes]; }

  /** Publishes a new complete node set. @param nodes Supplies replacement membership. */
  replace(nodes: readonly ApplicationNode[]): void {
    this.#nodes = [...nodes];
    for (const onSnapshot of this.#watchers) onSnapshot([...this.#nodes]);
  }

  /** @param onSnapshot Receives the current and subsequent complete snapshots. */
  watch(onSnapshot: (nodes: readonly ApplicationNode[]) => void): () => Promise<void> {
    this.#watchers.add(onSnapshot);
    onSnapshot([...this.#nodes]);
    return async () => { this.#watchers.delete(onSnapshot); };
  }
}
