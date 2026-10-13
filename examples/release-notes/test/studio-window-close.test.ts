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

import { expect, it, vi } from "vitest";
import { StudioWindowClose } from "../src/trusted/studio-window-close.js";

const setup = (locked: boolean, choose: () => Promise<"wait" | "stop">) => {
  const events: string[] = [];
  let handler: (() => Promise<"close" | "cancel">) | undefined;
  const window = {
    handle: (_action: "close", next: () => Promise<"close" | "cancel">) => {
      handler = next;
    },
    on: (_action: "closed", callback: () => void) => {
      closed = callback;
    },
  };
  let closed: () => void = () => undefined;
  StudioWindowClose.install(
    window as Parameters<typeof StudioWindowClose.install>[0],
    {
      reserveClose: () => {
        events.push("reserve");
      },
      releaseCloseReservation: () => {
        events.push("release");
      },
      acceptClose: () => {
        events.push("accept");
      },
      selectionLocked: () => Promise.resolve(locked),
      close: () => {
        events.push("studio");
        return Promise.resolve();
      },
    },
    {
      close: () => {
        events.push("auth");
        return Promise.resolve();
      },
    },
    choose,
  );
  return {
    events,
    close: () => {
      if (!handler) throw new Error("Close handler is missing.");
      return handler();
    },
    closed: () => {
      closed();
    },
  };
};

it("keeps active generation visible on Wait, then closes services before Stop", async () => {
  const choices: ("wait" | "stop")[] = ["wait", "stop"];
  const app = setup(true, () => Promise.resolve(choices.shift() ?? "wait"));
  expect(await app.close()).toBe("cancel");
  expect(app.events).toEqual(["reserve", "release"]);
  expect(await app.close()).toBe("close");
  expect(app.events).toEqual(["reserve", "release", "reserve", "accept", "studio", "auth"]);
  app.closed();
  expect(app.events).toEqual(["reserve", "release", "reserve", "accept", "studio", "auth"]);
});

it("coalesces repeated close requests while the dialog is pending", async () => {
  const decision = Promise.withResolvers<"wait">();
  let dialogs = 0;
  const app = setup(true, () => {
    dialogs++;
    return decision.promise;
  });
  const first = app.close();
  const second = app.close();
  await Promise.resolve();
  expect(dialogs).toBe(1);
  decision.resolve("wait");
  expect(await first).toBe("cancel");
  expect(await second).toBe("cancel");
  expect(app.events).toEqual(["reserve", "release"]);
});

it("cleans up a window that closes without invoking its decision callback", async () => {
  const app = setup(false, () => Promise.resolve("wait"));
  app.closed();
  await Promise.resolve();
  expect(app.events).toEqual(["accept", "studio", "auth"]);
  expect(await app.close()).toBe("close");
});

it("reserves admission before an asynchronous lock read and releases it on Wait", async () => {
  const lockRead = Promise.withResolvers<boolean>();
  const events: string[] = [];
  let close: (() => Promise<string>) | undefined;
  let reserved = false;
  StudioWindowClose.install(
    {
      handle: (_action, handler) => {
        close = () => handler({} as never);
      },
      on: () => undefined,
    },
    {
      reserveClose: () => {
        reserved = true;
        events.push("reserve");
      },
      releaseCloseReservation: () => {
        reserved = false;
        events.push("release");
      },
      acceptClose: () => events.push("accept"),
      selectionLocked: () => lockRead.promise,
      close: () => {
        events.push("studio-close");
        return Promise.resolve();
      },
    },
    { close: () => Promise.resolve() },
    () => {
      events.push("dialog");
      return Promise.resolve("wait");
    },
  );
  if (!close) throw new Error("Close handler is missing.");
  const pending = close();
  expect(reserved).toBe(true);
  expect(events).toEqual(["reserve"]);
  lockRead.resolve(true);
  expect(await pending).toBe("cancel");
  expect(events).toEqual(["reserve", "dialog", "release"]);
  expect(reserved).toBe(false);
});

it("closes terminally and attempts both cleanups when either one fails", async () => {
  const reported = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const failures: string[] = [];
  let close: (() => Promise<string>) | undefined;
  let accepted = false;
  StudioWindowClose.install(
    {
      handle: (_action, handler) => {
        close = () => handler({} as never);
      },
      on: () => undefined,
    },
    {
      reserveClose: () => undefined,
      releaseCloseReservation: () => undefined,
      acceptClose: () => {
        accepted = true;
      },
      selectionLocked: () => Promise.resolve(false),
      close: () => {
        failures.push("studio");
        return Promise.reject(new Error("sensitive Studio failure"));
      },
    },
    {
      close: () => {
        failures.push("auth");
        return Promise.reject(new Error("sensitive auth failure"));
      },
    },
    () => Promise.resolve("stop"),
  );
  if (!close) throw new Error("Close handler is missing.");
  expect(await close()).toBe("close");
  expect(accepted).toBe(true);
  expect(failures).toEqual(["studio", "auth"]);
  expect(await close()).toBe("close");
  expect(failures).toEqual(["studio", "auth"]);
  expect(reported).toHaveBeenCalledExactlyOnceWith("Studio cleanup failed during close.");
  reported.mockRestore();
});
