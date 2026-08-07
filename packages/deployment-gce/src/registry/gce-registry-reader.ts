import {
  type ApplicationNode,
  type LeasedNodeRegistry,
  type NodeSnapshotReader,
} from "@spine-event-engine/deployment";

/**
 * Reads complete live-node snapshots from the leased registry.
 */
export class GceRegistryReader implements NodeSnapshotReader {
  // prettier-ignore

  /**
   * Creates a reader using an injected clock for deterministic expiry evaluation.
   *
   * @param registry Supplies the leased registry to read.
   * @param now Supplies the current epoch time used for exact expiry filtering; defaults to `Date.now`.
   */
  constructor(
    private readonly registry: LeasedNodeRegistry,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Reads every currently live node.
   *
   * @param signal Cancels the registry read during discovery close.
   * @returns The complete live application-node snapshot.
   */
  read(signal: AbortSignal): Promise<readonly ApplicationNode[]> {
    return this.registry.read(this.now(), signal);
  }
}
