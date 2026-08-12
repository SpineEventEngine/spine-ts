/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */
/**
 * Supplies the trusted GCE metadata used to derive one stable application node.
 */
export interface GceMetadata {
  // prettier-ignore

  /**
   * Identifies the Google Cloud project containing the instance.
   */
  readonly projectId: string;

  /**
   * Identifies the GCE zone containing the instance.
   */
  readonly zone: string;

  /**
   * Identifies the numeric GCE instance.
   */
  readonly instanceId: string;

  /**
   * Supplies the instance's private IPv4 or IPv6 address.
   */
  readonly privateAddress: string;
}

/**
 * Retrieves trusted instance metadata from the GCE metadata service.
 */
export interface GceMetadataProvider {
  // prettier-ignore

  /**
   * Reads the identity and private address of the current instance.
   *
   * @param signal Cancels the metadata request during registrar shutdown.
   * @returns The validated metadata values.
   */
  read(signal: AbortSignal): Promise<GceMetadata>;
}

/**
 * Reads GCE metadata using the required metadata-service request header.
 */
export class GceMetadataService implements GceMetadataProvider {
  // prettier-ignore

  /**
   * Reads and validates the instance identity and private address.
   *
   * @param signal Cancels all four metadata-service reads.
   * @returns The normalized GCE metadata.
   * @throws Error When a response is unsuccessful or contains invalid identity data.
   */
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
