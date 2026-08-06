import { ApplicationNode } from "@spine-event-engine/deployment";

/** Supplies trusted GCE instance metadata. */
export interface GceMetadata {
  readonly projectId: string;
  readonly zone: string;
  readonly instanceId: string;
  readonly privateAddress: string;
}

/** Builds one canonical application node from trusted GCE metadata. */
export class GceApplicationNode {
  /** Creates a stable GCE node using the private HTTP address by default. */
  static create(metadata: GceMetadata, options: { readonly port: number; readonly endpoint?: string; readonly tlsServerName?: string }): ApplicationNode {
    const endpoint = options.endpoint ?? `http://${GceApplicationNode.host(metadata.privateAddress)}:${String(options.port)}`;
    return new ApplicationNode({ id: `gce/${metadata.projectId}/${metadata.zone}/${metadata.instanceId}`, endpoint, ...(options.tlsServerName === undefined ? {} : { tlsServerName: options.tlsServerName }) });
  }

  private static host(address: string): string {
    return address.includes(":") ? `[${address}]` : address;
  }
}
