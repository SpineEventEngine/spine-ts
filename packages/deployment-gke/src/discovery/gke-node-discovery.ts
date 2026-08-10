import {
  ApplicationNode,
  type NodeDiscovery,
  type NodeScheduler,
} from "@spine-event-engine/deployment";
import type { ILogLayer } from "loglayer";

import { NodeDnsResolver } from "./node-dns-resolver.js";

/**
 * Represents one DNS address with its optional answer TTL in seconds.
 */
export interface GkeDnsAddress {
  // prettier-ignore

  /**
   *
   * Provides one ready-Pod IPv4 or IPv6 address.
   */
  readonly address: string;

  /**
   *
   * Provides the record lifetime in seconds when DNS includes it.
   */
  readonly ttl?: number;
}

/**
 * Resolves the complete ready-Pod address set for one headless Service.
 */
export interface GkeDnsResolver {
  // prettier-ignore

  /**
   * Resolves the current answer and cooperates with cancellation.
   *
   * @param serviceName Supplies the configured headless-Service DNS name.
   * @param signal Cancels the pending DNS request.
   * @returns The complete address answer or an empty answer for name-not-found.
   */
  resolve(serviceName: string, signal: AbortSignal): Promise<readonly GkeDnsAddress[]>;
}

/**
 * Configures GKE headless-Service discovery for one standalone Gateway.
 */
export interface GkeNodeDiscoveryOptions {
  // prettier-ignore

  /**
   *
   * Identifies the headless-Service DNS name.
   */
  readonly serviceName: string;

  /**
   *
   * Identifies the reachable application TCP port.
   */
  readonly port: number;

  /**
   *
   * Selects the HTTP transport scheme.
   */
  readonly scheme?: "http" | "https";

  /**
   *
   * Sets the maximum interval between DNS lookups in milliseconds.
   */
  readonly refreshIntervalMs?: number;

  /**
   *
   * Supplies the DNS lookup adapter.
   */
  readonly resolver?: GkeDnsResolver;

  /**
   *
   * Schedules future DNS lookups.
   */
  readonly scheduler?: NodeScheduler;

  /**
   *
   * Returns the current time for TTL validity.
   *
   * @returns The current Unix time in milliseconds.
   */
  readonly now?: () => number;

  /**
   * Application-owned logger for this independently running component.
   */
  readonly logger?: ILogLayer;
}

const systemScheduler: NodeScheduler = {
  schedule(delayMs, onTick) {
    const timer = setTimeout(onTick, delayMs);
    timer.unref();
    return () => {
      clearTimeout(timer);
    };
  },
};

const maximumRefreshes = 2;

/**
 * Publishes ready GKE Pods from a headless-Service DNS answer.
 */
export class GkeNodeDiscovery implements NodeDiscovery {
  readonly #serviceName: string;
  readonly #port: number;
  readonly #scheme: "http" | "https";
  readonly #refreshIntervalMs: number;
  readonly #resolver: GkeDnsResolver;
  readonly #scheduler: NodeScheduler;
  readonly #now: () => number;
  #cancel: (() => void) | undefined;
  #expiryCancel: (() => void) | undefined;
  readonly #controllers = new Set<AbortController>();
  #watcher: ((nodes: readonly ApplicationNode[]) => void) | undefined;
  readonly #refreshes = new Set<Promise<void>>();
  #validUntilMs: number | undefined;
  #expired = false;
  #empty = false;
  #closed = false;
  #closing: Promise<void> | undefined;
  #epoch = 0;

  /**
   * Creates discovery with a ten-second refresh interval by default.
   *
   * @param options Supplies the Service name, reachable port, and optional runtime seams.
   */
  constructor(options: GkeNodeDiscoveryOptions) {
    if (!ApplicationNode.tls(options.serviceName)) throw new Error("GKE Service name is invalid.");
    if (!Number.isSafeInteger(options.port) || options.port < 1 || options.port > 65_535)
      throw new RangeError("GKE node port must be a valid TCP port.");
    if (
      options.refreshIntervalMs !== undefined &&
      (!Number.isSafeInteger(options.refreshIntervalMs) || options.refreshIntervalMs < 1)
    )
      throw new RangeError("GKE refresh interval must be a positive safe integer.");
    this.#serviceName = ApplicationNode.tls(options.serviceName);
    this.#port = options.port;
    this.#scheme = options.scheme ?? "http";
    this.#refreshIntervalMs = options.refreshIntervalMs ?? 10_000;
    this.#resolver = options.resolver ?? new NodeDnsResolver();
    this.#scheduler = options.scheduler ?? systemScheduler;
    this.#now = options.now ?? Date.now;
  }

  /**
   * Starts the only complete membership watch.
   *
   * @param onSnapshot Receives every successful or expired membership snapshot.
   * @returns Stops future refreshes and joins the active DNS request.
   */
  watch(onSnapshot: (nodes: readonly ApplicationNode[]) => void): () => Promise<void> {
    if (this.#closed) throw new Error("GKE node discovery is closed.");
    if (this.#watcher !== undefined)
      throw new Error("GKE node discovery supports one active watch.");
    this.#watcher = onSnapshot;
    this.#schedule(0);
    return () => this.close();
  }

  /**
   * Cancels scheduled and in-flight DNS work permanently.
   *
   * @returns Completes after the admitted resolver request settles.
   */
  close(): Promise<void> {
    if (this.#closing !== undefined) return this.#closing;
    this.#closing = this.#close();
    return this.#closing;
  }

  async #close(): Promise<void> {
    this.#closed = true;
    this.#cancel?.();
    this.#expiryCancel?.();
    for (const controller of this.#controllers) controller.abort();
    this.#watcher = undefined;
    await Promise.allSettled([...this.#refreshes]);
  }

  #schedule(delayMs: number): void {
    this.#cancel?.();
    this.#cancel = this.#scheduler.schedule(delayMs, () => {
      this.#cancel = undefined;
      if (this.#expired) this.#schedule(this.#refreshIntervalMs);
      if (this.#controllers.size >= maximumRefreshes) return;
      const refresh = this.#refresh(++this.#epoch);
      this.#refreshes.add(refresh);
      void refresh.catch(() => undefined).finally(() => this.#refreshes.delete(refresh));
    });
  }

  #scheduleExpiry(delayMs: number): void {
    this.#expiryCancel?.();
    this.#expiryCancel = this.#scheduler.schedule(delayMs, () => {
      if (
        !this.#closed &&
        this.#validUntilMs !== undefined &&
        this.#now() >= this.#validUntilMs &&
        !this.#empty
      ) {
        this.#watcher?.([]);
        this.#expired = true;
        this.#empty = true;
        this.#schedule(this.#refreshIntervalMs);
      }
    });
  }

  async #refresh(epoch: number): Promise<void> {
    if (this.#closed) return;
    const controller = new AbortController();
    this.#controllers.add(controller);
    try {
      const answer = await this.#resolver.resolve(this.#serviceName, controller.signal);
      if (controller.signal.aborted || epoch !== this.#epoch) return;
      const nodes = this.#nodes(answer);
      this.#watcher?.(nodes);
      this.#expired = false;
      this.#empty = nodes.length === 0;
      this.#expiryCancel?.();
      this.#expiryCancel = undefined;
      const ttlMs = this.#ttlMs(answer);
      this.#validUntilMs = this.#now() + ttlMs;
      this.#schedule(
        nodes.length === 0 ? this.#refreshIntervalMs : Math.min(this.#refreshIntervalMs, ttlMs),
      );
      if (nodes.length > 0) this.#scheduleExpiry(ttlMs);
    } catch {
      if (controller.signal.aborted || epoch !== this.#epoch) return;
      if (
        this.#validUntilMs !== undefined &&
        this.#now() >= this.#validUntilMs &&
        !this.#expired &&
        !this.#empty
      ) {
        this.#watcher?.([]);
        this.#expired = true;
        this.#empty = true;
      }
      this.#schedule(this.#refreshIntervalMs);
    } finally {
      this.#controllers.delete(controller);
    }
  }

  #ttlMs(answer: readonly GkeDnsAddress[]): number {
    const positive = answer
      .map((entry) => entry.ttl)
      .filter((ttl): ttl is number => ttl !== undefined && Number.isFinite(ttl) && ttl > 0);
    return positive.length === 0 ? this.#refreshIntervalMs : Math.min(...positive) * 1000;
  }

  #nodes(answer: readonly GkeDnsAddress[]): readonly ApplicationNode[] {
    const nodes = new Map<string, ApplicationNode>();
    for (const entry of answer) {
      const host = entry.address.includes(":") ? `[${entry.address}]` : entry.address;
      const endpoint = `${this.#scheme}://${host}:${this.#port.toString()}`;
      const canonical = new ApplicationNode({ id: "gke", endpoint }).endpoint;
      const node = new ApplicationNode({
        id: `gke/${canonical}/${this.#scheme === "https" ? this.#serviceName : ""}`,
        endpoint: canonical,
        ...(this.#scheme === "https" ? { tlsServerName: this.#serviceName } : {}),
      });
      nodes.set(node.id, node);
    }
    return [...nodes.values()];
  }
}

export { NodeDnsResolver, type DnsLookup } from "./node-dns-resolver.js";
