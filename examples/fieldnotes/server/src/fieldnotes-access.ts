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

import { clone, create, equals } from "@bufbuild/protobuf";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type {
  AuthenticatedPrincipal,
  AuthorizationPolicy,
  AuthorizedRequestContext,
  Clock,
  ContextResolver,
  IncomingRequest,
} from "@spine-event-engine/auth";
import { Time, TypeUrls } from "@spine-event-engine/core";
import { UserIdSchema } from "@spine-event-engine/proto";
import type { Target } from "@spine-event-engine/proto/client";
import { TargetSchema } from "@spine-event-engine/proto/client";
import {
  AddPlaceSchema,
  DeletePlaceSchema,
  EditPlaceNoteSchema,
  MovePlaceSchema,
  RenamePlaceSchema,
} from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/commands_pb.js";
import { PlaceViewSchema } from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/entities_pb.js";
import { PlaceViewQuery } from "@spine-event-engine/example-fieldnotes-model/generated/spine/examples/fieldnotes/entities_query.js";
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

const commandTypes = new Set<string>([
  AddPlaceSchema.typeName,
  RenamePlaceSchema.typeName,
  MovePlaceSchema.typeName,
  EditPlaceNoteSchema.typeName,
  DeletePlaceSchema.typeName,
]);

const outcomeTypes = new Set(
  [
    PlaceAddedSchema,
    PlaceRenamedSchema,
    PlaceMovedSchema,
    PlaceNoteEditedSchema,
    PlaceDeletedSchema,
    InvalidPlaceCoordinatesSchema,
    PlaceAlreadyExistsSchema,
    PlaceRevisionConflictSchema,
    PlaceUnavailableSchema,
  ].map((schema) => TypeUrls.derive(schema)),
);

/**
 * Supplies trusted wall time for gateway context construction.
 */
export class FieldnotesClock implements Clock {
  /**
   * Returns the host's current timestamp.
   *
   * @returns A trusted timestamp.
   */
  now(): Timestamp {
    return Time.currentTime();
  }
}

/**
 * Rebuilds one single-tenant actor from a verified app session.
 */
export class FieldnotesContextResolver implements ContextResolver {
  /**
   * Resolves a request without accepting caller-selected tenant or actor facts.
   *
   * @param principal Verified session principal.
   * @param request The authorized request, whose actor is not trusted.
   * @param clock Trusted host clock.
   * @returns Actor and timestamp for the native request.
   */
  resolve(
    principal: AuthenticatedPrincipal,
    request: IncomingRequest,
    clock: Clock,
  ): Promise<AuthorizedRequestContext> {
    void request;
    return this.resolveContext(principal, clock);
  }

  /**
   * Resolves a principal for context-only gateway requests.
   *
   * @param principal Verified session principal.
   * @param clock Trusted host clock.
   * @returns Actor and timestamp without a tenant.
   */
  resolveContext(
    principal: AuthenticatedPrincipal,
    clock: Clock,
  ): Promise<AuthorizedRequestContext> {
    return Promise.resolve({
      actor: create(UserIdSchema, { value: principal.id }),
      timestamp: clock.now(),
    });
  }
}

/**
 * Admits only the Fieldnotes command, view and domain-outcome surfaces.
 */
export class FieldnotesAccess implements AuthorizationPolicy {
  /**
   * Checks a request after the gateway has established its principal.
   *
   * @param principal Verified app-session principal.
   * @param request Decoded browser operation.
   * @returns Whether this operation may reach the native server.
   */
  authorize(principal: AuthenticatedPrincipal, request: IncomingRequest): Promise<boolean> {
    if (!principal.id || request.requestedContext.tenantId !== undefined)
      return Promise.resolve(false);
    if (request.kind === "activate" || request.kind === "cancel")
      return Promise.resolve(request.subscription.topic?.context?.tenantId === undefined);
    if (request.kind === "command")
      return Promise.resolve(
        request.message !== undefined && commandTypes.has(request.message.$typeName),
      );
    if (request.kind === "app-query") return Promise.resolve(false);
    if (request.target.type === TypeUrls.derive(PlaceViewSchema)) {
      if (request.kind === "query")
        return Promise.resolve(this.queryTarget(principal.id, request.target));
      return Promise.resolve(equals(TargetSchema, request.target, this.authorTarget(principal.id)));
    }
    return Promise.resolve(request.kind === "subscribe" && outcomeTypes.has(request.target.type));
  }

  /**
   * Checks for the verified author predicate before bounded candidate selection.
   *
   * @param principalId Verified application principal ID.
   * @param target Requested PlaceView target.
   * @returns Whether its predicate is canonical for this author.
   */
  private queryTarget(principalId: string, target: Target): boolean {
    if (target.criterion.case !== "filters") return false;
    const normalized = clone(TargetSchema, target);
    if (normalized.criterion.case !== "filters") return false;
    normalized.criterion.value.idFilter = undefined;
    if (equals(TargetSchema, normalized, this.authorTarget(principalId))) return true;
    const visible = PlaceViewQuery.create()
      .author()
      .is(create(UserIdSchema, { value: principalId }))
      .removed()
      .is(false)
      .build()
      .build().target;
    return visible !== undefined && equals(TargetSchema, normalized, visible);
  }

  /**
   * Builds the sole permitted entity subscription target for this principal.
   *
   * @param principalId Verified application principal ID.
   * @returns A generated author-only PlaceView target, including tombstones.
   */
  private authorTarget(principalId: string): Target {
    const target = PlaceViewQuery.create()
      .author()
      .is(create(UserIdSchema, { value: principalId }))
      .build()
      .build().target;
    if (target === undefined) throw new Error("Generated author query has no Target.");
    return target;
  }
}
