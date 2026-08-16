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

import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import type { Any } from "@bufbuild/protobuf/wkt";
import { clone, create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { TypeUrls, type MessageSchema } from "@spine-event-engine/core";
import {
  BoundedContextOnlineSchema,
  EventIdSchema,
  EventContextSchema,
  EventSchema,
  ExternalEventsWantedSchema,
  ExternalMessageSchema,
  type BoundedContextName,
  type BoundedContextOnline,
  type Event,
  type ExternalEventsWanted,
  type ExternalMessage,
} from "@spine-event-engine/proto";

/**
 * Wraps an exact domain Event for an event channel.
 *
 * @param event Provides the complete Event.
 * @param origin Provides the publishing bounded context.
 * @returns The external event frame.
 */
export function wrapExternalEvent(
  event: Event,
  origin: BoundedContextName,
): WrappedExternalMessage {
  if (!event.id?.value) throw new Error("External Event requires an EventId.");
  return create(ExternalMessageSchema, {
    id: { typeUrl: spineTypeUrl(EventIdSchema), value: toBinary(EventIdSchema, event.id) },
    originalMessage: { typeUrl: spineTypeUrl(EventSchema), value: toBinary(EventSchema, event) },
    boundedContextName: origin,
  }) as WrappedExternalMessage;
}

/**
 * Wraps a complete wanted-event document using a non-event UUID identity.
 *
 * @param wanted Provides the requested external types.
 * @param origin Provides the publishing bounded context.
 * @returns The external control frame.
 */
export function wrapExternalEventsWanted(
  wanted: ExternalEventsWanted,
  origin: BoundedContextName,
): WrappedExternalMessage {
  return wrapControl(
    {
      typeUrl: spineTypeUrl(ExternalEventsWantedSchema),
      value: toBinary(ExternalEventsWantedSchema, wanted),
    },
    origin,
  );
}

/**
 * Wraps online discovery using a non-event UUID identity.
 *
 * @param online Provides the online announcement.
 * @returns The external control frame.
 */
export function wrapBoundedContextOnline(online: BoundedContextOnline): WrappedExternalMessage {
  return wrapControl(
    {
      typeUrl: spineTypeUrl(BoundedContextOnlineSchema),
      value: toBinary(BoundedContextOnlineSchema, online),
    },
    online.context,
  );
}

/**
 * Validates and recovers the complete original Event.
 *
 * @param message Provides the received external frame.
 * @returns The validated complete Event.
 */
export function unpackExternalEvent(message: ExternalMessage): Event {
  if (!message.boundedContextName?.value) throw new Error("External message requires an origin.");
  if (message.id?.typeUrl !== spineTypeUrl(EventIdSchema))
    throw new Error("External Event requires an EventId wrapper identity.");
  if (message.originalMessage?.typeUrl !== spineTypeUrl(EventSchema))
    throw new Error("External message does not contain an Event.");
  let event: Event;
  try {
    event = fromBinary(EventSchema, message.originalMessage.value);
    const id = fromBinary(EventIdSchema, message.id.value);
    if (!event.id?.value || id.value !== event.id.value)
      throw new Error("External Event wrapper identity does not match Event.id.");
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("External Event is malformed.");
  }
  return event;
}

/**
 * Copies an imported Event while changing only its external origin flag.
 *
 * @internal
 * @param event Provides the received Event.
 * @returns A copied Event marked external.
 */
export function toExternalEvent(event: Event): Event {
  const imported = clone(EventSchema, event);
  imported.context = clone(EventContextSchema, imported.context ?? create(EventContextSchema));
  imported.context.external = true;
  return imported;
}

function wrapControl(
  originalMessage: { readonly typeUrl: string; readonly value: Uint8Array },
  origin: BoundedContextName | undefined,
): WrappedExternalMessage {
  if (!origin?.value) throw new Error("External control message requires an origin.");
  const id = create(StringValueSchema, { value: crypto.randomUUID() });
  return create(ExternalMessageSchema, {
    id: { typeUrl: spineTypeUrl(StringValueSchema), value: toBinary(StringValueSchema, id) },
    originalMessage,
    boundedContextName: origin,
  }) as WrappedExternalMessage;
}

/** @internal An ExternalMessage constructed locally with its required wrapper identity. */
type WrappedExternalMessage = ExternalMessage & { readonly id: Any };

function spineTypeUrl(schema: MessageSchema): string {
  return TypeUrls.derive(schema);
}
