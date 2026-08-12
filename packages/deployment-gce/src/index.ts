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

export {
  GceMetadataService,
  type GceMetadata,
  type GceMetadataProvider,
} from "./metadata/gce-metadata-service.js";
export { GceApplicationNode, type GceApplicationNodeOptions } from "./node/application-node.js";
export { GceNodeDiscovery, type GceNodeDiscoveryOptions } from "./discovery/gce-node-discovery.js";
export { type GceDeadlineFactory, type GceScheduler } from "./registrar/operations.js";
export {
  GceRegistrar,
  type GceRegistrarLifecycle,
  type GceRegistrarOptions,
} from "./registrar/gce-registrar.js";
export { GceRegistryReader } from "./registry/gce-registry-reader.js";
