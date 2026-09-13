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

import { create } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { FieldOptionsSchema, MessageOptionsSchema } from "@bufbuild/protobuf/wkt";
import { column, entity } from "@spine-event-engine/proto";

export {
  ProjectStateSchema,
  ProjectStatus,
  ProjectOverviewWithLabelCatalogStateSchema,
  ProjectOverviewWithDisplayLabelStateSchema,
  ProjectOverviewWithTagsStateSchema,
  ProjectWorkflowStateSchema,
  ProjectOverviewStateSchema,
  ProjectOverviewWithMetricsStateSchema,
} from "./generated/project_states_pb.js";
export type { ProjectLead } from "./generated/project_states_pb.js";
import { ProjectOverviewStateSchema } from "./generated/project_states_pb.js";
import type { ProjectOverviewState } from "./generated/project_states_pb.js";

export function projectionSchemaWithRawEntityOption(
  data: Uint8Array,
): GenMessage<ProjectOverviewState> {
  const options = create(MessageOptionsSchema);
  options.$unknown = [{ no: entity.number, wireType: 2, data }];
  return {
    ...ProjectOverviewStateSchema,
    proto: { ...ProjectOverviewStateSchema.proto, options },
  };
}

export function projectionFieldWithRawColumnOption(data: Uint8Array) {
  const options = create(FieldOptionsSchema);
  options.$unknown = [{ no: column.number, wireType: 0, data }];
  return {
    ...ProjectOverviewStateSchema.field.title,
    proto: { ...ProjectOverviewStateSchema.field.title.proto, options },
  };
}
