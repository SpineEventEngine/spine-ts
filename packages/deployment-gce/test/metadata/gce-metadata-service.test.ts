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
/* eslint-disable @typescript-eslint/require-await -- Structural registry and Gateway fixtures expose
 * asynchronous contract methods without awaiting. */

import { describe, expect, it } from "vitest";

import { GceMetadataService } from "../../src/index.js";

describe("GceMetadataService", () => {
  it("reads documented GCE metadata paths with the required header", async () => {
    const original = globalThis.fetch;
    const requests: (RequestInfo | URL)[] = [];
    globalThis.fetch = async (input) => {
      requests.push(input);
      const path = requestUrl(input).split("/").slice(-2).join("/");
      const body =
        new Map([
          ["project/project-id", " project "],
          ["instance/zone", "projects/1/zones/zone-a"],
          ["instance/id", "42"],
          ["0/ip", "10.0.0.1"],
        ]).get(path) ?? "";
      return new Response(body, { status: 200 });
    };
    try {
      await expect(new GceMetadataService().read(new AbortController().signal)).resolves.toEqual({
        projectId: "project",
        zone: "zone-a",
        instanceId: "42",
        privateAddress: "10.0.0.1",
      });
      expect(requests).toHaveLength(4);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("aborts sibling metadata requests when one request fails", async () => {
    const original = globalThis.fetch;
    const siblingSignals: AbortSignal[] = [];
    let requests = 0;
    globalThis.fetch = async (_input, init) => {
      requests += 1;
      if (requests === 1) return new Response("unavailable", { status: 503 });
      const requestSignal = init?.signal;
      if (requestSignal === undefined || requestSignal === null)
        throw new Error("metadata request signal is missing");
      siblingSignals.push(requestSignal);
      return new Promise<Response>(() => undefined);
    };
    try {
      await expect(new GceMetadataService().read(new AbortController().signal)).rejects.toThrow(
        "metadata request failed",
      );
      expect(siblingSignals).toHaveLength(3);
      expect(siblingSignals.every((signal) => signal.aborted)).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("rejects failed, malformed, and cancelled metadata reads", async () => {
    const original = globalThis.fetch;
    try {
      for (const status of [400, 503]) {
        globalThis.fetch = async () => new Response("unavailable", { status });
        await expect(new GceMetadataService().read(new AbortController().signal)).rejects.toThrow(
          "metadata request failed",
        );
      }

      for (const [path, value] of [
        ["project/project-id", " "],
        ["instance/zone", " "],
        ["instance/id", "not-a-number"],
        ["instance/network-interfaces/0/ip", " "],
      ]) {
        globalThis.fetch = async (input) => {
          const requested = requestUrl(input).replace(
            "http://metadata.google.internal/computeMetadata/v1/",
            "",
          );
          const body =
            requested === path
              ? value
              : (new Map([
                  ["project/project-id", "project"],
                  ["instance/zone", "projects/1/zones/zone-a"],
                  ["instance/id", "42"],
                  ["instance/network-interfaces/0/ip", "10.0.0.1"],
                ]).get(requested) ?? "");
          return new Response(body, { status: 200 });
        };
        await expect(new GceMetadataService().read(new AbortController().signal)).rejects.toThrow(
          "metadata response is invalid",
        );
      }

      const signals: AbortSignal[] = [];
      globalThis.fetch = async (_input, init) => {
        const signal = init?.signal;
        if (!(signal instanceof AbortSignal)) throw new Error("missing abort signal");
        signals.push(signal);
        return await new Promise<Response>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              reject(new Error("cancelled"));
            },
            { once: true },
          );
        });
      };
      const controller = new AbortController();
      const reading = new GceMetadataService().read(controller.signal);
      controller.abort();
      await expect(reading).rejects.toThrow("cancelled");
      expect(signals).toHaveLength(4);
      expect(signals.every((signal) => signal.aborted)).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });
});

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}
