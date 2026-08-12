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
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  createElement,
  startTransition,
  StrictMode,
  Suspense,
  useEffect,
  useLayoutEffect,
} from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Subscription, SubscriptionDelivery } from "@spine-event-engine/client-web";

import {
  SpineClientProvider,
  type OnSubscriptionDelivery,
  useEntityQuery,
  useEntitySubscription,
  useEventSubscription,
  useRequest,
  useSpineClient,
  useSubscriptionDelivery,
  useSubscriptionLifecycle,
} from "../src/index.js";

describe("client-react", () => {
  afterEach(cleanup);
  it("starts an Entity query after render and publishes its response", async () => {
    const send = vi.fn(() => Promise.resolve({ message: [] }));
    function View() {
      const state = useEntityQuery(() => createQuery(), []);
      return createElement("output", undefined, state.status);
    }

    render(createElement(SpineClientProvider, { request: { send } as never }, createElement(View)));

    expect(send).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText("success")).toBeTruthy();
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("aborts a live generic request exactly once when its generation is cleaned up", async () => {
    const request = vi.fn((signal: AbortSignal) => {
      signal.addEventListener("abort", aborted);
      return new Promise<never>(() => undefined);
    });
    const aborted = vi.fn();
    function View() {
      useRequest(request, []);
      return null;
    }

    const rendered = render(createElement(View));
    await waitFor(() => {
      expect(request).toHaveBeenCalledTimes(1);
    });
    const signal = request.mock.calls[0]?.[0];
    expect(signal?.aborted).toBe(false);
    rendered.unmount();
    expect(signal?.aborted).toBe(true);
    expect(aborted).toHaveBeenCalledTimes(1);
  });

  it("forwards an Entity query signal and aborts its active request without late publication", async () => {
    const deferred = Promise.withResolvers<{ message: unknown[] }>();
    let active = 0;
    const send = vi.fn((_query: unknown, options: { signal: AbortSignal }) => {
      active++;
      options.signal.addEventListener("abort", () => active--, { once: true });
      return deferred.promise;
    });
    const published = vi.fn();
    function View() {
      const state = useEntityQuery(() => createQuery(), []);
      useEffect(() => {
        published(state.status);
      }, [state.status]);
      return null;
    }

    const rendered = render(
      createElement(SpineClientProvider, { request: { send } as never }, createElement(View)),
    );
    await waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1);
    });
    expect(send.mock.calls[0]?.[1]?.signal.aborted).toBe(false);
    expect(active).toBe(1);
    rendered.unmount();
    expect(send.mock.calls[0]?.[1]?.signal.aborted).toBe(true);
    expect(active).toBe(0);
    deferred.resolve({ message: [] });
    await Promise.resolve();
    expect(published).not.toHaveBeenCalledWith("success");
    expect(published).not.toHaveBeenCalledWith("error");
  });

  it("retains only the live Strict Mode query request and aborts it on final cleanup", async () => {
    let active = 0;
    const send = vi.fn((_query: unknown, options: { signal: AbortSignal }) => {
      active++;
      options.signal.addEventListener("abort", () => active--, { once: true });
      return new Promise<never>(() => undefined);
    });
    function View() {
      useEntityQuery(() => createQuery(), []);
      return null;
    }

    const rendered = render(
      createElement(
        StrictMode,
        undefined,
        createElement(SpineClientProvider, { request: { send } as never }, createElement(View)),
      ),
    );
    await waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1);
    });
    expect(active).toBe(1);
    rendered.unmount();
    expect(active).toBe(0);
  });

  it("aborts a retired dependency generation before starting its replacement", async () => {
    const signals: AbortSignal[] = [];
    const request = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<never>(() => undefined);
    });
    function View({ dependency }: { readonly dependency: number }) {
      useRequest(request, [dependency]);
      return null;
    }

    const rendered = render(createElement(View, { dependency: 1 }));
    await waitFor(() => {
      expect(request).toHaveBeenCalledTimes(1);
    });
    rendered.rerender(createElement(View, { dependency: 2 }));
    expect(signals[0]?.aborted).toBe(true);
    await waitFor(() => {
      expect(request).toHaveBeenCalledTimes(2);
    });
    expect(signals[1]?.aborted).toBe(false);
  });

  it("does not invoke a scheduled request after immediate unmount", async () => {
    const send = vi.fn(() => Promise.resolve({ message: [] }));
    function View() {
      useEntityQuery(() => createQuery(), []);
      return null;
    }
    const rendered = render(
      createElement(SpineClientProvider, { request: { send } as never }, createElement(View)),
    );
    rendered.unmount();
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();
  });

  it("does not invoke a scheduled subscription factory after immediate unmount", async () => {
    const createSubscription = vi.fn(() => Promise.resolve(subscription()));
    function View() {
      useEventSubscription(createSubscription, []);
      return null;
    }
    const rendered = render(createElement(View));
    rendered.unmount();
    await Promise.resolve();
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it("suppresses a late query completion after unmount", async () => {
    const deferred = Promise.withResolvers<{ message: unknown[] }>();
    const send = vi.fn(() => deferred.promise);
    const published = vi.fn();
    function View() {
      const state = useEntityQuery(() => createQuery(), []);
      useEffect(() => {
        published(state.status);
      }, [state.status]);
      return null;
    }
    const rendered = render(
      createElement(SpineClientProvider, { request: { send } as never }, createElement(View)),
    );
    await waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1);
    });
    rendered.unmount();
    deferred.resolve({ message: [] });
    await Promise.resolve();
    expect(published).not.toHaveBeenCalledWith("success");
  });

  it("suppresses a late query rejection after unmount", async () => {
    const deferred = Promise.withResolvers<never>();
    void deferred.promise.catch(() => undefined);
    const send = vi.fn(() => deferred.promise);
    const published = vi.fn();
    function View() {
      const state = useEntityQuery(() => createQuery(), []);
      useEffect(() => {
        published(state.status);
      }, [state.status]);
      return null;
    }
    const rendered = render(
      createElement(SpineClientProvider, { request: { send } as never }, createElement(View)),
    );
    await waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1);
    });
    rendered.unmount();
    deferred.reject(new Error("late failure"));
    await Promise.resolve();
    expect(published).not.toHaveBeenCalledWith("error");
  });

  it("publishes a query failure and rejects providerless client access", async () => {
    const failed = new Error("unavailable");
    function FailedView() {
      const state = useEntityQuery(() => createQuery(), []);
      return createElement("output", undefined, state.status);
    }
    function MissingProvider() {
      useSpineClient();
      return null;
    }
    render(
      createElement(
        SpineClientProvider,
        { request: { send: () => Promise.reject(failed) } as never },
        createElement(FailedView),
      ),
    );
    await waitFor(() => {
      expect(screen.getByText("error")).toBeTruthy();
    });
    expect(() => render(createElement(MissingProvider))).toThrow("SpineClientProvider");
  });

  it("activates once per live Strict Mode generation and cancels every retired handle", async () => {
    const first = subscription();
    const second = subscription();
    const pending = [first, second];
    const createSubscription = vi.fn(() => Promise.resolve(pending.shift() ?? second));
    function View() {
      useEventSubscription(() => createSubscription(), []);
      return null;
    }
    const rendered = render(createElement(StrictMode, undefined, createElement(View)));
    await waitFor(() => {
      expect(first.activate).toHaveBeenCalledTimes(1);
    });
    expect(second.activate).not.toHaveBeenCalled();
    rendered.unmount();
    await waitFor(() => {
      expect(first.cancel).toHaveBeenCalledTimes(1);
    });
  });

  it("publishes event gap lifecycle notices independently of deliveries", async () => {
    const handle = subscription();
    function View() {
      const state = useEventSubscription(() => Promise.resolve(handle), []);
      const lifecycle = useSubscriptionLifecycle(state);
      const delivery = useSubscriptionDelivery(state);
      return createElement(
        "output",
        undefined,
        `${lifecycle?.state ?? "none"}:${delivery?.kind ?? "none"}`,
      );
    }
    render(createElement(View));
    await waitFor(() => {
      expect(handle.activate).toHaveBeenCalledTimes(1);
    });
    await Promise.resolve();
    await Promise.resolve();
    handle.emitLifecycle({ state: "gapPossible", generation: 2 });
    handle.emitDelivery({ kind: "update", update: {} as never });
    await waitFor(() => {
      expect(screen.getByText("gapPossible:update")).toBeTruthy();
    });
  });

  it("renders authoritative Entity recovery while event gaps remain lifecycle-only", async () => {
    const entity = subscription();
    const event = subscription();
    const authoritativeQuery = vi.fn(createQuery);
    const createSubscription = vi.fn(
      (topic: unknown, options: { authoritativeQuery?: () => unknown }) => {
        if (options.authoritativeQuery !== undefined) {
          entity.recover = () => {
            options.authoritativeQuery?.();
            entity.emitDelivery({ kind: "resynchronization", response: { message: [] } as never });
          };
          return Promise.resolve(entity);
        }
        return Promise.resolve(event);
      },
    );
    function View() {
      const entityState = useEntitySubscription({} as never, authoritativeQuery, []);
      const eventState = useEventSubscription(() => createSubscription({}, {}), []);
      const entityDelivery = useSubscriptionDelivery(entityState);
      const eventLifecycle = useSubscriptionLifecycle(eventState);
      return createElement(
        "output",
        undefined,
        `${entityDelivery?.kind ?? "none"}:${eventLifecycle?.state ?? "none"}`,
      );
    }
    render(
      createElement(
        SpineClientProvider,
        { request: { createSubscription } as never },
        createElement(View),
      ),
    );
    await waitFor(() => {
      expect(entity.activate).toHaveBeenCalledTimes(1);
    });
    entity.recover?.();
    event.emitLifecycle({ state: "gapPossible", generation: 2 });
    await waitFor(() => {
      expect(screen.getByText("resynchronization:gapPossible")).toBeTruthy();
    });
    expect(authoritativeQuery).toHaveBeenCalledTimes(1);
  });

  it.each(["throw", "reject"] as const)(
    "contains %s cancellation while preserving fatal errors",
    async (mode) => {
      const handle = subscription({ cancelFailure: mode });
      function View() {
        const state = useEventSubscription(() => Promise.resolve(handle), []);
        return createElement("output", undefined, state.status);
      }
      const rendered = render(createElement(View));
      await waitFor(() => {
        expect(handle.activate).toHaveBeenCalledTimes(1);
      });
      handle.failDelivery(new Error("delivery fatal"));
      await waitFor(() => {
        expect(screen.getByText("error")).toBeTruthy();
      });
      expect(handle.cancel).toHaveBeenCalledTimes(1);
      rendered.unmount();
      expect(handle.cancel).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["activation", "delivery", "lifecycle"] as const)(
    "cancels exactly once for %s fatal failure",
    async (kind) => {
      const handle = subscription();
      if (kind === "activation")
        handle.activate.mockRejectedValueOnce(new Error("activation fatal"));
      function View() {
        const state = useEventSubscription(() => Promise.resolve(handle), []);
        return createElement("output", undefined, state.status);
      }
      render(createElement(View));
      await waitFor(() => {
        expect(handle.activate).toHaveBeenCalledTimes(1);
      });
      if (kind === "delivery") handle.failDelivery(new Error("delivery fatal"));
      if (kind === "lifecycle") handle.failLifecycle(new Error("lifecycle fatal"));
      await waitFor(() => {
        expect(screen.getByText("error")).toBeTruthy();
      });
      expect(handle.cancel).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["activation", "delivery", "lifecycle"] as const)(
    "preserves the %s fatal error across throwing and rejected cancellation",
    async (kind) => {
      for (const cancelFailure of ["throw", "reject"] as const) {
        const handle = subscription({ cancelFailure });
        const fatal = new Error(`${kind} fatal`);
        let observed: unknown;
        if (kind === "activation") handle.activate.mockRejectedValueOnce(fatal);
        function View() {
          const state = useEventSubscription(() => Promise.resolve(handle), []);
          useEffect(() => {
            observed = state.status === "error" ? state.error : undefined;
          }, [state]);
          return null;
        }
        const rendered = render(createElement(View));
        await waitFor(() => {
          expect(handle.activate).toHaveBeenCalledTimes(1);
        });
        if (kind === "delivery") handle.failDelivery(fatal);
        if (kind === "lifecycle") handle.failLifecycle(fatal);
        await waitFor(() => {
          expect(observed).toBe(fatal);
        });
        expect(handle.cancel).toHaveBeenCalledTimes(1);
        rendered.unmount();
        expect(handle.cancel).toHaveBeenCalledTimes(1);
      }
    },
  );

  it("cancels a subscription that resolves after its generation is retired", async () => {
    const deferred = Promise.withResolvers<ReturnType<typeof subscription>>();
    function View() {
      useEventSubscription(() => deferred.promise, []);
      return null;
    }
    const rendered = render(createElement(View));
    rendered.unmount();
    const late = subscription();
    deferred.resolve(late);
    await Promise.resolve();
    expect(late.cancel).not.toHaveBeenCalled();
    expect(late.activate).not.toHaveBeenCalled();
  });

  it("publishes an activation failure without starting stream readers", async () => {
    const handle = subscription();
    handle.activate.mockRejectedValueOnce(new Error("activation failed"));
    function View() {
      const state = useEventSubscription(() => Promise.resolve(handle), []);
      return createElement("output", undefined, state.status);
    }
    render(createElement(View));
    await waitFor(() => {
      expect(screen.getByText("error")).toBeTruthy();
    });
  });

  it("cancels after an activation that loses its generation", async () => {
    const activation = Promise.withResolvers<undefined>();
    const handle = subscription();
    handle.activate.mockReturnValueOnce(activation.promise);
    function View() {
      useEventSubscription(() => Promise.resolve(handle), []);
      return null;
    }
    const rendered = render(createElement(View));
    await waitFor(() => {
      expect(handle.activate).toHaveBeenCalledTimes(1);
    });
    rendered.unmount();
    activation.resolve(undefined);
    await waitFor(() => {
      expect(handle.cancel).toHaveBeenCalledTimes(1);
    });
  });

  it("creates Entity subscriptions with the public authoritative re-query contract", async () => {
    const handle = subscription();
    const createSubscription = vi.fn(() => Promise.resolve(handle));
    const request = { createSubscription } as never;
    const topic = {} as never;
    const authoritativeQuery = vi.fn(createQuery);
    function View() {
      useEntitySubscription(topic, authoritativeQuery, []);
      return null;
    }
    render(createElement(SpineClientProvider, { request }, createElement(View)));
    await waitFor(() => {
      expect(createSubscription).toHaveBeenCalledTimes(1);
    });
    expect(createSubscription).toHaveBeenCalledWith(topic, {
      kind: "entity",
      authoritativeQuery,
    });
    expect(authoritativeQuery).not.toHaveBeenCalled();
  });

  it("calls Entity delivery and lifecycle callbacks for every notice before coalescing", async () => {
    const handle = subscription();
    const createSubscription = vi.fn(() => Promise.resolve(handle));
    const request = { createSubscription } as never;
    const notices: string[] = [];
    function View() {
      useEntitySubscription(
        {} as never,
        createQuery,
        [],
        (delivery) => notices.push(`delivery:${delivery.kind}`),
        (lifecycle) => notices.push(`lifecycle:${lifecycle.state}`),
      );
      return null;
    }
    render(createElement(SpineClientProvider, { request }, createElement(View)));
    await waitFor(() => {
      expect(handle.activate).toHaveBeenCalledTimes(1);
    });
    await Promise.resolve();
    await Promise.resolve();
    handle.emitDelivery({ kind: "update", update: {} as never });
    handle.emitDelivery({ kind: "update", update: {} as never });
    handle.emitLifecycle({ state: "connecting", generation: 1, attempt: 0 });
    handle.emitLifecycle({ state: "connected", generation: 1 });
    await waitFor(() => {
      expect(notices.filter((notice) => notice.startsWith("delivery:"))).toEqual([
        "delivery:update",
        "delivery:update",
      ]);
      expect(notices.filter((notice) => notice.startsWith("lifecycle:"))).toEqual([
        "lifecycle:connecting",
        "lifecycle:connected",
      ]);
    });
  });

  it("uses a committed replacement callback without recreating its Entity subscription", async () => {
    const handle = subscription();
    const createSubscription = vi.fn(() => Promise.resolve(handle));
    const request = { createSubscription } as never;
    const first = vi.fn();
    const second = vi.fn();
    function View({ onDelivery }: { readonly onDelivery: OnSubscriptionDelivery }) {
      useEntitySubscription({} as never, createQuery, [], onDelivery);
      return null;
    }
    const rendered = render(
      createElement(SpineClientProvider, { request }, createElement(View, { onDelivery: first })),
    );
    await waitFor(() => {
      expect(handle.activate).toHaveBeenCalledTimes(1);
    });
    await Promise.resolve();
    await Promise.resolve();
    rendered.rerender(
      createElement(SpineClientProvider, { request }, createElement(View, { onDelivery: second })),
    );
    handle.emitDelivery({ kind: "update", update: {} as never });
    await waitFor(() => {
      expect(second).toHaveBeenCalledTimes(1);
    });
    expect(first).not.toHaveBeenCalled();
    expect(createSubscription).toHaveBeenCalledTimes(1);
  });

  it("keeps an active Entity handle bound to its committed callback during a suspended replacement", async () => {
    const handle = subscription();
    const createSubscription = vi.fn(() => Promise.resolve(handle));
    const request = { createSubscription } as never;
    const first = vi.fn();
    const second = vi.fn();
    const replacement = Promise.withResolvers<undefined>();
    const suspendedRender = Object.assign(new Error("Suspended replacement render."), {
      then: replacement.promise.then.bind(replacement.promise),
    });
    function View({
      onDelivery,
      suspended,
    }: {
      readonly onDelivery: OnSubscriptionDelivery;
      readonly suspended: boolean;
    }) {
      useEntitySubscription({} as never, createQuery, [], onDelivery);
      if (suspended) throw suspendedRender;
      return null;
    }
    const rendered = render(
      createElement(
        SpineClientProvider,
        { request },
        createElement(
          Suspense,
          { fallback: null },
          createElement(View, { onDelivery: first, suspended: false }),
        ),
      ),
    );
    await waitFor(() => {
      expect(handle.activate).toHaveBeenCalledTimes(1);
    });
    await Promise.resolve();
    await Promise.resolve();
    startTransition(() => {
      rendered.rerender(
        createElement(
          SpineClientProvider,
          { request },
          createElement(
            Suspense,
            { fallback: null },
            createElement(View, { onDelivery: second, suspended: true }),
          ),
        ),
      );
    });
    await Promise.resolve();
    await Promise.resolve();
    handle.emitDelivery({ kind: "update", update: {} as never });
    await waitFor(() => {
      expect(first).toHaveBeenCalledTimes(1);
    });
    expect(second).not.toHaveBeenCalled();
    replacement.resolve(undefined);
  });

  it("retires an old Entity handle before another layout effect can deliver into a new commit", async () => {
    const oldHandle = subscription({ cancelEnds: false });
    const nextHandle = subscription();
    const pending = [oldHandle, nextHandle];
    const createSubscription = vi.fn(() => Promise.resolve(pending.shift() ?? nextHandle));
    const request = { createSubscription } as never;
    const received: string[] = [];
    function View({ board }: { readonly board: string }) {
      useEntitySubscription({} as never, createQuery, [board], () => received.push(board));
      useLayoutEffect(() => {
        if (board === "board-b")
          oldHandle.emitDelivery({ kind: "resynchronization", response: {} as never });
      }, [board]);
      return null;
    }
    const rendered = render(
      createElement(SpineClientProvider, { request }, createElement(View, { board: "board-a" })),
    );
    await waitFor(() => {
      expect(oldHandle.activate).toHaveBeenCalledTimes(1);
    });
    await Promise.resolve();
    await Promise.resolve();
    rendered.rerender(
      createElement(SpineClientProvider, { request }, createElement(View, { board: "board-b" })),
    );
    await Promise.resolve();
    expect(received).toEqual([]);
  });

  it("does not invoke Entity callbacks after cleanup", async () => {
    const handle = subscription({ cancelEnds: false });
    const createSubscription = vi.fn(() => Promise.resolve(handle));
    const onDelivery = vi.fn();
    const onLifecycle = vi.fn();
    function View() {
      useEntitySubscription({} as never, createQuery, [], onDelivery, onLifecycle);
      return null;
    }
    const rendered = render(
      createElement(
        SpineClientProvider,
        { request: { createSubscription } as never },
        createElement(View),
      ),
    );
    await waitFor(() => {
      expect(handle.activate).toHaveBeenCalledTimes(1);
    });
    await Promise.resolve();
    await Promise.resolve();
    rendered.unmount();
    handle.emitDelivery({ kind: "update", update: {} as never });
    handle.emitLifecycle({ state: "gapPossible", generation: 1 });
    await Promise.resolve();
    expect(onDelivery).not.toHaveBeenCalled();
    expect(onLifecycle).not.toHaveBeenCalled();
  });

  it.each(["delivery", "lifecycle"] as const)(
    "publishes a throwing Entity %s callback error and cancels once",
    async (kind) => {
      const handle = subscription();
      const createSubscription = vi.fn(() => Promise.resolve(handle));
      const failure = new Error(`${kind} callback failed`);
      let observed: unknown;
      function View() {
        const state = useEntitySubscription(
          {} as never,
          createQuery,
          [],
          kind === "delivery"
            ? () => {
                throw failure;
              }
            : undefined,
          kind === "lifecycle"
            ? () => {
                throw failure;
              }
            : undefined,
        );
        useEffect(() => {
          observed = state.status === "error" ? state.error : undefined;
        }, [state]);
        return null;
      }
      render(
        createElement(
          SpineClientProvider,
          { request: { createSubscription } as never },
          createElement(View),
        ),
      );
      await waitFor(() => {
        expect(handle.activate).toHaveBeenCalledTimes(1);
      });
      await Promise.resolve();
      await Promise.resolve();
      if (kind === "delivery") handle.emitDelivery({ kind: "update", update: {} as never });
      else handle.emitLifecycle({ state: "gapPossible", generation: 1 });
      await waitFor(() => {
        expect(observed).toBe(failure);
      });
      expect(handle.cancel).toHaveBeenCalledTimes(1);
    },
  );

  it("publishes stream failures from either independent subscription iterator", async () => {
    const handle = subscription();
    function View() {
      const state = useEventSubscription(() => Promise.resolve(handle), []);
      return createElement("output", undefined, state.status);
    }
    render(createElement(View));
    await waitFor(() => {
      expect(handle.activate).toHaveBeenCalledTimes(1);
    });
    handle.failDelivery(new Error("delivery failed"));
    await waitFor(() => {
      expect(screen.getByText("error")).toBeTruthy();
    });
    handle.failLifecycle(new Error("lifecycle failed"));
  });

  it("does not publish late activation or stream failures from a retired generation", async () => {
    const activation = Promise.withResolvers<undefined>();
    const handle = subscription({ cancelEnds: false });
    handle.activate.mockReturnValueOnce(activation.promise);
    const published = vi.fn();
    function View() {
      const state = useEventSubscription(() => Promise.resolve(handle), []);
      useEffect(() => {
        published(state.status);
      }, [state.status]);
      return null;
    }
    const rendered = render(createElement(View));
    await waitFor(() => {
      expect(handle.activate).toHaveBeenCalledTimes(1);
    });
    rendered.unmount();
    activation.reject(new Error("late activation"));
    handle.emitDelivery({ kind: "update", update: {} as never });
    handle.failDelivery(new Error("late delivery"));
    handle.failLifecycle(new Error("late lifecycle"));
    await Promise.resolve();
    expect(published).not.toHaveBeenCalledWith("error");
  });

  it("suppresses late delivery and lifecycle iterator failures after cancellation", async () => {
    const handle = subscription({ cancelEnds: false });
    function View() {
      useEventSubscription(() => Promise.resolve(handle), []);
      return null;
    }
    const rendered = render(createElement(View));
    await waitFor(() => {
      expect(handle.activate).toHaveBeenCalledTimes(1);
    });
    rendered.unmount();
    handle.emitDelivery({ kind: "update", update: {} as never });
    handle.emitLifecycle({ state: "gapPossible", generation: 3 });
    await Promise.resolve();
    handle.failDelivery(new Error("late delivery"));
    handle.failLifecycle(new Error("late lifecycle"));
    await Promise.resolve();
  });
});

function createQuery() {
  return {} as never;
}

function subscription(
  options: { readonly cancelEnds?: boolean; readonly cancelFailure?: "throw" | "reject" } = {},
): Subscription & {
  activate: import("vitest").Mock<() => Promise<void>>;
  cancel: import("vitest").Mock<() => Promise<void>>;
  emitLifecycle(value: import("@spine-event-engine/client-web").SubscriptionLifecycle): void;
  emitDelivery(value: import("@spine-event-engine/client-web").SubscriptionDelivery): void;
  failLifecycle(error: unknown): void;
  failDelivery(error: unknown): void;
  recover?: () => void;
} {
  const lifecycle = iterable<import("@spine-event-engine/client-web").SubscriptionLifecycle>();
  const updates = iterable<import("@spine-event-engine/client-web").SubscriptionDelivery>();
  return {
    activate: vi.fn(() => Promise.resolve()),
    cancel: vi.fn(() => {
      if (options.cancelFailure === "throw") throw new Error("cancel throw");
      if (options.cancelFailure === "reject") return Promise.reject(new Error("cancel reject"));
      if (options.cancelEnds !== false) {
        lifecycle.end();
        updates.end();
      }
      return Promise.resolve();
    }),
    updates: updates.values,
    lifecycle: lifecycle.values,
    emitLifecycle: (value: import("@spine-event-engine/client-web").SubscriptionLifecycle) => {
      lifecycle.emit(value);
    },
    emitDelivery: (value: import("@spine-event-engine/client-web").SubscriptionDelivery) => {
      updates.emit(value);
    },
    failLifecycle: (error: unknown) => {
      lifecycle.fail(error);
    },
    failDelivery: (error: unknown) => {
      updates.fail(error);
    },
  };
}

function iterable<T>() {
  const waiting: {
    readonly resolve: (result: IteratorResult<T>) => void;
    readonly reject: (error: unknown) => void;
  }[] = [];
  const values: T[] = [];
  let ended = false;
  const take = (): T => {
    const value = values.shift();
    if (value === undefined) throw new Error("Expected a buffered async iterable value.");
    return value;
  };
  return {
    values: {
      [Symbol.asyncIterator]() {
        return {
          next: () =>
            ended
              ? Promise.resolve({ done: true as const, value: undefined })
              : values.length > 0
                ? Promise.resolve({ done: false as const, value: take() })
                : new Promise<IteratorResult<T>>((resolve, reject) =>
                    waiting.push({ resolve, reject }),
                  ),
        };
      },
    },
    emit: (value: T) => {
      const next = waiting.shift();
      if (next === undefined) values.push(value);
      else next.resolve({ done: false, value });
    },
    fail: (error: unknown) => {
      waiting.shift()?.reject(error);
    },
    end: () => {
      ended = true;
      for (const waiter of waiting.splice(0)) waiter.resolve({ done: true, value: undefined });
    },
  };
}
