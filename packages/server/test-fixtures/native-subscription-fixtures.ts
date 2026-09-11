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

import type { Message } from "@bufbuild/protobuf";
import {
  ProjectStateSchema as NativeProjectStateSchema,
  ProjectOverviewStateSchema as NativeProjectOverviewStateSchema,
} from "./generated/entity-metadata/project_states_pb.js";
import { ProcessManagerStateSchema as NativeProcessManagerStateSchema } from "./generated/entity-metadata/visibility_pb.js";

export type NativeProjectOverviewState = Message<"ProjectOverviewState"> & {
  id: string;
  name: string;
  priority: number;
};

export type NativeProjectState = Message<"ProjectState"> & {
  id: string;
  name: string;
  archived: boolean;
};

export type NativeProcessManagerState = Message<"ProcessManagerState"> & {
  id: string;
  queue: string;
};

export {
  NativeProjectOverviewStateSchema,
  NativeProjectStateSchema,
  NativeProcessManagerStateSchema,
};
