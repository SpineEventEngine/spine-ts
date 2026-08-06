/**
 * A stable application-node identity and canonical reachable endpoint.
 */
export class ApplicationNode {
  /**
   * Identifies this application node independently of its endpoint.
   */
  readonly id: string;

  /**
   * Identifies the canonical HTTP(S) origin without its trailing slash.
   */
  readonly endpoint: string;

  /**
   * Identifies the canonical TLS authority when this node uses HTTPS.
   */
  readonly tlsServerName: string | undefined;

  /**
   * Validates and canonicalizes one discovered application node.
   * @param input Supplies the stable identity, endpoint, and optional TLS authority.
   */
  constructor(input: {
    readonly id: string;
    readonly endpoint: string;
    readonly tlsServerName?: string;
  }) {
    if (!input.id.trim()) throw new Error("Application node ID must be non-empty.");
    let url: URL;
    try {
      url = new URL(input.endpoint);
    } catch {
      throw new Error("Application node endpoint must be an absolute HTTP(S) origin.");
    }
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error("Application node endpoint must be an absolute HTTP(S) origin.");
    if (input.tlsServerName !== undefined && url.protocol !== "https:")
      throw new Error("TLS server names require HTTPS.");
    const authority =
      input.tlsServerName === undefined ? undefined : ApplicationNode.tls(input.tlsServerName);
    this.id = input.id;
    this.endpoint = url.origin;
    this.tlsServerName = authority;
  }

  /**
   * Validates and canonicalizes one DNS TLS authority.
   *
   * @param value Supplies one DNS hostname.
   * @returns The normalized ASCII lowercase hostname.
   */
  static tls(value: string): string {
    const parsed = new URL(`https://${value}`);
    if (
      parsed.hostname !== value.toLowerCase() ||
      parsed.port ||
      value.endsWith(".") ||
      parsed.hostname.includes(":")
    )
      throw new Error("TLS server name must be one DNS hostname.");
    return parsed.hostname.toLowerCase();
  }
}

/**
 * Receives complete application-node snapshots.
 */
export interface NodeDiscovery {
  /**
   * Starts complete snapshot delivery.
   *
   * @param onSnapshot Receives each complete immutable node snapshot.
   * @returns A deterministic operation that stops later delivery.
   */
  watch(
    onSnapshot: (nodes: readonly ApplicationNode[]) => void,
  ): Promise<() => Promise<void>> | (() => Promise<void>);
}

/**
 * Publishes mutable static membership for local and combined deployments.
 */
export class StaticNodeDiscovery implements NodeDiscovery {
  #nodes: readonly ApplicationNode[];
  readonly #watchers = new Set<(nodes: readonly ApplicationNode[]) => void>();

  /**
   * Creates a source with an initial complete static node set.
   *
   * @param nodes Supplies the initial complete static node set.
   */
  constructor(nodes: readonly ApplicationNode[]) {
    this.#nodes = [...nodes];
  }

  /**
   * Publishes a replacement complete node set.
   *
   * @param nodes Supplies replacement membership.
   */
  replace(nodes: readonly ApplicationNode[]): void {
    this.#nodes = [...nodes];
    for (const onSnapshot of this.#watchers) onSnapshot([...this.#nodes]);
  }

  /**
   * Starts delivery of current and subsequent complete snapshots.
   *
   * @param onSnapshot Receives the current and subsequent complete snapshots.
   * @returns An operation that removes this snapshot receiver.
   */
  watch(onSnapshot: (nodes: readonly ApplicationNode[]) => void): () => Promise<void> {
    this.#watchers.add(onSnapshot);
    onSnapshot([...this.#nodes]);
    return async () => {
      this.#watchers.delete(onSnapshot);
    };
  }
}
