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

import { TypeRegistry } from "@spine-event-engine/core";
import { messageBoardProtoModule as model0 } from "@spine-event-engine/example-message-board-model";

/**
 * The application type registry composed from every declared model package.
 */
export const typeRegistry: TypeRegistry = TypeRegistry.from(model0);
