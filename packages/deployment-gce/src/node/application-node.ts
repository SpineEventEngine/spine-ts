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
import { ApplicationNode } from "@spine-event-engine/deployment";

import type { GceMetadata } from "../metadata/gce-metadata-service.js";

/**
 * Configures the reachable application endpoint derived from GCE metadata.
 */
export interface GceApplicationNodeOptions {
  // prettier-ignore

  /**
   * Supplies the reachable gRPC TCP port.
   */
  readonly port: number;

  /**
   * Overrides the default private HTTP origin for private DNS or a proxy.
   */
  readonly endpoint?: string;

  /**
   * Supplies the TLS authority required by an HTTPS endpoint.
   */
  readonly tlsServerName?: string;
}

/**
 * Builds one canonical application node from trusted GCE metadata.
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class GceApplicationNode {
  // prettier-ignore

  /**
   * Creates a stable GCE node using the private HTTP address by default.
   *
   * @param metadata Supplies trusted project, zone, numeric instance ID, and private address.
   * @param options Supplies the port and optional canonical endpoint/TLS override.
   * @returns A canonical application node whose ID is `gce/<project>/<zone>/<instance>`.
   * @throws Error When metadata identity or endpoint/TLS values are invalid.
   */
  static create(metadata: GceMetadata, options: GceApplicationNodeOptions): ApplicationNode {
    if (!metadata.projectId.trim() || !metadata.zone.trim() || !/^\d+$/.test(metadata.instanceId))
      throw new Error("GCE metadata identity is invalid.");
    if (!Number.isSafeInteger(options.port) || options.port < 1 || options.port > 65_535)
      throw new RangeError("GCE node port must be a valid TCP port.");
    const endpoint =
      options.endpoint ??
      `http://${GceApplicationNode.host(metadata.privateAddress)}:${String(options.port)}`;
    return new ApplicationNode({
      id: `gce/${metadata.projectId}/${metadata.zone}/${metadata.instanceId}`,
      endpoint,
      ...(options.tlsServerName === undefined ? {} : { tlsServerName: options.tlsServerName }),
    });
  }

  private static host(address: string): string {
    return address.includes(":") ? `[${address}]` : address;
  }
}
