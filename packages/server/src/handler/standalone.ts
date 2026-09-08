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

/** Nominal base class for a decorated standalone command assignee. */
export abstract class AbstractAssignee {
  private readonly assigneeBrand!: never;
}

/** Nominal base class for a decorated standalone command handler. */
export abstract class AbstractCommander {
  private readonly commanderBrand!: never;
}

/** Nominal base class for a decorated standalone Event reactor. */
export abstract class AbstractEventReactor {
  private readonly eventReactorBrand!: never;
}

/** Nominal base class for a decorated standalone Event subscriber. */
export abstract class AbstractEventSubscriber {
  private readonly eventSubscriberBrand!: never;
}
