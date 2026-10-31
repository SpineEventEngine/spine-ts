/*
 * Copyright 2026, CodeMatters. All rights reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at https://www.apache.org/licenses/LICENSE-2.0
 */

import type { Message, MessageShape } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import type { EntityQueryDescription } from "@spine-event-engine/core/codegen";
import type { ActorContext } from "@spine-event-engine/proto";
import type { TrustedReaderContext } from "@spine-event-engine/core/spi/trusted-reader";

/**
 * Trusted execution scope supplied to an application query handler.
 */
export interface AppQueryContext {
  /**
   * Effective actor and tenant context bound by the receiving Server, including public access.
   */
  readonly actorContext: Readonly<ActorContext>;

  /**
   * Principal verified for this invocation, absent for admitted public readers.
   */
  readonly principal?: TrustedReaderContext["principal"];

  /**
   * Detached application authority facts from the current trusted port.
   */
  readonly authorityFacts?: TrustedReaderContext["authorityFacts"];

  /**
   * Cancellation of the current framework invocation, when supplied.
   */
  readonly signal?: AbortSignal;

  /**
   * Binds an existing typed Entity query to this request's read scope.
   *
   * @typeParam Schema Generated Entity state schema.
   * @typeParam Id Entity identifier selected by the query.
   * @param query Existing detached Entity query description.
   * @returns A read facade bound to trusted actor and tenant facts.
   */
  select<Schema extends GenMessage<Message>, Id>(
    query: EntityQueryDescription<Schema, Id>,
  ): Readonly<{ read(): Promise<readonly MessageShape<Schema>[]> }>;
}

/**
 * Application query implementation selected explicitly when a Server starts.
 *
 * @typeParam Q Generated application request message.
 * @typeParam R Paired generated application result message.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- Q defines the handler request contract.
export abstract class AppQueryHandler<Q extends Message, R extends Message> {
  declare private readonly appQueryBrand: never;

  /**
   * Executes one validated application query in its trusted read scope.
   *
   * @param query Validated generated request message.
   * @param context Trusted read capability and execution facts.
   * @returns The paired result message, optionally asynchronous.
   */
  abstract execute(query: Q, context: AppQueryContext): R | Promise<R>;
}
