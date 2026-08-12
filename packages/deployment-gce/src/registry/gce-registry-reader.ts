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
