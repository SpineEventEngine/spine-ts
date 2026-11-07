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

import type { Message, MessageShape } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import type { MessageSchema } from "@spine-event-engine/core";
import { ReadSideFilter, type ReadSideContext } from "@spine-event-engine/server";
import { PlaceViewSchema } from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/entities_pb.js";
import {
  PlaceAddedSchema,
  PlaceDeletedSchema,
  PlaceMovedSchema,
  PlaceNoteEditedSchema,
  PlaceRenamedSchema,
} from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/events_pb.js";
import {
  InvalidPlaceCoordinatesSchema,
  PlaceAlreadyExistsSchema,
  PlaceRevisionConflictSchema,
  PlaceUnavailableSchema,
} from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/rejections_pb.js";

/**
 * Filters one domain message by an author or requester field.
 *
 * @typeParam Schema Exact generated message schema protected by this filter.
 */
class PrincipalFilter<Schema extends GenMessage<Message>> extends ReadSideFilter<Schema> {
  /**
   * Registers the schema and its principal selector.
   *
   * @param schema Domain message to protect.
   * @param principalId Extracts the author or requester identifier.
   */
  constructor(
    schema: Schema,
    private readonly principalId: (message: MessageShape<Schema>) => string | undefined,
  ) {
    super(schema, { nested: true });
  }

  /**
   * Returns a detached domain message only for its verified principal.
   *
   * @param message Returned state or outcome.
   * @param context Trusted invocation facts.
   * @returns The same message or null when private to another principal.
   */
  filter(message: MessageShape<Schema>, context: ReadSideContext): MessageShape<Schema> | null {
    const principal = context.principal?.id;
    return principal !== undefined && this.principalId(message) === principal ? message : null;
  }
}

/**
 * Registers privacy filters for every browser-admitted Fieldnotes result.
 *
 * @returns PlaceView, five committed Events and four rejection filters.
 */
export function fieldnotesReadFilters(): readonly ReadSideFilter<MessageSchema>[] {
  return [
    new PrincipalFilter(PlaceViewSchema, (message) =>
      message.removed ? undefined : message.author?.value,
    ),
    new PrincipalFilter(PlaceAddedSchema, (message) => message.author?.value),
    new PrincipalFilter(PlaceRenamedSchema, (message) => message.author?.value),
    new PrincipalFilter(PlaceMovedSchema, (message) => message.author?.value),
    new PrincipalFilter(PlaceNoteEditedSchema, (message) => message.author?.value),
    new PrincipalFilter(PlaceDeletedSchema, (message) => message.author?.value),
    new PrincipalFilter(PlaceUnavailableSchema, (message) => message.requester?.value),
    new PrincipalFilter(PlaceAlreadyExistsSchema, (message) => message.requester?.value),
    new PrincipalFilter(PlaceRevisionConflictSchema, (message) => message.requester?.value),
    new PrincipalFilter(InvalidPlaceCoordinatesSchema, (message) => message.requester?.value),
  ];
}
