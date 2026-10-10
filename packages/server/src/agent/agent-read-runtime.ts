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

import { clone, create, equals, type MessageShape } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import { AnyMessages, TypeUrls, type MessageSchema } from "@spine-event-engine/core";
import { AgentHistoryCursorSchema } from "@spine-event-engine/proto/agent";
import { QueryIdSchema, QuerySchema, type Query } from "@spine-event-engine/proto/client";
import {
  AgentExecutionJournalEntrySchema as JournalEntrySchema,
  AgentExecutionScopeSchema,
  AgentHistoryReadKind,
  AgentHistoryReadPageSchema as ReadPageSchema,
  AgentHistoryReadRequestSchema as ReadRequestSchema,
  AgentProjectionReadResultSchema as ProjectionResultSchema,
  AgentReadSnapshotSchema,
  type AgentExecutionRecord,
  type AgentReadSnapshot,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import {
  AgentExecutionSizes,
  type AgentExecutionCapacity,
  type AgentHistoryPage,
  type AgentHistoryView,
} from "@spine-event-engine/storage/provider";
import type { HistoryRead } from "@spine-event-engine/ai";
import type { AgentHistoryScope } from "./agent-history.js";
import { AgentExecutionFault } from "./agent-execution-fault.js";

interface ReadSession {
  /**
   * Returns the current fenced execution record.
   *
   * @returns The execution record.
   */
  record(): AgentExecutionRecord;

  /**
   * Persists a change to the fenced execution record.
   *
   * @param change Applies the read evidence to the current record.
   * @returns The updated execution record.
   */
  update(
    change: (record: AgentExecutionRecord) => AgentExecutionRecord,
  ): Promise<AgentExecutionRecord>;

  /**
   * Returns the configured journal capacity.
   *
   * @returns The execution capacity limits.
   */
  capacity(): AgentExecutionCapacity;
}

/**
 * Reuses complete indexed pages under one handler's fenced journal.
 */
export class AgentReadRuntime {
  #cursor = 0;

  #pending = 0;

  #tail: Promise<void> = Promise.resolve();

  /**
   * Creates a read sequencer for one handler invocation.
   *
   * @param session Fenced execution journal for this invocation.
   * @param handlerOrdinal Ordinal of the handler within the accepted delivery.
   */
  constructor(
    private readonly session: ReadSession,
    private readonly handlerOrdinal: number,
  ) {}

  /**
   * Returns one saved page or persists a live page before the handler sees it.
   *
   * @param scope Accepted Agent instance for this read.
   * @param view History view selected by the handler.
   * @param request Requested page and cursor.
   * @param live Performs the live read when no saved page exists.
   * @param maxBytes Maximum size of a live history page.
   * @returns The saved or newly persisted page.
   */
  history(
    scope: AgentHistoryScope,
    view: AgentHistoryView,
    request: HistoryRead,
    live: () => Promise<AgentHistoryPage>,
    maxBytes: number,
  ): Promise<AgentHistoryPage> {
    this.#pending++;
    const read = this.#tail.then(() => this.#history(scope, view, request, live, maxBytes));
    this.#tail = read.then(
      () => undefined,
      () => undefined,
    );
    return read.finally(() => {
      this.#pending--;
    });
  }

  /**
   * Returns saved typed projection states or persists a live query result.
   *
   * @typeParam Schema Schema of each returned projection state.
   * @param schema Projection state schema.
   * @param query Typed query to replay or execute.
   * @param live Performs the live query when no saved result exists.
   * @returns The saved or newly persisted projection states.
   */
  query<Schema extends MessageSchema>(
    schema: Schema,
    query: Query,
    live: () => Promise<readonly MessageShape<Schema>[]>,
  ): Promise<readonly MessageShape<Schema>[]> {
    this.#pending++;
    const read = this.#tail.then(() => this.#query(schema, query, live));
    this.#tail = read.then(
      () => undefined,
      () => undefined,
    );
    return read.finally(() => {
      this.#pending--;
    });
  }

  /**
   * Handles a projection read in the same call-order sequence as history reads.
   *
   * @typeParam Schema Schema of the projection states.
   */
  async #query<Schema extends MessageSchema>(
    schema: Schema,
    query: Query,
    live: () => Promise<readonly MessageShape<Schema>[]>,
  ): Promise<readonly MessageShape<Schema>[]> {
    if (query.target?.type !== TypeUrls.derive(schema))
      throw new AgentExecutionFault(
        "REPLAY_DIVERGENCE",
        "Agent projection query target type changed.",
      );
    const name = `query:${String(this.#cursor)}`;
    const prior = this.#savedReads()[this.#cursor];
    if (prior !== undefined) {
      const states = this.#replayQuery(prior, name, schema, query);
      this.#cursor++;
      return states;
    }
    this.#checkBudget(this.session.record());
    const states = await live();
    await this.#saveQuery(name, query, schema, states);
    this.#cursor++;
    return states;
  }

  /**
   * Reuses typed states after comparing every request field except generated ID.
   *
   * @typeParam Schema Schema of the saved projection states.
   */
  #replayQuery<Schema extends MessageSchema>(
    prior: AgentReadSnapshot,
    name: string,
    schema: Schema,
    query: Query,
  ): readonly MessageShape<Schema>[] {
    const scope = this.session.record().accepted?.key?.scope;
    const saved =
      prior.request === undefined ? undefined : AnyMessages.unpack(prior.request, QuerySchema);
    if (
      saved?.id === undefined ||
      scope === undefined ||
      prior.readName !== name ||
      prior.scope === undefined ||
      !equals(AgentExecutionScopeSchema, prior.scope, scope)
    )
      throw new AgentExecutionFault(
        "REPLAY_DIVERGENCE",
        "Agent projection query request or scope changed on recovery.",
      );
    const normalized = clone(QuerySchema, query);
    normalized.id = clone(QueryIdSchema, saved.id);
    if (!equals(QuerySchema, normalized, saved))
      throw new AgentExecutionFault(
        "REPLAY_DIVERGENCE",
        "Agent projection query request changed on recovery.",
      );
    return this.#savedQueryStates(prior, schema);
  }

  /**
   * Decodes only states matching the requested generated Projection schema.
   * @typeParam Schema Generated state schema requested by the handler.
   * @param prior Saved read entry with its typed result.
   * @param schema Expected Projection state schema.
   * @returns Independent retained state messages.
   */
  #savedQueryStates<Schema extends MessageSchema>(
    prior: AgentReadSnapshot,
    schema: Schema,
  ): readonly MessageShape<Schema>[] {
    const result =
      prior.result === undefined
        ? undefined
        : AnyMessages.unpack(prior.result, ProjectionResultSchema);
    if (result === undefined)
      throw new AgentExecutionFault(
        "REPLAY_DIVERGENCE",
        "Saved Agent projection result is absent.",
      );
    return Object.freeze(
      result.states.map((packed) => {
        const state = AnyMessages.unpack(packed, schema);
        if (state === undefined)
          throw new AgentExecutionFault(
            "REPLAY_DIVERGENCE",
            "Saved Agent projection state type changed.",
          );
        return state;
      }),
    );
  }

  /**
   * Persists typed projection states before exposing them to a handler.
   *
   * @typeParam Schema Schema of the states being saved.
   */
  async #saveQuery<Schema extends MessageSchema>(
    name: string,
    query: Query,
    schema: Schema,
    states: readonly MessageShape<Schema>[],
  ): Promise<void> {
    const request = AnyMessages.pack(QuerySchema, query);
    const result = this.#queryResult(schema, states);
    await this.session.update((record) => {
      const scope = record.accepted?.key?.scope;
      if (scope === undefined) throw new Error("Agent query requires accepted scope.");
      this.#checkBudget(record);
      record.journal.push(
        create(JournalEntrySchema, {
          ordinal: BigInt(record.journal.length),
          evidence: {
            case: "read",
            value: create(AgentReadSnapshotSchema, {
              handlerOrdinal: this.handlerOrdinal,
              readName: name,
              scope,
              request,
              result,
            }),
          },
        }),
      );
      this.#checkCapacity(record);
      return record;
    });
  }

  /**
   * Packs the exact typed state array returned by a Projection read.
   * @typeParam Schema Schema of the states being saved.
   * @param schema Generated state descriptor.
   * @param states Ordered states returned by the live query.
   * @returns Typed saved query result envelope.
   */
  #queryResult<Schema extends MessageSchema>(
    schema: Schema,
    states: readonly MessageShape<Schema>[],
  ): Any {
    return AnyMessages.pack(
      ProjectionResultSchema,
      create(ProjectionResultSchema, {
        states: states.map((state) => AnyMessages.pack(schema, state)),
      }),
    );
  }

  /**
   * Processes reads in call order, including concurrent handler requests.
   */
  async #history(
    scope: AgentHistoryScope,
    view: AgentHistoryView,
    request: HistoryRead,
    live: () => Promise<AgentHistoryPage>,
    maxBytes: number,
  ): Promise<AgentHistoryPage> {
    this.#checkScope(scope);
    const named = `history:${String(this.#cursor)}`;
    const prepared = this.#request(view, request, maxBytes);
    const prior = this.#savedReads()[this.#cursor];
    if (prior !== undefined) {
      const page = this.#replay(prior, named, prepared);
      this.#cursor++;
      return page;
    }
    this.#checkBudget(this.session.record());
    const page = await live();
    await this.#save(named, prepared, page);
    this.#cursor++;
    return page;
  }

  /**
   * Rejects omitted saved reads after all handler methods have returned.
   */
  finish(): void {
    if (this.#pending !== 0) throw new Error("Agent history read is still in progress.");
    if (this.#cursor !== this.#savedReads().length)
      throw new AgentExecutionFault(
        "REPLAY_DIVERGENCE",
        "Agent history read sequence changed on recovery.",
      );
  }

  /**
   * Ensures the read cannot escape its accepted Agent instance.
   */
  #checkScope(scope: AgentHistoryScope): void {
    const accepted = this.session.record().accepted?.key?.scope;
    if (accepted?.stateType !== scope.repository || accepted.agentKey !== scope.entity)
      throw new AgentExecutionFault(
        "REPLAY_DIVERGENCE",
        "Agent history read scope changed on recovery.",
      );
  }

  /**
   * Encodes the complete public request and effective byte ceiling.
   */
  #request(view: AgentHistoryView, request: HistoryRead, maxBytes: number) {
    const kind = {
      full: AgentHistoryReadKind.AGENT_HISTORY_READ_FULL,
      conversation: AgentHistoryReadKind.AGENT_HISTORY_READ_CONVERSATION,
      system: AgentHistoryReadKind.AGENT_HISTORY_READ_SYSTEM,
      domain: AgentHistoryReadKind.AGENT_HISTORY_READ_DOMAIN,
    }[view.kind];
    return AnyMessages.pack(
      ReadRequestSchema,
      create(ReadRequestSchema, {
        kind,
        ...(view.kind === "conversation" ? { conversation: view.conversation } : {}),
        pageSize: BigInt(request.pageSize),
        ...(request.cursor === undefined
          ? {}
          : { cursor: clone(AgentHistoryCursorSchema, request.cursor) }),
        maxBytes: BigInt(maxBytes),
      }),
    );
  }

  /**
   * Selects this handler's saved reads in original call order.
   */
  #savedReads(): AgentReadSnapshot[] {
    return this.session
      .record()
      .journal.flatMap((entry) =>
        entry.evidence.case === "read" &&
        entry.evidence.value.handlerOrdinal === this.handlerOrdinal
          ? [entry.evidence.value]
          : [],
      );
  }

  /**
   * Returns exact prior content without consulting current provider state.
   */
  #replay(prior: AgentReadSnapshot, name: string, request: Any): AgentHistoryPage {
    const scope = this.session.record().accepted?.key?.scope;
    if (
      prior.readName !== name ||
      scope === undefined ||
      prior.scope === undefined ||
      prior.request === undefined ||
      !equals(AnySchema, prior.request, request) ||
      !equals(AgentExecutionScopeSchema, prior.scope, scope)
    )
      throw new AgentExecutionFault(
        "REPLAY_DIVERGENCE",
        "Agent history read request or scope changed on recovery.",
      );
    const page =
      prior.result === undefined ? undefined : AnyMessages.unpack(prior.result, ReadPageSchema);
    if (page === undefined)
      throw new AgentExecutionFault(
        "REPLAY_DIVERGENCE",
        "Saved Agent history page is absent or changed.",
      );
    return { entries: page.entries, hasMore: page.hasMore };
  }

  /**
   * Saves a complete page under the provider claim before returning it.
   */
  async #save(name: string, request: Any, page: AgentHistoryPage): Promise<void> {
    await this.session.update((record) => {
      const scope = record.accepted?.key?.scope;
      if (scope === undefined) throw new Error("Agent history read requires accepted scope.");
      this.#checkBudget(record);
      record.journal.push(this.#entry(record.journal.length, scope, name, request, page));
      this.#checkCapacity(record);
      return record;
    });
  }

  /**
   * Counts both history and projection snapshots against one invocation bound.
   */
  #checkBudget(record: AgentExecutionRecord): void {
    const count = record.journal.filter((entry) => entry.evidence.case === "read").length;
    if (BigInt(count) >= (record.started?.bounds?.recordedReads ?? 0n))
      throw new AgentExecutionFault(
        "READ_BUDGET_EXCEEDED",
        "Agent recorded read budget is exhausted.",
      );
  }

  /**
   * Constructs the complete recorded read page with its call-order name.
   */
  #entry(
    ordinal: number,
    scope: NonNullable<AgentReadSnapshot["scope"]>,
    name: string,
    request: Any,
    page: AgentHistoryPage,
  ) {
    return create(JournalEntrySchema, {
      ordinal: BigInt(ordinal),
      evidence: {
        case: "read",
        value: create(AgentReadSnapshotSchema, {
          handlerOrdinal: this.handlerOrdinal,
          readName: name,
          scope,
          request,
          result: AnyMessages.pack(
            ReadPageSchema,
            create(ReadPageSchema, {
              entries: [...page.entries],
              hasMore: page.hasMore,
            }),
          ),
        }),
      },
    });
  }

  /**
   * Rejects a page whose full persisted journal exceeds runtime or provider bounds.
   */
  #checkCapacity(record: AgentExecutionRecord): void {
    const size = AgentExecutionSizes.record(record);
    const providerLimit = this.session.capacity().executionRecordBytes;
    if (
      BigInt(size) > (record.started?.bounds?.maxRecoveryBytes ?? 0n) ||
      (providerLimit !== undefined && size > providerLimit)
    )
      throw new Error("Agent read snapshot exceeds durable record bytes.");
  }
}
