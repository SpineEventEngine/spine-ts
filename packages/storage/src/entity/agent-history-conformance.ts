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

import { create, toBinary } from "@bufbuild/protobuf";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { TenantIdSchema } from "@spine-event-engine/proto";
import {
  AgentHistoryEntrySchema,
  ConversationIdSchema,
  type AgentHistoryEntry,
} from "@spine-event-engine/proto/agent";

import {
  AgentHistoryKeys,
  type AgentHistoryOrderKey,
  type AgentHistoryStorage,
  type AgentHistoryStorageInput,
  type AgentHistoryView,
} from "./agent-history.js";

/**
 * Supplies domain-correct Proto entries and real provider handles to shared checks.
 */
export interface AgentHistoryConformanceAdapter {
  /**
   * Repository and tenant scope used as the baseline.
   */
  readonly scope: AgentHistoryStorageInput<string>;

  /**
   * Opens a provider handle for a repository scope.
   *
   * @param input Context, state type, and typed ID scope.
   * @returns Provider history handle.
   */
  readonly open: (input: AgentHistoryStorageInput<string>) => AgentHistoryStorage<string>;

  /**
   * Builds a typed model request history entry.
   *
   * @param id Immutable record ID.
   * @param conversation Conversation ID value.
   * @param time Original occurrence time.
   * @returns Complete request history entry.
   */
  readonly conversation: (id: string, conversation: string, time: Timestamp) => AgentHistoryEntry;

  /**
   * Builds a typed model response history entry.
   *
   * @param id Immutable record ID.
   * @param conversation Conversation ID value.
   * @param time Original occurrence time.
   * @returns Complete response history entry.
   */
  readonly response: (id: string, conversation: string, time: Timestamp) => AgentHistoryEntry;

  /**
   * Builds a canonical Agent System Event envelope.
   *
   * @param id Original Event ID.
   * @param time Original occurrence time.
   * @returns Complete System Event history entry.
   */
  readonly system: (id: string, time: Timestamp) => AgentHistoryEntry;

  /**
   * Builds a canonical Agent domain Event envelope.
   *
   * @param id Original Event ID.
   * @param time Original occurrence time.
   * @returns Complete domain Event history entry.
   */
  readonly domain: (id: string, time: Timestamp) => AgentHistoryEntry;

  /**
   * Builds a full-precision occurrence time.
   *
   * @param seconds Complete Timestamp seconds.
   * @param nanos Nanoseconds within the second.
   * @returns Original occurrence time.
   */
  readonly occurredAt: (seconds: bigint, nanos?: number) => Timestamp;
}

/**
 * Shared assertions that each Agent history provider must satisfy.
 */
export interface AgentHistoryConformanceChecks {
  /**
   * Checks provider Agent history behavior.
   *
   * @param adapter Real provider handle and domain fixtures.
   * @returns Completes after all checks pass.
   */
  check(adapter: AgentHistoryConformanceAdapter): Promise<void>;
}

/**
 * Runs provider-neutral Agent history ordering, paging, and retention checks.
 */
export const AgentHistoryConformance: AgentHistoryConformanceChecks = Object.freeze({
  /**
   * Checks all four views, bounded continuations, scopes, and immutable appends.
   *
   * @param adapter Real provider handle and domain-correct fixtures.
   */
  async check(adapter: AgentHistoryConformanceAdapter): Promise<void> {
    await Checks.views(adapter);
    await Checks.categoryPages(adapter);
    await Checks.orderingEdges(adapter);
    await Checks.pages(adapter);
    await Checks.bytes(adapter);
    await Checks.duplicates(adapter);
    await Checks.scopes(adapter);
    await Checks.live(adapter);
    await Checks.unrelatedIds(adapter);
    await Checks.invalid(adapter);
    await Checks.invalidViews(adapter);
  },
});

/**
 * Shared provider assertions kept separate from provider production code.
 */
const Checks = Object.freeze({
  /**
   * Checks one-category UTF-8 ID order and complete Timestamp boundaries through provider reads.
   *
   * @param adapter Provider handles and domain fixtures.
   * @returns Completes after count-one continuations preserve canonical order.
   */
  async orderingEdges(adapter: AgentHistoryConformanceAdapter): Promise<void> {
    const storage = adapter.open(adapter.scope);
    const same = adapter.occurredAt(12n, 345678901);
    const expected = [
      adapter.domain("maximum", adapter.occurredAt(253402300799n, 999999999)),
      adapter.domain("a", same),
      adapter.domain("aa", same),
      adapter.domain("z", same),
      adapter.domain("é", same),
      adapter.domain("minimum", adapter.occurredAt(-62135596800n)),
    ];
    try {
      for (const entry of [...expected].reverse()) await storage.append("ticket-utf8-order", entry);
      await this.countOnePages(storage, "ticket-utf8-order", expected);
    } finally {
      storage.close();
    }
  },

  /**
   * Checks exact content and identity through every one-entry provider continuation.
   *
   * @param storage Populated provider history handle.
   * @param entityId Target Agent ID.
   * @param expected Entries in canonical newest-first order.
   * @returns Completes after every boundary and the terminal page are checked.
   */
  async countOnePages(
    storage: AgentHistoryStorage<string>,
    entityId: string,
    expected: readonly AgentHistoryEntry[],
  ): Promise<void> {
    let after: AgentHistoryOrderKey | undefined;
    for (const [index, entry] of expected.entries()) {
      const page = await this.read(storage, entityId, { kind: "domain" }, 1, after);
      const actual = this.required(page.entries[0]);
      this.assertEntries(
        [actual],
        [entry],
        "count-one pages must preserve UTF-8 order and content",
      );
      this.assert(
        page.hasMore === index < expected.length - 1,
        "count-one page continuation is wrong",
      );
      after = AgentHistoryKeys.fromEntry(actual);
    }
    const terminal = await this.read(storage, entityId, { kind: "domain" }, 1, after);
    this.assert(terminal.entries.length === 0 && !terminal.hasMore, "ordered pages must terminate");
  },

  /**
   * Checks one-entry pages across category and time ties.
   *
   * @param adapter Provider handles and domain fixtures.
   * @returns Completes after page order is verified.
   */
  async categoryPages(adapter: AgentHistoryConformanceAdapter): Promise<void> {
    const storage = adapter.open(adapter.scope);
    const time = adapter.occurredAt(10n, 123456789);
    try {
      await storage.append("ticket-category-pages", adapter.domain("same", time));
      await storage.append("ticket-category-pages", adapter.system("same", time));
      await storage.append("ticket-category-pages", adapter.conversation("same", "reply", time));
      await storage.append(
        "ticket-category-pages",
        adapter.domain("newer", adapter.occurredAt(10n, 123456790)),
      );
      const expected = ["domain:newer", "conversation:same", "system:same", "domain:same"];
      let after: AgentHistoryOrderKey | undefined;
      for (const [index, identity] of expected.entries()) {
        const page = await this.read(storage, "ticket-category-pages", { kind: "full" }, 1, after);
        const entry = this.required(page.entries[0]);
        after = AgentHistoryKeys.fromEntry(entry);
        this.assert(
          `${after.category}:${after.recordId}` === identity &&
            page.hasMore === index < expected.length - 1,
          "one-entry continuations must preserve submillisecond and category order",
        );
      }
      this.assert(
        (await this.read(storage, "ticket-category-pages", { kind: "full" }, 1, after)).entries
          .length === 0,
        "a completed continuation must return an empty page",
      );
    } finally {
      storage.close();
    }
  },

  /**
   * Checks full and filtered Agent history views.
   *
   * @param adapter Provider handles and domain fixtures.
   * @returns Completes after view contents are verified.
   */
  async views(adapter: AgentHistoryConformanceAdapter): Promise<void> {
    const storage = adapter.open(adapter.scope);
    const time = adapter.occurredAt(9n, 123456789);
    const entries = [
      adapter.domain("domain", time),
      adapter.system("system", time),
      adapter.conversation("c2", "conversation-two", time),
      adapter.conversation("c1", "conversation-one", time),
    ];
    try {
      for (const entry of entries) await storage.append("ticket-views", entry);
      const full = await this.read(storage, "ticket-views", { kind: "full" }, 10);
      this.assertEntries(
        full.entries,
        [entries[3], entries[2], entries[1], entries[0]],
        "full history must preserve all original entries in category and ID order",
      );
      const system = await this.read(storage, "ticket-views", { kind: "system" }, 10);
      this.assertEntries(
        system.entries,
        [entries[1]],
        "System view must retain its original Event",
      );
      const domain = await this.read(storage, "ticket-views", { kind: "domain" }, 10);
      this.assertEntries(
        domain.entries,
        [entries[0]],
        "domain view must retain its original Event",
      );
      await this.conversationViews(storage, [entries[3], entries[2]]);
    } finally {
      storage.close();
    }
  },

  /**
   * Checks isolation of individual conversations.
   *
   * @param storage Open provider history handle.
   * @param expected Original entries for conversation one and two.
   * @returns Completes after conversation views are verified.
   */
  async conversationViews(
    storage: AgentHistoryStorage<string>,
    expected: readonly (AgentHistoryEntry | undefined)[],
  ): Promise<void> {
    const view = (id: string): AgentHistoryView => ({
      kind: "conversation",
      conversation: create(ConversationIdSchema, { value: id }),
    });
    const first = await this.read(storage, "ticket-views", view("conversation-one"), 10);
    this.assertEntries(
      first.entries,
      [expected[0]],
      "conversation one must retain its original exchange",
    );
    const second = await this.read(storage, "ticket-views", view("conversation-two"), 10);
    this.assertEntries(
      second.entries,
      [expected[1]],
      "conversation two must retain its original exchange",
    );
    const empty = await this.read(storage, "ticket-views", view("unused"), 10);
    this.assert(
      empty.entries.length === 0 && !empty.hasMore,
      "an unused conversation must have an empty terminal page",
    );
  },

  /**
   * Checks page sizes above one hundred.
   *
   * @param adapter Provider handles and domain fixtures.
   * @returns Completes after pages are populated and checked.
   */
  async pages(adapter: AgentHistoryConformanceAdapter): Promise<void> {
    const storage = adapter.open(adapter.scope);
    const time = adapter.occurredAt(8n, 999999999);
    try {
      for (let index = 0; index < 250; index += 1)
        await storage.append(
          "ticket-pages",
          adapter.domain(`event-${String(index).padStart(3, "0")}`, time),
        );
      await this.pageContinuation(storage);
    } finally {
      storage.close();
    }
  },

  /**
   * Checks changing page sizes across a continuation.
   *
   * @param storage Populated provider history handle.
   * @returns Completes after all entries are reached.
   */
  async pageContinuation(storage: AgentHistoryStorage<string>): Promise<void> {
    const first = await this.read(storage, "ticket-pages", { kind: "full" }, 1);
    this.assert(first.entries.length === 1 && first.hasMore, "page size one must continue");
    const second = await this.read(
      storage,
      "ticket-pages",
      { kind: "full" },
      137,
      AgentHistoryKeys.fromEntry(this.required(first.entries[0])),
    );
    this.assert(
      second.entries.length === 137 && second.hasMore,
      "requested counts above 100 must not be truncated",
    );
    const last = await this.read(
      storage,
      "ticket-pages",
      { kind: "full" },
      200,
      AgentHistoryKeys.fromEntry(this.required(second.entries.at(-1))),
    );
    this.assert(
      last.entries.length === 112 && !last.hasMore,
      "changed page sizes must reach every older entry once",
    );
  },

  /**
   * Checks byte-bounded history pages.
   *
   * @param adapter Provider handles and domain fixtures.
   * @returns Completes after byte bounds are checked.
   */
  async bytes(adapter: AgentHistoryConformanceAdapter): Promise<void> {
    const storage = adapter.open(adapter.scope);
    const time = adapter.occurredAt(7n);
    const first = adapter.conversation("a", "bytes", time);
    const second = adapter.response("b", "bytes", time);
    const size = toBinary(AgentHistoryEntrySchema, first).length;
    try {
      await storage.append("ticket-bytes", first);
      await storage.append("ticket-bytes", second);
      await this.byteContinuation(storage, size, first, second);
    } finally {
      storage.close();
    }
  },

  /**
   * Checks a byte-limited page and continuation.
   *
   * @param storage Populated provider history handle.
   * @param size Serialized first-entry byte length.
   * @param first Original model request entry.
   * @param second Original model response entry.
   * @returns Completes after continuation and failure are checked.
   */
  async byteContinuation(
    storage: AgentHistoryStorage<string>,
    size: number,
    first: AgentHistoryEntry,
    second: AgentHistoryEntry,
  ): Promise<void> {
    const request = { entityId: "ticket-bytes", view: { kind: "full" } as const, count: 2 };
    const page = await storage.read({ ...request, maxBytes: size });
    this.assert(
      page.entries.length === 1 && page.hasMore,
      "byte-limited pages must return a nonempty continuation",
    );
    this.assertEntries(page.entries, [first], "request page must retain exact content");
    const next = await this.read(
      storage,
      "ticket-bytes",
      { kind: "full" },
      2,
      AgentHistoryKeys.fromEntry(this.required(page.entries[0])),
    );
    this.assert(
      next.entries.length === 1 && !next.hasMore,
      "byte continuation must reach the next entry",
    );
    this.assertEntries(next.entries, [second], "response page must retain exact content");
    await this.rejects(
      storage.read({ ...request, maxBytes: size - 1 }),
      "oversized first item must fail explicitly",
    );
  },

  /**
   * Checks immutable repeat and conflict handling.
   *
   * @param adapter Provider handles and domain fixtures.
   * @returns Completes after duplicate behavior is checked.
   */
  async duplicates(adapter: AgentHistoryConformanceAdapter): Promise<void> {
    const storage = adapter.open(adapter.scope);
    const original = adapter.domain("same-event", adapter.occurredAt(6n, 1));
    try {
      await storage.append("ticket-duplicate", original);
      await storage.append("ticket-duplicate", original);
      await this.rejects(
        storage.append("ticket-duplicate", adapter.domain("same-event", adapter.occurredAt(6n, 2))),
        "same category and record ID with different content must fail",
      );
      const page = await this.read(storage, "ticket-duplicate", { kind: "full" }, 10);
      this.assert(
        page.entries.length === 1 && page.entries[0]?.occurredAt?.nanos === 1,
        "identical duplicate append must retain the original occurrence exactly",
      );
    } finally {
      storage.close();
    }
  },

  /**
   * Checks Agent ID, state type, and tenant isolation.
   *
   * @param adapter Provider handles and domain fixtures.
   * @returns Completes after scope isolation is checked.
   */
  async scopes(adapter: AgentHistoryConformanceAdapter): Promise<void> {
    const first = adapter.open(adapter.scope);
    const otherType = adapter.open({
      ...adapter.scope,
      stateType: `${adapter.scope.stateType}.Other`,
    });
    const tenantA = adapter.open(this.tenantScope(adapter.scope, "tenant-a"));
    const tenantB = adapter.open(this.tenantScope(adapter.scope, "tenant-b"));
    try {
      await first.append("ticket-scope", adapter.system("scope-event", adapter.occurredAt(5n)));
      await tenantA.append("ticket-scope", adapter.system("tenant-event", adapter.occurredAt(5n)));
      this.assert(
        (await this.read(tenantA, "ticket-scope", { kind: "full" }, 1)).entries.length === 1,
        "selected tenant must retain its own history",
      );
      for (const storage of [otherType, tenantB])
        this.assert(
          (await this.read(storage, "ticket-scope", { kind: "full" }, 1)).entries.length === 0,
          "state type and tenant must isolate history",
        );
      this.assert(
        (await this.read(first, "other-ticket", { kind: "full" }, 1)).entries.length === 0,
        "typed Agent ID must isolate history",
      );
    } finally {
      first.close();
      otherType.close();
      tenantA.close();
      tenantB.close();
    }
  },

  /**
   * Builds a complete tenant boundary.
   *
   * @param scope Baseline repository scope.
   * @param value Tenant ID value.
   * @returns Scoped provider input.
   */
  tenantScope(
    scope: AgentHistoryStorageInput<string>,
    value: string,
  ): AgentHistoryStorageInput<string> {
    return {
      ...scope,
      context: {
        name: "Support",
        multitenant: true,
        tenantId: create(TenantIdSchema, { kind: { case: "value", value } }),
      },
    };
  },

  /**
   * Checks live continuation after reopening a handle.
   *
   * @param adapter Provider handles and domain fixtures.
   * @returns Completes after retained entries are checked.
   */
  async live(adapter: AgentHistoryConformanceAdapter): Promise<void> {
    const storage = adapter.open(adapter.scope);
    const view = { kind: "full" } as const;
    await storage.append("ticket-live", adapter.domain("middle", adapter.occurredAt(4n)));
    const first = await this.read(storage, "ticket-live", view, 1);
    await storage.append("ticket-live", adapter.domain("new", adapter.occurredAt(5n)));
    await storage.append("ticket-live", adapter.domain("old", adapter.occurredAt(3n)));
    storage.close();
    const reopened = adapter.open(adapter.scope);
    try {
      const continued = await this.read(
        reopened,
        "ticket-live",
        view,
        10,
        AgentHistoryKeys.fromEntry(this.required(first.entries[0])),
      );
      this.assert(
        continued.entries.length === 1 &&
          AgentHistoryKeys.fromEntry(this.required(continued.entries[0])).recordId === "old",
        "live continuation must include later older inserts but skip newer inserts",
      );
      const current = await this.read(reopened, "ticket-live", view, 10);
      this.assert(
        AgentHistoryKeys.fromEntry(this.required(current.entries[0])).recordId === "new",
        "reopening must retain history without promising process restart durability",
      );
    } finally {
      reopened.close();
    }
  },

  /**
   * Checks target Agent isolation among many unrelated IDs.
   *
   * @param adapter Provider handles and domain fixtures.
   * @returns Completes after the target view is checked.
   */
  async unrelatedIds(adapter: AgentHistoryConformanceAdapter): Promise<void> {
    const storage = adapter.open(adapter.scope);
    const time = adapter.occurredAt(2n);
    try {
      for (let index = 0; index < 1200; index += 1)
        await storage.append(
          `unrelated-${String(index)}`,
          adapter.domain(`unrelated-${String(index)}`, time),
        );
      const first = adapter.domain("target-a", time);
      const second = adapter.domain("target-b", time);
      await storage.append("ticket-indexed", first);
      await storage.append("ticket-indexed", second);
      const page = await this.read(storage, "ticket-indexed", { kind: "domain" }, 1);
      this.assertEntries(page.entries, [first], "target page must omit unrelated Agent entries");
      this.assert(page.hasMore, "target page must continue to its second entry");
      const next = await this.read(
        storage,
        "ticket-indexed",
        { kind: "domain" },
        1,
        AgentHistoryKeys.fromEntry(this.required(page.entries[0])),
      );
      this.assertEntries(next.entries, [second], "target continuation must omit unrelated entries");
      this.assert(!next.hasMore, "target continuation must terminate");
    } finally {
      storage.close();
    }
  },

  /**
   * Checks invalid input and a closed handle.
   *
   * @param adapter Provider handles and domain fixtures.
   * @returns Completes after invalid requests reject.
   */
  async invalid(adapter: AgentHistoryConformanceAdapter): Promise<void> {
    const storage = adapter.open(adapter.scope);
    const time = adapter.occurredAt(1n);
    const mismatch = {
      ...adapter.domain("wrong-time", time),
      occurredAt: adapter.occurredAt(1n, 1),
    };
    try {
      await this.rejects(
        storage.append("ticket-invalid", mismatch),
        "wrapper and Event occurrence times must agree",
      );
      await this.rejects(
        storage.read({
          entityId: "ticket-invalid",
          view: { kind: "full" },
          count: 0,
          maxBytes: 100,
        }),
        "zero count must fail",
      );
      await this.rejects(
        storage.read({ entityId: "ticket-invalid", view: { kind: "full" }, count: 1, maxBytes: 0 }),
        "zero byte limit must fail",
      );
    } finally {
      storage.close();
    }
    await this.rejects(
      storage.append("ticket-invalid", adapter.domain("closed", time)),
      "closed handle must reject appends",
    );
  },

  /**
   * Checks absent conversation identity, incompatible boundaries, and handle validation.
   *
   * @param adapter Provider handles and domain fixtures.
   * @returns Completes after invalid requests reject.
   */
  async invalidViews(adapter: AgentHistoryConformanceAdapter): Promise<void> {
    const storage = adapter.open(adapter.scope);
    const time = adapter.occurredAt(1n);
    const view = { kind: "conversation" as const, conversation: create(ConversationIdSchema) };
    try {
      await this.rejects(
        storage.read({ entityId: "ticket-invalid", view, count: 1, maxBytes: 100 }),
        "conversation views require a nonempty ConversationId",
      );
      const after = AgentHistoryKeys.fromEntry(adapter.domain("boundary", time));
      await this.rejects(
        storage.read({
          entityId: "ticket-invalid",
          view: { kind: "system" },
          after,
          count: 1,
          maxBytes: 100,
        }),
        "category boundary must match its view",
      );
      await this.rejects(
        storage.read({ entityId: "", view: { kind: "full" }, count: 1, maxBytes: 100 }),
        "Agent ID is required",
      );
    } finally {
      storage.close();
    }
    await this.rejects(
      storage.read({ entityId: "ticket-invalid", view: { kind: "full" }, count: 1, maxBytes: 100 }),
      "closed handle must reject reads",
    );
  },

  /**
   * Reads a provider page with a generous byte budget.
   *
   * @param storage Open provider history handle.
   * @param entityId Target Agent ID.
   * @param view Selected history view.
   * @param count Maximum entries.
   * @param after Optional complete ordering-key boundary.
   * @returns Bounded provider page.
   */
  read(
    storage: AgentHistoryStorage<string>,
    entityId: string,
    view: AgentHistoryView,
    count: number,
    after?: AgentHistoryOrderKey,
  ) {
    return storage.read({
      entityId,
      view,
      count,
      maxBytes: 1_000_000,
      ...(after ? { after } : {}),
    });
  },

  /**
   * Returns an expected history page entry or throws.
   *
   * @param entry Possible page entry.
   * @returns Present history entry.
   */
  required(entry: AgentHistoryEntry | undefined): AgentHistoryEntry {
    if (entry === undefined) throw new Error("Agent history conformance expected a page entry.");
    return entry;
  },

  /**
   * Checks complete identities and serialized bytes against original entries.
   *
   * @param actual Provider-returned entries.
   * @param expected Original entries in expected order.
   * @param message Failure explanation.
   */
  assertEntries(
    actual: readonly AgentHistoryEntry[],
    expected: readonly (AgentHistoryEntry | undefined)[],
    message: string,
  ): void {
    this.assert(actual.length === expected.length, message);
    for (const [index, source] of expected.entries()) {
      const wanted = this.required(source);
      const returned = this.required(actual[index]);
      const wantedKey = AgentHistoryKeys.fromEntry(wanted);
      const returnedKey = AgentHistoryKeys.fromEntry(returned);
      this.assert(AgentHistoryKeys.compare(returnedKey, wantedKey) === 0, message);
      const left = toBinary(AgentHistoryEntrySchema, returned);
      const right = toBinary(AgentHistoryEntrySchema, wanted);
      this.assert(
        left.length === right.length && left.every((byte, offset) => byte === right[offset]),
        message,
      );
    }
  },

  /**
   * Asserts a provider-observed behavior.
   *
   * @param condition Whether the expected behavior held.
   * @param message Failure explanation.
   */
  assert(condition: boolean, message: string): void {
    if (!condition) throw new Error(`Agent history conformance: ${message}`);
  },

  /**
   * Asserts that an invalid operation rejects.
   *
   * @param operation Operation expected to reject.
   * @param message Failure explanation.
   * @returns Completes after rejection is observed.
   */
  async rejects(operation: Promise<unknown>, message: string): Promise<void> {
    try {
      await operation;
    } catch {
      return;
    }
    throw new Error(`Agent history conformance: ${message}`);
  },
});
