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

import { describe, expect, it } from "vitest";
import { AgentLiveBudget } from "../../src/agent/agent-live-budget.js";

describe("live Agent invocation budget", () => {
  it("reserves physical output synchronously and keeps unknown outcomes charged", () => {
    const budget = new AgentLiveBudget({
      totalInputBytes: 10,
      totalOutputBytes: 12,
      modelRequests: 2,
    });
    const first = budget.reservePhysical(3, 8, "model");
    expect(first.maxOutputBytes).toBe(8);
    const capped = budget.reservePhysical(1, 5, "protocol");
    expect(capped.maxOutputBytes).toBe(4);
    budget.settlePhysical(capped, 0);
    budget.settlePhysical(first, 2);
    const second = budget.reservePhysical(6, 10, "model");
    expect(second.maxOutputBytes).toBe(10);
    budget.settlePhysical(second, 0);
    expect(() => budget.reservePhysical(0, 1, "model")).toThrow("request budget");
  });

  it("charges model, tool, operation, and read limits across one invocation", () => {
    const budget = new AgentLiveBudget({ operations: 1, toolCalls: 1, recordedReads: 1 });
    budget.reserveOperation();
    budget.reserveToolCall();
    budget.reserveRead();
    expect(() => {
      budget.reserveOperation();
    }).toThrow("operation budget");
    expect(() => {
      budget.reserveToolCall();
    }).toThrow("tool call budget");
    expect(() => {
      budget.reserveRead();
    }).toThrow("read budget");
  });

  it("retains full credit after an unknown result and rejects received bytes above credit", () => {
    const budget = new AgentLiveBudget({ totalOutputBytes: 6 });
    const uncertain = budget.reservePhysical(0, 4, "protocol");
    const capped = budget.reservePhysical(0, 3, "protocol");
    expect(capped.maxOutputBytes).toBe(2);
    budget.settlePhysical(capped, 0);
    const measured = budget.reservePhysical(0, 2, "protocol");
    expect(() => {
      budget.settlePhysical(measured, 3);
    }).toThrow("response byte");
    expect(() => {
      budget.settlePhysical(uncertain, 5);
    }).toThrow("response byte");
  });

  it("accepts measured output when neither adapter nor invocation declares a ceiling", () => {
    const budget = new AgentLiveBudget({});
    const ticket = budget.reservePhysical(2, undefined, "model");
    expect(ticket.maxOutputBytes).toBeUndefined();
    expect(() => {
      budget.settlePhysical(ticket, 42);
    }).not.toThrow();
  });

  it("checks decoded chunks synchronously before the physical adapter continues", () => {
    const budget = new AgentLiveBudget({ totalOutputBytes: 5 });
    const ticket = budget.reservePhysical(0, 4, "protocol");
    budget.onReceived(ticket, 2);
    budget.onReceived(ticket, 2);
    expect(() => {
      budget.onReceived(ticket, 1);
    }).toThrow("response byte");
    expect(() => {
      budget.settlePhysical(ticket, 3);
    }).toThrow("receipt byte counts disagree");
    budget.settlePhysical(ticket, 4);
  });
});
