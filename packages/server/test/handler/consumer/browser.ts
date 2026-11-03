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
import type { AppQueryResponseFor } from "@spine-event-engine/core";
import { GetProjectOverview } from "../../../test-fixtures/generated/repository-routing/project_queries_app_query.js";

const query: GetProjectOverview.Query = create(GetProjectOverview.querySchema);
const response: AppQueryResponseFor<typeof query> = create(GetProjectOverview.responseSchema);
void query;
void response;
