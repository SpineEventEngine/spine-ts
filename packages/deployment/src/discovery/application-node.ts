import { isIP } from "node:net";

/**
 * A stable application-node identity and canonical reachable endpoint.
 */
export class ApplicationNode {
  // prettier-ignore

  /**
   * Identifies the application node across discovery refreshes.
   */
  readonly id: string;

  /**
   * Provides the canonical HTTP or HTTPS origin used to reach the node.
   */
  readonly endpoint: string;

  /**
   * Provides the optional DNS authority expected during TLS verification.
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
    this.id = input.id;
    this.endpoint = url.origin;
    this.tlsServerName =
      input.tlsServerName === undefined ? undefined : ApplicationNode.tls(input.tlsServerName);
  }

  /**
   * Validates and canonicalizes one DNS TLS authority.
   *
   * @param value The DNS hostname expected during TLS verification.
   * @returns The canonical lowercase hostname.
   */
  static tls(value: string): string {
    const parsed = new URL(`https://${value}`);
    if (
      parsed.username ||
      parsed.password ||
      parsed.port ||
      value.endsWith(".") ||
      /[@:/?#]/.test(value) ||
      isIP(parsed.hostname) !== 0
    )
      throw new Error("TLS server name must be one DNS hostname.");
    if (
      parsed.hostname.split(".").some((label) => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))
    )
      throw new Error("TLS server name must use DNS labels.");
    return parsed.hostname.toLowerCase();
  }
}
