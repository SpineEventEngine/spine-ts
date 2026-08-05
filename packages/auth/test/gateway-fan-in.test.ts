import { describe, expect, it } from "vitest";

import {
  FanInSubscriptionCreator,
  RoundRobinUnaryForwarder,
  type BackendSubscriptionEnvelope,
  type SubscriptionCreator,
  type UnaryForwarder,
} from "../src/index.js";

describe("gateway fan-in collaborators", () => {
  it("selects unary backends in configured round-robin order without retrying a failure", async () => {
    const first = unary("first");
    const second = unary("second", new Error("unavailable"));
    const forwarder = new RoundRobinUnaryForwarder([first.forwarder, second.forwarder]);

    await expect(forwarder.forward(request())).resolves.toEqual(bytes("first"));
    await expect(forwarder.forward(request())).rejects.toThrow("unavailable");
    await expect(forwarder.forward(request())).resolves.toEqual(bytes("first"));
    expect(first.calls()).toBe(2);
    expect(second.calls()).toBe(1);
  });

  it("creates, activates, cancels, and disposes every configured subscription child", async () => {
    const first = creator("one");
    const second = creator("two");
    const fanIn = new FanInSubscriptionCreator([first.creator, second.creator]);
    const signal = new AbortController().signal;
    const backend = await fanIn.subscribe(
      { kind: "subscription-topic", bytes: bytes("topic") },
      signal,
    );

    await fanIn.activate(
      {
        wire: { kind: "public-subscription", bytes: new Uint8Array() },
        backend,
        updates: () => Promise.resolve(),
      },
      signal,
    );
    await fanIn.cancel(
      { wire: { kind: "public-subscription", bytes: new Uint8Array() }, backend },
      signal,
    );
    await fanIn.dispose(backend, signal);

    expect(first.calls).toEqual(["subscribe", "activate", "cancel", "dispose"]);
    expect(second.calls).toEqual(["subscribe", "activate", "cancel", "dispose"]);
  });

  it("disposes successful child subscriptions when a later creation fails", async () => {
    const first = creator("one");
    const second = creator("two", "subscribe");
    const fanIn = new FanInSubscriptionCreator([first.creator, second.creator]);

    await expect(
      fanIn.subscribe(
        { kind: "subscription-topic", bytes: bytes("topic") },
        new AbortController().signal,
      ),
    ).rejects.toThrow("two subscribe failed");
    expect(first.calls).toEqual(["subscribe", "dispose"]);
    expect(second.calls).toEqual(["subscribe"]);
  });

  it("uses a fresh cleanup signal after an aborted child creation", async () => {
    const controller = new AbortController();
    let cleanupAborted: boolean | undefined;
    const first: SubscriptionCreator = {
      subscribe: () =>
        Promise.resolve({ kind: "backend-subscription-envelope", bytes: bytes("one") }),
      activate: () => Promise.resolve(),
      cancel: () => Promise.resolve(),
      dispose: (_backend, signal) => {
        cleanupAborted = signal.aborted;
        return Promise.resolve();
      },
    };
    const second: SubscriptionCreator = {
      ...creator("two").creator,
      subscribe: () => {
        controller.abort();
        return Promise.reject(new Error("timed out"));
      },
    };
    await expect(
      new FanInSubscriptionCreator([first, second]).subscribe(
        { kind: "subscription-topic", bytes: bytes("topic") },
        controller.signal,
      ),
    ).rejects.toThrow("timed out");
    expect(cleanupAborted).toBe(false);
  });

  it("caps aggregate envelopes before allocation and compensates created children", async () => {
    const first = creator("first");
    const second = creator("second");
    await expect(
      new FanInSubscriptionCreator([first.creator, second.creator], 8).subscribe(
        { kind: "subscription-topic", bytes: bytes("topic") },
        new AbortController().signal,
      ),
    ).rejects.toThrow("backend-envelope-too-large");
    expect(first.calls).toContain("dispose");
    expect(second.calls).toContain("dispose");
  });

  it("rejects an empty or oversized fixed backend list", () => {
    expect(() => new RoundRobinUnaryForwarder([])).toThrow("between 1 and 32");
    expect(
      () => new FanInSubscriptionCreator(Array.from({ length: 33 }, () => creator("x").creator)),
    ).toThrow("between 1 and 32");
  });
});

function unary(
  name: string,
  failure?: Error,
): { readonly forwarder: UnaryForwarder; readonly calls: () => number } {
  let calls = 0;
  return {
    forwarder: {
      forward(): Promise<Uint8Array> {
        calls++;
        if (failure !== undefined) return Promise.reject(failure);
        return Promise.resolve(bytes(name));
      },
    },
    calls: () => calls,
  };
}

function creator(
  name: string,
  failure?: "subscribe" | "activate" | "cancel" | "dispose",
): { readonly creator: SubscriptionCreator; readonly calls: string[] } {
  const calls: string[] = [];
  const fail = (operation: string): void => {
    if (failure === operation) throw new Error(`${name} ${operation} failed`);
  };
  return {
    creator: {
      subscribe(): Promise<BackendSubscriptionEnvelope> {
        calls.push("subscribe");
        fail("subscribe");
        return Promise.resolve({ kind: "backend-subscription-envelope", bytes: bytes(name) });
      },
      activate(): Promise<void> {
        calls.push("activate");
        fail("activate");
        return Promise.resolve();
      },
      cancel(): Promise<void> {
        calls.push("cancel");
        fail("cancel");
        return Promise.resolve();
      },
      dispose(): Promise<void> {
        calls.push("dispose");
        fail("dispose");
        return Promise.resolve();
      },
    },
    calls,
  };
}

function request() {
  return { service: "service", method: "method", value: bytes("request") };
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
