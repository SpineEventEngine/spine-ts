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

// @vitest-environment jsdom
import { create } from "@bufbuild/protobuf";
import type { ClientRequest, SubscriptionDelivery } from "@spine-event-engine/client-web";
import { AnyPacker } from "@spine-event-engine/core";
import { ReadBoardStats } from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/board_queries_app_query.js";
import {
  BoardIdSchema,
  BoardStatisticsViewSchema,
} from "@spine-event-engine/example-message-board-model/generated/spine/examples/messageboard/message_board_pb.js";
import {
  EntityStateUpdateSchema,
  EntityUpdatesSchema,
  QueryResponseSchema,
  SubscriptionUpdateSchema,
} from "@spine-event-engine/proto/client";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardStatisticsPanel, useBoardStatistics } from "../src/board-statistics.js";

describe("board statistics read and Topic lifecycle", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("ignores an old pending read after the board changes and aborts it", async () => {
    const old = Promise.withResolvers<unknown>();
    const next = statsResponse(2n, "restricted");
    const query = vi
      .fn()
      .mockImplementationOnce(() => old.promise)
      .mockResolvedValue(next);
    const request = requestFixture(query);
    const rendered = renderHook(({ board }) => useBoardStatistics(board, request), {
      initialProps: { board: "general" },
    });
    await waitFor(() => expect(query).toHaveBeenCalledOnce());
    const oldSignal = query.mock.calls[0]?.[1]?.signal as AbortSignal;
    rendered.rerender({ board: "restricted" });
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(rendered.result.current.value?.board?.messageCount).toBe(2n));
    expect(oldSignal.aborted).toBe(true);
    old.reject(new Error("superseded read"));
    await act(async () => old.promise.catch(() => undefined));
    expect(rendered.result.current.value?.board?.messageCount).toBe(2n);
  });

  it("shows a failed read and recovers after a live projection update", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const topic = topicFixture();
    const activation = Promise.withResolvers<void>();
    topic.subscription.activate.mockImplementation(() => activation.promise);
    const query = vi
      .fn()
      .mockRejectedValueOnce(new Error("read unavailable"))
      .mockResolvedValue(statsResponse(3n));
    const request = requestFixture(query, async () => topic.subscription);
    const rendered = renderHook(() => useBoardStatistics("general", request));
    await waitFor(() => expect(rendered.result.current.status).toBe("error"));
    expect(warning).toHaveBeenCalledWith("Board statistics read failed.", expect.any(Error));
    activation.resolve();
    await waitFor(() => expect(rendered.result.current.liveStatus).toBe("connected"));
    await waitFor(() => expect(rendered.result.current.value?.board?.messageCount).toBe(3n));
    const before = query.mock.calls.length;
    topic.emit(statisticsUpdate("general"));
    await waitFor(() => expect(query).toHaveBeenCalledTimes(before + 1));
    topic.emit({ kind: "resynchronization", response: create(QueryResponseSchema) });
    await waitFor(() => expect(query).toHaveBeenCalledTimes(before + 2));
    topic.end();
    await waitFor(() => expect(rendered.result.current.liveStatus).toBe("error"));
    expect(topic.subscription.cancel).toHaveBeenCalled();
  });

  it("cancels a Topic created after unmount without activating it", async () => {
    const pending = Promise.withResolvers<unknown>();
    const topic = topicFixture();
    const request = requestFixture(
      vi.fn().mockResolvedValue(statsResponse(0n)),
      () => pending.promise,
    );
    const rendered = renderHook(() => useBoardStatistics("general", request));
    await waitFor(() => expect(request.createSubscription).toHaveBeenCalledOnce());
    rendered.unmount();
    pending.resolve(topic.subscription);
    await act(async () => pending.promise);
    await waitFor(() => expect(topic.subscription.cancel).toHaveBeenCalled());
    expect(topic.subscription.activate).not.toHaveBeenCalled();
  });

  it("does not refresh after activation completes for an unmounted board", async () => {
    const pending = Promise.withResolvers<void>();
    const topic = topicFixture();
    topic.subscription.activate.mockImplementation(() => pending.promise);
    const query = vi.fn().mockResolvedValue(statsResponse(1n));
    const request = requestFixture(query, async () => topic.subscription);
    const rendered = renderHook(() => useBoardStatistics("general", request));
    await waitFor(() => expect(topic.subscription.activate).toHaveBeenCalledOnce());
    await waitFor(() => expect(query).toHaveBeenCalledOnce());
    rendered.unmount();
    pending.resolve();
    await act(async () => pending.promise);
    await waitFor(() => expect(topic.subscription.cancel).toHaveBeenCalled());
    expect(query).toHaveBeenCalledOnce();
  });

  it("suppresses a late activation failure after the board unmounts", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const pending = Promise.withResolvers<void>();
    const topic = topicFixture();
    topic.subscription.activate.mockImplementation(() => pending.promise);
    const request = requestFixture(
      vi.fn().mockResolvedValue(statsResponse(1n)),
      async () => topic.subscription,
    );
    const rendered = renderHook(() => useBoardStatistics("general", request));
    await waitFor(() => expect(topic.subscription.activate).toHaveBeenCalledOnce());
    rendered.unmount();
    pending.reject(new Error("activation failed after unmount"));
    await pending.promise.catch(() => undefined);
    await waitFor(() => expect(topic.subscription.cancel).toHaveBeenCalled());
    expect(warning).not.toHaveBeenCalledWith(
      "Board statistics live updates failed.",
      expect.anything(),
    );
  });

  it("shows an absent summary separately from a summary without a first timestamp", () => {
    const mounted = render(
      createElement(BoardStatisticsPanel, {
        value: create(ReadBoardStats.responseSchema, {
          board: {
            board: create(BoardIdSchema, { value: "general" }),
            messageCount: 2n,
            authorCount: 1n,
          },
        }),
        status: "ready",
        liveStatus: "connected",
      }),
    );
    expect(screen.getByText(/2 messages · 1 distinct authors/u)).toBeTruthy();
    expect(screen.queryByText(/First post/u)).toBeNull();
    expect(screen.getByText("No visible activity yet")).toBeTruthy();
    mounted.rerender(
      createElement(BoardStatisticsPanel, {
        value: create(ReadBoardStats.responseSchema, {
          board: {
            board: create(BoardIdSchema, { value: "general" }),
            messageCount: 2n,
            authorCount: 1n,
            firstPostedAt: { seconds: 1n },
          },
        }),
        status: "ready",
        liveStatus: "connected",
      }),
    );
    expect(screen.getByText(/First post/u)).toBeTruthy();
  });

  it("explains a failed authoritative statistics read", () => {
    render(
      createElement(BoardStatisticsPanel, {
        value: undefined,
        status: "error",
        liveStatus: "error",
      }),
    );
    expect(screen.getByRole("alert", { name: "Board statistics" }).textContent).toBe(
      "Statistics are unavailable.",
    );
  });
});

function statsResponse(count: bigint, board = "general") {
  return {
    message: [
      create(ReadBoardStats.responseSchema, {
        board: {
          board: create(BoardIdSchema, { value: board }),
          messageCount: count,
          authorCount: 1n,
        },
      }),
    ],
  };
}

function statisticsUpdate(board: string): SubscriptionDelivery {
  const id = create(BoardIdSchema, { value: board });
  return {
    kind: "update",
    update: create(SubscriptionUpdateSchema, {
      update: {
        case: "entityUpdates",
        value: create(EntityUpdatesSchema, {
          update: [
            create(EntityStateUpdateSchema, {
              id: AnyPacker.pack(BoardIdSchema, id),
              kind: {
                case: "state",
                value: AnyPacker.pack(
                  BoardStatisticsViewSchema,
                  create(BoardStatisticsViewSchema, { id, messageCount: 3n }),
                ),
              },
            }),
          ],
        }),
      },
    }),
  };
}

function requestFixture(
  query: ReturnType<typeof vi.fn>,
  createSubscription: () => Promise<unknown> = async () => topicFixture().subscription,
) {
  return {
    query,
    createSubscription: vi.fn(createSubscription),
  } as unknown as ClientRequest;
}

function topicFixture() {
  const waiting: ((value: IteratorResult<SubscriptionDelivery>) => void)[] = [];
  const updates: SubscriptionDelivery[] = [];
  let ended = false;
  const end = () => {
    ended = true;
    for (const resolve of waiting.splice(0)) resolve({ done: true, value: undefined });
  };
  return {
    subscription: {
      activate: vi.fn(async (): Promise<void> => undefined),
      cancel: vi.fn(async () => end()),
      updates: {
        [Symbol.asyncIterator]: () => ({
          next: () =>
            new Promise<IteratorResult<SubscriptionDelivery>>((resolve) => {
              const value = updates.shift();
              if (value !== undefined) resolve({ done: false, value });
              else if (ended) resolve({ done: true, value: undefined });
              else waiting.push(resolve);
            }),
        }),
      },
    },
    emit(value: SubscriptionDelivery) {
      const resolve = waiting.shift();
      if (resolve === undefined) updates.push(value);
      else resolve({ done: false, value });
    },
    end,
  };
}
