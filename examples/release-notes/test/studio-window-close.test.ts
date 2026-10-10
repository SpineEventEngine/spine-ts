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

import { EventEmitter } from "node:events";
import { expect, it } from "vitest";

import { StudioWindowClose } from "../src/trusted/studio-window-close.js";

it("wait keeps an active session open, then stop closes the context before the window", async () => {
  const events: string[] = [];
  const window = new EventEmitter() as EventEmitter & { close(): void };
  window.close = () => {
    const event = {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
        events.push("prevent");
      },
    };
    window.emit("close", event);
    if (!event.defaultPrevented) {
      events.push("window-close");
      window.emit("closed");
    }
  };
  const studio = {
    selectionLocked: () => Promise.resolve(true),
    close: () => {
      events.push("studio-close");
      return Promise.resolve();
    },
  };
  const auth = {
    close: () => {
      events.push("auth-close");
      return Promise.resolve();
    },
  };
  const decisions: ("wait" | "stop")[] = ["wait", "stop"];
  StudioWindowClose.install(
    window as unknown as Parameters<typeof StudioWindowClose.install>[0],
    studio,
    auth,
    () => Promise.resolve(decisions.shift() ?? "wait"),
  );

  window.close();
  await expect.poll(() => events.filter((value) => value === "prevent").length).toBe(1);
  expect(events).not.toContain("studio-close");
  window.close();
  await expect.poll(() => events.includes("auth-close")).toBe(true);
  expect(events.indexOf("studio-close")).toBeLessThan(events.indexOf("window-close"));
  expect(events.filter((value) => value === "studio-close")).toHaveLength(1);
});

it("keeps a second close attempt from bypassing the pending Wait decision", async () => {
  const events: string[] = [];
  const window = new EventEmitter() as EventEmitter & { close(): void };
  window.close = () => {
    const event = {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    window.emit("close", event);
    if (!event.defaultPrevented) {
      events.push("window-closed");
      window.emit("closed");
    }
  };
  const { promise: decision, resolve: answer } = Promise.withResolvers<"wait">();
  StudioWindowClose.install(
    window as unknown as Parameters<typeof StudioWindowClose.install>[0],
    {
      selectionLocked: () => Promise.resolve(true),
      close: () => {
        events.push("studio-close");
        return Promise.resolve();
      },
    },
    {
      close: () => {
        events.push("auth-close");
        return Promise.resolve();
      },
    },
    () => {
      events.push("dialog");
      return decision;
    },
  );
  window.close();
  await expect.poll(() => events.includes("dialog")).toBe(true);
  window.close();
  expect(events).toEqual(["dialog"]);
  answer("wait");
  await Promise.resolve();
  expect(events).toEqual(["dialog"]);
});
