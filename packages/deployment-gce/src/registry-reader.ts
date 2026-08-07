import {
  type ApplicationNode,
  type LeasedNodeRegistry,
  type NodeSnapshotReader,
} from "@spine-event-engine/deployment";

/** Reads complete live-node snapshots from the leased registry. */
export class GceRegistryReader implements NodeSnapshotReader {
  constructor(
    private readonly registry: LeasedNodeRegistry,
    private readonly now: () => number = Date.now,
  ) {}

  /** Reads every currently live node. */
  read(signal: AbortSignal): Promise<readonly ApplicationNode[]> {
    return this.registry.read(this.now(), signal);
  }
}
