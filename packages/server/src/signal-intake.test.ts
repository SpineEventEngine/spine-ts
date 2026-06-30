import { describe, expect, expectTypeOf, it } from "vitest";

import {
  acceptSignalIntake,
  failSignalIntake,
  type SignalIntakeAccepted,
  type SignalIntakeFailure,
  type SignalIntakeFailureCode,
  type SignalIntakeFailureDiagnostics,
  type SignalIntakeResult,
  type SignalKind,
} from "./signal-intake.js";

describe("signal intake results", () => {
  it("creates accepted-for-async-work results for command and event signals", () => {
    expectTypeOf<SignalKind>().toEqualTypeOf<"command" | "event">();
    expectTypeOf<SignalIntakeAccepted<"command">>().toExtend<SignalIntakeResult>();
    expectTypeOf<SignalIntakeAccepted<"event">>().toExtend<SignalIntakeResult>();

    const command = acceptSignalIntake("command");
    const event = acceptSignalIntake("event");

    expect(command).toEqual({
      status: "accepted",
      signalKind: "command",
      acceptedFor: "async-work",
    });
    expect(event).toEqual({
      status: "accepted",
      signalKind: "event",
      acceptedFor: "async-work",
    });
    expect(Object.isFrozen(command)).toBe(true);
    expect(Object.isFrozen(event)).toBe(true);
  });

  it("creates immediate failure results with stable failure codes and sanitized diagnostics", () => {
    expectTypeOf<SignalIntakeFailureCode>().toEqualTypeOf<
      "RUNTIME_NOT_ACCEPTING" | "MALFORMED_ENVELOPE" | "UNSUPPORTED_SIGNAL_KIND"
    >();
    expectTypeOf<SignalIntakeFailure<"command">>().toExtend<SignalIntakeResult>();
    expectTypeOf<SignalIntakeFailure<"event">>().toExtend<SignalIntakeResult>();

    const result = failSignalIntake("command", "RUNTIME_NOT_ACCEPTING", {
      boundedContext: "Tasks",
      runtimeState: "closed",
      messageType: "example.tasks.CreateTask",
    });

    expect(result).toEqual({
      status: "failed",
      signalKind: "command",
      failure: {
        code: "RUNTIME_NOT_ACCEPTING",
        diagnostics: {
          boundedContext: "Tasks",
          runtimeState: "closed",
          messageType: "example.tasks.CreateTask",
        },
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.failure)).toBe(true);
    expect(Object.isFrozen(result.failure.diagnostics)).toBe(true);
  });

  it("keeps diagnostic metadata copy-safe and omits payload-shaped input", () => {
    const diagnostics = {
      boundedContext: "Tasks",
      messageType: "example.tasks.CreateTask",
      reason: "runtime closed",
      payload: { id: "task-1", title: "private payload" },
      message: { id: "task-1", title: "private message" },
      signal: { bytes: [1, 2, 3] },
      envelope: { id: "command-1" },
      nested: { ignored: true },
    };

    const result = failSignalIntake("event", "MALFORMED_ENVELOPE", diagnostics);

    diagnostics.boundedContext = "Changed";
    diagnostics.messageType = "changed.Type";

    expect(result.failure.diagnostics).toEqual({
      boundedContext: "Tasks",
      messageType: "example.tasks.CreateTask",
      reason: "runtime closed",
    });
    expect(result.failure.diagnostics).not.toHaveProperty("payload");
    expect(result.failure.diagnostics).not.toHaveProperty("message");
    expect(result.failure.diagnostics).not.toHaveProperty("signal");
    expect(result.failure.diagnostics).not.toHaveProperty("envelope");
    expect(result.failure.diagnostics).not.toHaveProperty("nested");
  });

  it("allows failure diagnostics to be omitted without sharing mutable defaults", () => {
    const first = failSignalIntake("command", "UNSUPPORTED_SIGNAL_KIND");
    const second = failSignalIntake("command", "UNSUPPORTED_SIGNAL_KIND");

    expect(first.failure.diagnostics).toEqual({});
    expect(second.failure.diagnostics).toEqual({});
    expect(first.failure.diagnostics).not.toBe(second.failure.diagnostics);
    expect(Object.isFrozen(first.failure.diagnostics)).toBe(true);
  });

  it("does not schedule async work or expose dispatch behavior", () => {
    const callbacks: (() => void)[] = [];
    const enqueue = (work: () => void): void => {
      callbacks.push(work);
    };
    const runtime = { enqueue };

    const accepted = acceptSignalIntake("command");
    const failed = failSignalIntake("event", "RUNTIME_NOT_ACCEPTING", {
      runtimeState: "created",
    });

    expect(accepted).not.toHaveProperty("promise");
    expect(accepted).not.toHaveProperty("work");
    expect(accepted).not.toHaveProperty("dispatch");
    expect(failed).not.toHaveProperty("payload");
    expect(failed).not.toHaveProperty("message");
    expect(callbacks).toEqual([]);
    expect(runtime).toHaveProperty("enqueue");
    expect(enqueue).toBeTypeOf("function");
  });

  it("types diagnostics as sanitized scalar metadata only", () => {
    expectTypeOf<SignalIntakeFailureDiagnostics>().toEqualTypeOf<
      Readonly<Record<string, string | number | boolean | null>>
    >();

    const diagnostics: SignalIntakeFailureDiagnostics = {
      boundedContext: "Tasks",
      retryable: false,
      attempt: 1,
      detail: null,
    };

    expect(
      failSignalIntake("command", "RUNTIME_NOT_ACCEPTING", diagnostics).failure.diagnostics,
    ).toEqual({
      boundedContext: "Tasks",
      retryable: false,
      attempt: 1,
      detail: null,
    });
  });
});
