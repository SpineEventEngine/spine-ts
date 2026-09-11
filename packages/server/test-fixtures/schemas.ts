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

/* Readable server test-fixture schemas generated from the adjacent Proto sources. */
export { file_entity_metadata_main as entityMetadataMainFile } from "./generated/entity-metadata/main_pb.js";
export { file_entity_metadata_empty as entityMetadataEmptyFile } from "./generated/entity-metadata/empty_pb.js";
export { file_entity_metadata_unknown_kind as entityMetadataUnknownKindFile } from "./generated/entity-metadata/unknown-kind_pb.js";
export { file_entity_metadata_invalid_column as entityMetadataInvalidColumnFile } from "./generated/entity-metadata/invalid-column_pb.js";
export { file_entity_metadata_invalid_tag as entityMetadataInvalidTagFile } from "./generated/entity-metadata/invalid-tag_pb.js";
export { file_entity_metadata_visibility as entityMetadataVisibilityFile } from "./generated/entity-metadata/visibility_pb.js";
export { file_handler_registry_commands as handlerRegistryCommandsFile } from "./generated/handler-registry/commands_pb.js";
export { TaskCommandSchema as RepositoryRoutingTaskCommandSchema } from "./generated/handler-registry/commands_pb.js";
export { file_handler_registry_events as handlerRegistryEventsFile } from "./generated/handler-registry/events_pb.js";
export { file_handler_registry_rejections as handlerRegistryRejectionsFile } from "./generated/handler-registry/rejections_pb.js";
export { file_handler_registry_states as handlerRegistryStatesFile } from "./generated/handler-registry/states_pb.js";
export {
  ProjectionStateSchema as RepositoryRoutingProjectionStateSchema,
  AggregateStateSchema as RepositoryRoutingAggregateStateSchema,
  UuidMessageIdAggregateStateSchema as RepositoryRoutingUuidMessageIdAggregateStateSchema,
  NeutralProjectionStateSchema as RepositoryRoutingNeutralProjectionStateSchema,
  Int32AggregateStateSchema as RepositoryRoutingInt32AggregateStateSchema,
  Int64ProcessManagerStateSchema as RepositoryRoutingInt64ProcessManagerStateSchema,
  ProcessManagerStateSchema as RepositoryRoutingProcessManagerStateSchema,
  ProjectionIdSchema as RepositoryRoutingProjectionIdSchema,
  Int64MessageIdProjectionStateSchema as RepositoryRoutingInt64MessageIdProjectionStateSchema,
  Int64MessageIdSourceStateSchema as RepositoryRoutingInt64MessageIdSourceStateSchema,
  CompositeRouteIdSchema as RepositoryRoutingCompositeRouteIdSchema,
  CompositeRouteStateSchema as RepositoryRoutingCompositeRouteStateSchema,
  CompositeRouteAggregateStateSchema as RepositoryRoutingCompositeRouteAggregateStateSchema,
  CompositeRouteProcessManagerStateSchema as RepositoryRoutingCompositeRouteProcessManagerStateSchema,
  CompositeRouteSourceStateSchema as RepositoryRoutingCompositeRouteSourceStateSchema,
} from "./generated/repository-routing/routing_pb.js";
export {
  UuidMessageIdAggregateCommandSchema as RepositoryRoutingUuidMessageIdAggregateCommandSchema,
  ImplicitTaskCommandSchema as RepositoryRoutingImplicitTaskCommandSchema,
  Int32AggregateCommandSchema as RepositoryRoutingInt32AggregateCommandSchema,
  Int64ProcessManagerCommandSchema as RepositoryRoutingInt64ProcessManagerCommandSchema,
  RepeatedIdCommandSchema as RepositoryRoutingRepeatedIdCommandSchema,
  MapIdCommandSchema as RepositoryRoutingMapIdCommandSchema,
  CompositeRouteCommandSchema as RepositoryRoutingCompositeRouteCommandSchema,
} from "./generated/repository-routing/repository_commands_pb.js";
export {
  ProjectionEventSchema as RepositoryRoutingProjectionEventSchema,
  GeneratedReactorEventSchema as RepositoryRoutingGeneratedReactorEventSchema,
  Int32AggregateEventSchema as RepositoryRoutingInt32AggregateEventSchema,
  Int64ProcessManagerEventSchema as RepositoryRoutingInt64ProcessManagerEventSchema,
  Int64MessageIdProjectionEventSchema as RepositoryRoutingInt64MessageIdProjectionEventSchema,
  CompositeRouteEventSchema as RepositoryRoutingCompositeRouteEventSchema,
} from "./generated/repository-routing/repository_events_pb.js";
export {
  ValidatedAggregateStateSchema as RepositoryRoutingValidatedAggregateStateSchema,
  ValidatedMessageIdStateSchema as RepositoryRoutingValidatedMessageIdStateSchema,
} from "./generated/repository-routing/validation-refusal_pb.js";
export {
  ValidatedTaskCommandSchema as RepositoryRoutingValidatedTaskCommandSchema,
  ProducedTaskCommandSchema as RepositoryRoutingProducedTaskCommandSchema,
} from "./generated/repository-routing/validation_refusal_commands_pb.js";
export { ValidatedTaskEventSchema as RepositoryRoutingValidatedTaskEventSchema } from "./generated/repository-routing/validation_refusal_events_pb.js";
export {
  NumberRouteEventSchema as RepositoryRoutingNumberRouteEventSchema,
  WrongIdRouteEventSchema as RepositoryRoutingWrongIdRouteEventSchema,
} from "./generated/repository-routing/route-validation_pb.js";
export {
  ValidatedAggregateStateSchema,
  ValidatedTaskCommandSchema,
  file_validation_refusal_command as validationRefusalCommandFile,
} from "./generated/validation-refusal/command_pb.js";
