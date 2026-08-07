/**
 * Supplies the trusted GCE metadata used to derive one stable application node.
 */
export interface GceMetadata {
  readonly projectId: string;
  readonly zone: string;
  readonly instanceId: string;
  readonly privateAddress: string;
}

/** Retrieves trusted instance metadata from the GCE metadata service. */
export interface GceMetadataProvider {
  /** Reads the identity and private address of the current instance. */
  read(signal: AbortSignal): Promise<GceMetadata>;
}

/** Reads GCE metadata using the required metadata-service request header. */
export class GceMetadataService implements GceMetadataProvider {
  /** Reads and validates the instance identity and private address. */
  async read(signal: AbortSignal): Promise<GceMetadata> {
    const root = "http://metadata.google.internal/computeMetadata/v1";
    const requests = new AbortController();
    const requestSignal = AbortSignal.any([signal, requests.signal]);
    const get = async (path: string) => {
      const response = await fetch(`${root}/${path}`, {
        signal: requestSignal,
        headers: { "Metadata-Flavor": "Google" },
      });
      if (!response.ok) throw new Error("GCE metadata request failed.");
      return response.text();
    };
    const [projectId, zonePath, instanceId, privateAddress] = await Promise.all([
      get("project/project-id"),
      get("instance/zone"),
      get("instance/id"),
      get("instance/network-interfaces/0/ip"),
    ]).catch((error: unknown) => {
      requests.abort();
      throw error;
    });
    const normalizedProjectId = projectId.trim();
    const zone = (zonePath.split("/").at(-1) ?? "").trim();
    const normalizedInstanceId = instanceId.trim();
    const normalizedPrivateAddress = privateAddress.trim();
    if (
      !normalizedProjectId ||
      !zone ||
      !/^\d+$/.test(normalizedInstanceId) ||
      !normalizedPrivateAddress
    )
      throw new Error("GCE metadata response is invalid.");
    return {
      projectId: normalizedProjectId,
      zone,
      instanceId: normalizedInstanceId,
      privateAddress: normalizedPrivateAddress,
    };
  }
}
