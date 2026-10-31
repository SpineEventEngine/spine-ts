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

import { clone, create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import type { ConversationHistoryRead, HistoryPage, HistoryRead } from "@spine-event-engine/ai";
import type { ActorContext, Event } from "@spine-event-engine/proto";
import {
  AgentHistoryCursorSchema,
  AgentHistoryEntrySchema,
  ConversationIdSchema,
  type AgentHistoryEntry,
  type ConversationRecord,
} from "@spine-event-engine/proto/agent";
import {
  AgentHistoryKeys,
  type AgentHistoryOrderKey,
  type AgentHistoryPage,
  type AgentHistoryStorage,
  type AgentHistoryView,
} from "@spine-event-engine/storage/provider";

/**
 * Identifies the exact repository and Agent instance for a continuation.
 */
export interface AgentHistoryScope {
  /**
   * Bounded Context name in the active repository.
   */
  readonly context: string;

  /**
   * Complete tenant identity encoding.
   */
  readonly tenant: string;

  /**
   * Registered Entity state type.
   */
  readonly repository: string;

  /**
   * Canonical typed Agent ID key.
   */
  readonly entity: string;
}

/**
 * Reads a current indexed provider page through one live Agent interceptor.
 *
 * @param scope Exact repository and Agent scope.
 * @param request Public read request.
 * @param live Loads the current provider page only when needed.
 * @param maxBytes Optional response-byte ceiling for this read.
 * @param present Applies outward policy after accounting for provider bytes.
 * @returns The current complete provider page.
 */
export type AgentHistoryReadInterceptor = (
  scope: AgentHistoryScope,
  request: HistoryRead,
  live: () => Promise<AgentHistoryPage>,
  maxBytes: number | undefined,
  present: (page: AgentHistoryPage) => Promise<HistoryPage<AgentHistoryEntry>>,
) => Promise<HistoryPage<AgentHistoryEntry>>;

/**
 * Repository binding for an Agent's mandatory indexed history.
 *
 * @typeParam Id Typed Agent identifier.
 */
export interface AgentHistoryBinding<Id> {
  /**
   * Mandatory provider handle.
   */
  readonly storage: AgentHistoryStorage<Id>;

  /**
   * Typed Agent ID.
   */
  readonly entityId: Id;

  /**
   * Full cursor and read scope.
   */
  readonly scope: AgentHistoryScope;

  /**
   * Optional live read interceptor.
   */
  readonly interceptRead?: AgentHistoryReadInterceptor;

  /**
   * Optional maximum serialized entry bytes in one response.
   */
  readonly maxBytes?: number;

  /**
   * Admits the complete protected page, including interceptor and provider work.
   * @param onRead Complete page read to admit.
   * @returns Its result after all work settles.
   */
  readonly onAdmit?: (
    onRead: () => Promise<HistoryPage<AgentHistoryEntry>>,
  ) => Promise<HistoryPage<AgentHistoryEntry>>;

  /**
   * Captures active signal metadata before the protected read can await.
   * @returns Detached actor context when a handler supplies one.
   */
  readonly captureActor?: () => ActorContext | undefined;

  /**
   * Transforms outward domain records after provider read and before read completion.
   * @param page Retained provider entries and original continuation.
   * @param view Requested history category.
   * @param request Captured page request.
   * @param actorContext Actor metadata from the active handler, when present.
   * @returns Visible entries with the original continuation.
   */
  readonly filterPage?: (
    page: HistoryPage<AgentHistoryEntry>,
    view: AgentHistoryView,
    request: HistoryRead,
    actorContext?: ActorContext,
  ) => Promise<HistoryPage<AgentHistoryEntry>>;
}

const bindings = new WeakMap<object, AgentHistoryBinding<unknown>>();

/**
 * Internal accessors shared by the Agent base and repository runtime.
 */
export interface AgentHistoryReadAccess {
  /**
   * Attaches one mandatory storage handle to a restored Agent.
   *
   * @typeParam Id Typed Agent identifier.
   * @param entity Restored Agent.
   * @param binding Repository history binding.
   */
  bind<Id>(entity: object, binding: AgentHistoryBinding<Id>): void;

  /**
   * Binds a read interceptor for the current handler invocation.
   *
   * @param entity Agent with an existing repository history binding.
   * @param interceptRead Intercepts current provider reads during the handler.
   * @returns Callback that restores the original history binding after the handler finishes.
   */
  withReadInterceptor(entity: object, interceptRead: AgentHistoryReadInterceptor): () => void;

  /**
   * Reads all categories.
   *
   * @param entity Agent instance.
   * @param request Page request.
   * @returns Complete entries and continuation.
   */
  full(entity: object, request: HistoryRead): Promise<HistoryPage<AgentHistoryEntry>>;

  /**
   * Reads one conversation.
   *
   * @param entity Agent instance.
   * @param request Conversation and page request.
   * @returns Conversation records and continuation.
   */
  conversation(
    entity: object,
    request: ConversationHistoryRead,
  ): Promise<HistoryPage<ConversationRecord>>;

  /**
   * Reads System Events.
   *
   * @param entity Agent instance.
   * @param request Page request.
   * @returns Original Event envelopes and continuation.
   */
  system(entity: object, request: HistoryRead): Promise<HistoryPage<Event>>;

  /**
   * Reads emitted domain Events.
   *
   * @param entity Agent instance.
   * @param request Page request.
   * @returns Original Event envelopes and continuation.
   */
  domain(entity: object, request: HistoryRead): Promise<HistoryPage<Event>>;

  /**
   * Validates a cursor and reads one provider page.
   *
   * @param entity Agent instance.
   * @param view Indexed history view.
   * @param request Page request.
   * @returns Complete entries and continuation.
   */
  read(
    entity: object,
    view: AgentHistoryView,
    request: HistoryRead,
  ): Promise<HistoryPage<AgentHistoryEntry>>;

  /**
   * Applies the same opaque cursor contract to a testing repository binding.
   *
   * @typeParam Id Typed Agent identifier supplied by the repository binding.
   * @param binding Exact Agent repository and tenant storage scope.
   * @param view Indexed history view.
   * @param request Public page request.
   * @param actorContext Actor metadata captured at invocation.
   * @returns Retained entries and opaque continuation.
   */
  readBound<Id>(
    binding: AgentHistoryBinding<Id>,
    view: AgentHistoryView,
    request: HistoryRead,
    actorContext?: ActorContext,
  ): Promise<HistoryPage<AgentHistoryEntry>>;

  /**
   * Persists a genuine framework System Event.
   *
   * @param entity Agent instance.
   * @param event Original System Event envelope.
   * @returns Completion after append.
   */
  appendSystem(entity: object, event: Event): Promise<void>;
}

/**
 * Binds protected Agent history reads to repository storage.
 */
export const AgentHistoryReads: AgentHistoryReadAccess = Object.freeze({
  /**
   * Attaches one mandatory storage handle to a restored Agent.
   *
   * @typeParam Id Typed Agent identifier.
   * @param entity Restored Agent.
   * @param binding Repository history binding.
   */
  bind<Id>(entity: object, binding: AgentHistoryBinding<Id>): void {
    bindings.set(entity, binding);
  },

  withReadInterceptor(entity: object, interceptRead: AgentHistoryReadInterceptor): () => void {
    const binding = bindings.get(entity);
    if (binding === undefined)
      throw new Error("Agent history is available only from repository execution.");
    bindings.set(entity, { ...binding, interceptRead });
    return () => {
      bindings.set(entity, binding);
    };
  },

  /**
   * Persists the exact genuine System envelope before an Agent handler runs.
   *
   * @param entity Restored Agent.
   * @param event Original System Event envelope.
   * @returns Completion after append.
   */
  appendSystem(entity: object, event: Event): Promise<void> {
    const binding = bindings.get(entity);
    if (binding === undefined)
      throw new Error("Agent history is available only from repository execution.");
    if (event.context?.timestamp === undefined)
      throw new Error("Agent System Event requires its original timestamp.");
    return binding.storage.append(
      binding.entityId,
      create(AgentHistoryEntrySchema, {
        occurredAt: event.context.timestamp,
        item: { case: "systemEvent", value: event },
      }),
    );
  },

  /**
   * Reads all categories, newest first.
   *
   * @param entity Restored Agent.
   * @param request Page request.
   * @returns Complete entries and continuation.
   */
  full(entity: object, request: HistoryRead): Promise<HistoryPage<AgentHistoryEntry>> {
    return this.read(entity, { kind: "full" }, request);
  },

  /**
   * Reads one explicit conversation, newest first.
   *
   * @param entity Restored Agent.
   * @param request Conversation and page request.
   * @returns Conversation records and continuation.
   */
  async conversation(
    entity: object,
    request: ConversationHistoryRead,
  ): Promise<HistoryPage<ConversationRecord>> {
    const conversation: unknown = request.conversation;
    if (
      conversation === null ||
      typeof conversation !== "object" ||
      !("value" in conversation) ||
      typeof conversation.value !== "string" ||
      conversation.value.length === 0
    )
      throw new TypeError("Agent conversation history requires a ConversationId.");
    const page = await this.read(
      entity,
      { kind: "conversation", conversation: request.conversation },
      request,
    );
    return {
      items: page.items.map((entry) => {
        if (entry.item.case !== "conversationRecord")
          throw new Error("Agent history provider returned the wrong category.");
        return entry.item.value;
      }),
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    };
  },

  /**
   * Reads System Event envelopes, newest first.
   *
   * @param entity Restored Agent.
   * @param request Page request.
   * @returns Original Event envelopes and continuation.
   */
  async system(entity: object, request: HistoryRead): Promise<HistoryPage<Event>> {
    const page = await this.read(entity, { kind: "system" }, request);
    return {
      items: page.items.map((entry) => {
        if (entry.item.case !== "systemEvent")
          throw new Error("Agent history provider returned the wrong category.");
        return entry.item.value;
      }),
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    };
  },

  /**
   * Reads emitted domain Event envelopes, newest first.
   *
   * @param entity Restored Agent.
   * @param request Page request.
   * @returns Original Event envelopes and continuation.
   */
  async domain(entity: object, request: HistoryRead): Promise<HistoryPage<Event>> {
    const page = await this.read(entity, { kind: "domain" }, request);
    return {
      items: page.items.map((entry) => {
        if (entry.item.case !== "domainEvent")
          throw new Error("Agent history provider returned the wrong category.");
        return entry.item.value;
      }),
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    };
  },

  /**
   * Validates the cursor before asking the indexed provider for a page.
   *
   * @param entity Restored Agent.
   * @param view Indexed history view.
   * @param request Page request.
   * @returns Complete entries and continuation.
   */
  async read(
    entity: object,
    view: AgentHistoryView,
    request: HistoryRead,
  ): Promise<HistoryPage<AgentHistoryEntry>> {
    const binding = bindings.get(entity);
    if (binding === undefined)
      throw new Error("Agent history is available only from repository execution.");
    return this.readBound(binding, view, request, binding.captureActor?.());
  },

  /**
   * Reads a bounded provider page through the current live interceptor.
   *
   * @typeParam Id Typed Agent identifier supplied by the repository binding.
   * @param binding Repository storage, identity and optional live read interceptor.
   * @param view Indexed category and optional conversation filter.
   * @param request Page size and opaque continuation from a previous page.
   * @param actorContext Signal metadata captured before provider work.
   * @returns Retained entries with the next cursor when older entries remain.
   */
  async readBound<Id>(
    binding: AgentHistoryBinding<Id>,
    view: AgentHistoryView,
    request: HistoryRead,
    actorContext?: ActorContext,
  ): Promise<HistoryPage<AgentHistoryEntry>> {
    const capturedRequest = {
      pageSize: request.pageSize,
      ...(request.cursor === undefined
        ? {}
        : { cursor: clone(AgentHistoryCursorSchema, request.cursor) }),
    };
    const capturedView =
      view.kind === "conversation"
        ? {
            kind: "conversation" as const,
            conversation: clone(ConversationIdSchema, view.conversation),
          }
        : view;
    const onRead = () =>
      AgentHistoryPages.readBound(binding, capturedView, capturedRequest, actorContext);
    return binding.onAdmit === undefined ? onRead() : binding.onAdmit(onRead);
  },
});

/**
 * Loads and presents complete provider pages at the protected read boundary.
 */
const AgentHistoryPages = Object.freeze({
  /**
   * Reads and presents one complete protected Agent history page.
   * @typeParam Id Typed Agent identifier.
   * @param binding Captured Agent history binding.
   * @param view Indexed history category.
   * @param request Requested page and continuation.
   * @param actorContext Signal metadata captured when protected read began.
   * @returns Complete protected page.
   */
  async readBound<Id>(
    binding: AgentHistoryBinding<Id>,
    view: AgentHistoryView,
    request: HistoryRead,
    actorContext?: ActorContext,
  ): Promise<HistoryPage<AgentHistoryEntry>> {
    if (!Number.isSafeInteger(request.pageSize) || request.pageSize <= 0)
      throw new RangeError("Agent history pageSize must be a positive safe integer.");
    const maxBytes = this.limit(binding.maxBytes);
    const after = AgentHistoryCursorValues.decode(
      request.cursor?.value,
      binding.scope,
      view,
      maxBytes,
    );
    const live = (): Promise<AgentHistoryPage> =>
      this.load(binding, view, request, after, maxBytes);
    const present = (page: AgentHistoryPage): Promise<HistoryPage<AgentHistoryEntry>> => {
      const result = this.present(binding.scope, view, page);
      return binding.filterPage === undefined
        ? Promise.resolve(result)
        : binding.filterPage(result, view, request, actorContext);
    };
    return binding.interceptRead === undefined
      ? present(await live())
      : binding.interceptRead(binding.scope, request, live, maxBytes, present);
  },

  /**
   * Loads a scoped provider page after validating the request.
   *
   * @typeParam Id Typed Agent identifier.
   * @param binding Repository storage binding.
   * @param view Indexed history view.
   * @param request Public read request.
   * @param after Validated continuation key.
   * @param maxBytes Response byte limit.
   * @returns Complete provider page.
   */
  load<Id>(
    binding: AgentHistoryBinding<Id>,
    view: AgentHistoryView,
    request: HistoryRead,
    after: AgentHistoryOrderKey | undefined,
    maxBytes: number | undefined,
  ): Promise<AgentHistoryPage> {
    return binding.storage.read({
      entityId: binding.entityId,
      view,
      ...(after === undefined ? {} : { after }),
      count: request.pageSize,
      ...(maxBytes === undefined ? {} : { maxBytes }),
    });
  },

  /**
   * Validates a supplied byte budget before live or intercepted reads.
   *
   * @param configured Optional runtime byte limit.
   * @returns Validated byte limit.
   */
  limit(configured: number | undefined): number | undefined {
    if (configured !== undefined && (!Number.isSafeInteger(configured) || configured <= 0))
      throw new RangeError("Agent history maxBytes must be a positive safe integer.");
    return configured;
  },

  /**
   * Converts the complete page into the public cursor shape.
   *
   * @param scope Exact Agent repository scope.
   * @param view Indexed history view.
   * @param page Complete provider page.
   * @returns Public page with a bound continuation cursor.
   */
  present(
    scope: AgentHistoryScope,
    view: AgentHistoryView,
    page: AgentHistoryPage,
  ): HistoryPage<AgentHistoryEntry> {
    const last = page.entries.at(-1);
    if (page.hasMore && last === undefined)
      throw new Error("Agent history provider returned an empty continuation.");
    return {
      items: page.entries,
      ...(page.hasMore && last !== undefined
        ? {
            nextCursor: create(AgentHistoryCursorSchema, {
              value: AgentHistoryCursorValues.encode(scope, view, AgentHistoryKeys.fromEntry(last)),
            }),
          }
        : {}),
    };
  },
});

/**
 * Encodes the complete existing-key continuation without allocating a position.
 */
const AgentHistoryCursorValues = Object.freeze({
  /**
   * Returns an opaque versioned cursor for one view and scope.
   *
   * @param scope Exact repository and Agent scope.
   * @param view Indexed history view.
   * @param key Complete last key.
   * @returns Opaque cursor bytes.
   */
  encode(scope: AgentHistoryScope, view: AgentHistoryView, key: AgentHistoryOrderKey): string {
    const payload = {
      version: 1,
      scope,
      method: view.kind,
      conversation: view.kind === "conversation" ? view.conversation.value : null,
      seconds: key.occurredAt.seconds.toString(),
      nanos: key.occurredAt.nanos,
      category: key.category,
      recordId: key.recordId,
    };
    return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  },

  /**
   * Rejects malformed and cross-scope cursors before a provider read.
   *
   * @param value Cursor bytes, when continuing.
   * @param scope Exact repository and Agent scope.
   * @param view Indexed history view.
   * @param maxBytes Maximum serialized page bytes.
   * @returns Complete last key, when continuing.
   */
  decode(
    value: string | undefined,
    scope: AgentHistoryScope,
    view: AgentHistoryView,
    maxBytes: number | undefined,
  ): AgentHistoryOrderKey | undefined {
    if (value === undefined) return undefined;
    try {
      if (maxBytes !== undefined && value.length > this.maxLength(scope, view, maxBytes))
        throw new Error();
      const cursor = this.parse(value);
      if (
        cursor.version !== 1 ||
        cursor.method !== view.kind ||
        cursor.conversation !== (view.kind === "conversation" ? view.conversation.value : null) ||
        JSON.stringify(cursor.scope) !== JSON.stringify(scope)
      )
        throw new Error();
      const key = this.key(cursor);
      if (view.kind !== "full" && key.category !== view.kind) throw new Error();
      return key;
    } catch {
      throw new TypeError("Invalid Agent history cursor for this repository view.");
    }
  },

  /**
   * Calculates a bound for a full byte-budget key, JSON escapes, and the actual scope.
   *
   * @param scope Exact repository and Agent scope.
   * @param view Indexed history view.
   * @param maxBytes Maximum serialized page bytes.
   * @returns Maximum encoded cursor character count.
   */
  maxLength(scope: AgentHistoryScope, view: AgentHistoryView, maxBytes: number): number {
    const scopeBytes = Buffer.byteLength(JSON.stringify(scope), "utf8");
    const conversation = view.kind === "conversation" ? view.conversation.value : null;
    const viewBytes = Buffer.byteLength(JSON.stringify(conversation), "utf8");
    const rawBytes = maxBytes * 6 + scopeBytes + viewBytes + 256;
    return Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(rawBytes / 3) * 4);
  },

  /**
   * Decodes exact versioned payload fields.
   *
   * @param value Opaque cursor bytes.
   * @returns Parsed cursor fields.
   */
  parse(value: string): Record<string, unknown> {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const raw = Buffer.from(value, "base64url").toString("utf8");
    if (Buffer.from(raw, "utf8").toString("base64url") !== value) throw new Error();
    const data: unknown = JSON.parse(raw);
    if (data === null || typeof data !== "object") throw new Error();
    const cursor = data as Record<string, unknown>;
    if (
      Object.keys(cursor).sort().join(",") !==
      "category,conversation,method,nanos,recordId,scope,seconds,version"
    )
      throw new Error();
    return cursor;
  },

  /**
   * Restores and validates the complete continuation key.
   *
   * @param cursor Parsed cursor fields.
   * @returns Complete continuation key.
   */
  key(cursor: Record<string, unknown>): AgentHistoryOrderKey {
    if (
      typeof cursor.seconds !== "string" ||
      !/^-?(0|[1-9][0-9]*)$/.test(cursor.seconds) ||
      typeof cursor.nanos !== "number" ||
      typeof cursor.recordId !== "string" ||
      (cursor.category !== "conversation" &&
        cursor.category !== "system" &&
        cursor.category !== "domain")
    )
      throw new Error();
    const key: AgentHistoryOrderKey = {
      occurredAt: create(TimestampSchema, { seconds: BigInt(cursor.seconds), nanos: cursor.nanos }),
      category: cursor.category,
      recordId: cursor.recordId,
    };
    AgentHistoryKeys.indexValue(key);
    return key;
  },
});
