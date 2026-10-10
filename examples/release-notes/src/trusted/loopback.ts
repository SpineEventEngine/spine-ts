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

import { createServer } from "node:http";

/**
 * One local authorization callback listener.
 */
export interface LoopbackListener {
  /**
   * Local loopback callback URL.
   */
  readonly redirectUri: string;

  /**
   * Waits for the browser callback.
   *
   * @returns The validated callback.
   */
  wait(): Promise<URL>;

  /**
   * Closes the active authorization callback.
   *
   * @returns The close result.
   */
  close(): Promise<void>;
}

/**
 * Handles a single IPv4 loopback authorization callback.
 */
class OnLocalCallback implements LoopbackListener {
  /**
   * Local loopback callback URL.
   */
  redirectUri = "";

  /**
   * The server value.
   */
  private readonly server = createServer((request, response) => {
    this.handle(request, response);
  });

  /**
   * The callback value.
   */
  private readonly callback: Promise<URL>;

  /**
   * The resolve callback value.
   */
  private resolveCallback!: (value: URL) => void;

  /**
   * The reject callback value.
   */
  private rejectCallback!: (reason: Error) => void;

  /**
   * The settled value.
   */
  private settled = false;

  /**
   * Initializes the trusted service.
   */
  private constructor() {
    this.callback = new Promise<URL>((resolve, reject) => {
      this.resolveCallback = resolve;
      this.rejectCallback = reject;
    });
    void this.callback.catch(() => undefined);
  }

  /**
   * Opens the loopback callback listener.
   *
   * @returns The open result.
   */
  static async open(): Promise<OnLocalCallback> {
    const listener = new OnLocalCallback();
    await new Promise<void>((resolve, reject) => {
      listener.server.once("error", reject);
      listener.server.listen(0, "127.0.0.1", () => {
        listener.server.off("error", reject);
        resolve();
      });
    });
    const address = listener.server.address();
    if (address === null || typeof address === "string")
      throw new Error("Loopback address unavailable.");
    listener.redirectUri = `http://127.0.0.1:${String(address.port)}/auth/callback`;
    return listener;
  }

  /**
   * Handles one local browser callback.
   *
   * @param request The request for this operation.
   * @param response The response for this operation.
   */
  private handle(
    request: import("node:http").IncomingMessage,
    response: import("node:http").ServerResponse,
  ): void {
    const path = request.url ?? "";
    if (request.method !== "GET" || !path.startsWith("/auth/callback?")) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }
    if (this.settled) {
      response.writeHead(410).end();
      return;
    }
    this.settled = true;
    response
      .writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Security-Policy": "default-src 'none'",
        "Cache-Control": "no-store",
      })
      .end("You can return to Release Notes Studio.");
    const url = new URL(path, this.redirectUri);
    this.server.close(() => {
      this.resolveCallback(url);
    });
  }

  /**
   * Waits for the browser callback.
   *
   * @returns The validated callback.
   */
  wait(): Promise<URL> {
    return this.callback;
  }

  /**
   * Closes the active authorization callback.
   *
   * @returns The close result.
   */
  async close(): Promise<void> {
    if (!this.settled) {
      this.settled = true;
      this.rejectCallback(new Error("Authorization attempt closed."));
    }
    if (this.server.listening)
      await new Promise<void>((resolve) =>
        this.server.close(() => {
          resolve();
        }),
      );
  }
}

/**
 * Opens a one-shot callback on IPv4 loopback only.
 *
 * @returns The local callback listener.
 */
export const openLoopback = (): Promise<LoopbackListener> => OnLocalCallback.open();
