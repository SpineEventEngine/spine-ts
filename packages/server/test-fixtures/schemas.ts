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
export { file_entity_metadata_project_states as entityMetadataMainFile } from "./generated/entity-metadata/project_states_pb.js";
export { file_entity_metadata_empty as entityMetadataEmptyFile } from "./generated/entity-metadata/empty_pb.js";
export { file_entity_metadata_unknown_kind as entityMetadataUnknownKindFile } from "./generated/entity-metadata/unknown-kind_pb.js";
export { file_entity_metadata_invalid_column as entityMetadataInvalidColumnFile } from "./generated/entity-metadata/invalid-column_pb.js";
export { file_entity_metadata_invalid_tag as entityMetadataInvalidTagFile } from "./generated/entity-metadata/invalid-tag_pb.js";
export { file_entity_metadata_visibility as entityMetadataVisibilityFile } from "./generated/entity-metadata/visibility_pb.js";
export { file_handler_registry_commands as handlerRegistryCommandsFile } from "./generated/handler-registry/commands_pb.js";
export { file_handler_registry_events as handlerRegistryEventsFile } from "./generated/handler-registry/events_pb.js";
export { file_handler_registry_rejections as handlerRegistryRejectionsFile } from "./generated/handler-registry/rejections_pb.js";
export { file_handler_registry_states as handlerRegistryStatesFile } from "./generated/handler-registry/states_pb.js";
export {
  ProjectOverviewStateSchema as RepositoryRoutingProjectOverviewStateSchema,
  ProjectStateSchema as RepositoryRoutingProjectStateSchema,
  RegisteredProjectStateSchema as RepositoryRoutingRegisteredProjectStateSchema,
  ProjectBacklogStateSchema as RepositoryRoutingProjectBacklogStateSchema,
  NumberedProjectStateSchema as RepositoryRoutingNumberedProjectStateSchema,
  ProjectWorkflowStateSchema as RepositoryRoutingProjectWorkflowStateSchema,
  ProjectQueueStateSchema as RepositoryRoutingProjectQueueStateSchema,
  SequencedProjectOverviewStateSchema as RepositoryRoutingSequencedProjectOverviewStateSchema,
  SequencedProjectSourceStateSchema as RepositoryRoutingSequencedProjectSourceStateSchema,
  ProjectMilestoneOverviewStateSchema as RepositoryRoutingProjectMilestoneOverviewStateSchema,
  ProjectMilestoneStateSchema as RepositoryRoutingProjectMilestoneStateSchema,
  ProjectMilestoneWorkflowStateSchema as RepositoryRoutingProjectMilestoneWorkflowStateSchema,
  ProjectMilestoneSourceStateSchema as RepositoryRoutingProjectMilestoneSourceStateSchema,
} from "./generated/repository-routing/project_states_pb.js";
export {
  ProjectIdSchema as RepositoryRoutingProjectIdSchema,
  ProjectSequenceIdSchema as RepositoryRoutingProjectSequenceIdSchema,
  ProjectMilestoneIdSchema as RepositoryRoutingProjectMilestoneIdSchema,
} from "./generated/repository-routing/project_identifiers_pb.js";
export {
  RegisterProjectSchema as RepositoryRoutingRegisterProjectSchema,
  CreateProjectSchema as RepositoryRoutingCreateProjectSchema,
  DraftProjectSchema as RepositoryRoutingDraftProjectSchema,
  CreateNumberedProjectSchema as RepositoryRoutingCreateNumberedProjectSchema,
  ScheduleProjectWorkflowSchema as RepositoryRoutingScheduleProjectWorkflowSchema,
  InviteProjectMembersSchema as RepositoryRoutingInviteProjectMembersSchema,
  AssignProjectAttributesSchema as RepositoryRoutingAssignProjectAttributesSchema,
  AddProjectMilestoneSchema as RepositoryRoutingAddProjectMilestoneSchema,
} from "./generated/repository-routing/project_commands_pb.js";
export {
  ProjectCreatedSchema as RepositoryRoutingProjectCreatedSchema,
  ProjectRegisteredSchema as RepositoryRoutingProjectRegisteredSchema,
  NumberedProjectCreatedSchema as RepositoryRoutingNumberedProjectCreatedSchema,
  ProjectWorkflowScheduledSchema as RepositoryRoutingProjectWorkflowScheduledSchema,
  SequencedProjectOverviewCreatedSchema as RepositoryRoutingSequencedProjectOverviewCreatedSchema,
  ProjectMilestoneAddedSchema as RepositoryRoutingProjectMilestoneAddedSchema,
} from "./generated/repository-routing/project_events_pb.js";
export {
  ProjectSubmissionStateSchema as RepositoryRoutingProjectSubmissionStateSchema,
  AcceptedProjectSubmissionStateSchema as RepositoryRoutingAcceptedProjectSubmissionStateSchema,
} from "./generated/repository-routing/project_validation_states_pb.js";
export {
  CreateProjectSubmissionSchema as RepositoryRoutingCreateProjectSubmissionSchema,
  ProjectSubmissionIdSchema as RepositoryRoutingProjectSubmissionIdSchema,
  CreateFollowUpProjectSchema as RepositoryRoutingCreateFollowUpProjectSchema,
} from "./generated/repository-routing/project_validation_commands_pb.js";
export { ProjectSubmissionCreatedSchema as RepositoryRoutingProjectSubmissionCreatedSchema } from "./generated/repository-routing/project_validation_events_pb.js";
export type {
  CreateFollowUpProject as RepositoryRoutingCreateFollowUpProject,
  ProjectSubmissionId as RepositoryRoutingProjectSubmissionId,
  CreateProjectSubmission as RepositoryRoutingCreateProjectSubmission,
} from "./generated/repository-routing/project_validation_commands_pb.js";
export type { ProjectSubmissionCreated as RepositoryRoutingProjectSubmissionCreated } from "./generated/repository-routing/project_validation_events_pb.js";
export {
  ProjectPriorityChangedSchema as RepositoryRoutingProjectPriorityChangedSchema,
  ProjectMemberChangedSchema as RepositoryRoutingProjectMemberChangedSchema,
} from "./generated/repository-routing/project_routing_events_pb.js";
export {
  CreateReviewProjectSchema,
  file_validation_refusal_project_commands as validationRefusalCommandFile,
} from "./generated/validation-refusal/project_commands_pb.js";
export { ReviewProjectStateSchema } from "./generated/validation-refusal/project_states_pb.js";
