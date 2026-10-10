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

import { spawn } from "node:child_process";

const environment = Object.freeze({
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_ATTR_NOSYSTEM: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_NO_LAZY_FETCH: "1",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  GIT_PAGER: "cat",
  LC_ALL: "C",
  PATH: "/usr/bin:/bin",
});

/**
 * Runs fixed Git subcommands under a bounded, noninteractive process policy.
 */
export const GitCommand = {
  /**
   * Executes one Git command without inherited environment.
   *
   * @param executable Trusted absolute Git executable.
   * @param repository Selected absolute repository path.
   * @param args Fixed argument array.
   * @param maxBytes Maximum stdout bytes.
   * @param signal Optional cancellation signal.
   * @returns Complete bounded stdout bytes.
   */
  async run(
    executable: string,
    repository: string,
    args: readonly string[],
    maxBytes = 2_000_000,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    if (!executable.startsWith("/") || !repository.startsWith("/"))
      throw new Error("Git executable and repository must be absolute paths.");
    if (signal?.aborted) throw new Error("Git operation cancelled.");
    const child = spawn(
      executable,
      [
        "--no-pager",
        "-C",
        repository,
        "-c",
        "core.fsmonitor=false",
        "-c",
        "diff.external=",
        "-c",
        "diff.relative=false",
        ...args,
      ],
      {
        shell: false,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return this.collect(child, maxBytes, signal);
  },

  /**
   * Collects output while enforcing the physical byte and time limits.
   *
   * @param child Spawned Git process.
   * @param maxBytes Maximum stdout bytes.
   * @param signal Optional cancellation signal.
   * @returns Complete bounded stdout bytes.
   */
  async collect(
    child: ReturnType<typeof spawn>,
    maxBytes: number,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    if (!child.stdout || !child.stderr) {
      child.kill("SIGKILL");
      throw new Error("Git process streams are unavailable.");
    }
    const chunks: Buffer[] = [];
    const received = { bytes: 0, exceeded: false };
    const cancel = () => child.kill("SIGKILL");
    const timer = setTimeout(cancel, 10_000);
    signal?.addEventListener("abort", cancel, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      received.bytes += chunk.length;
      if (received.bytes > maxBytes) {
        received.exceeded = true;
        cancel();
      } else chunks.push(chunk);
    });
    child.stderr.resume();
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    }).finally(() => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    });
    signal?.throwIfAborted();
    if (received.exceeded) throw new Error("Git output byte bound exceeded.");
    if (code !== 0) throw new Error("Git operation failed or timed out.");
    return Buffer.concat(chunks);
  },
};
