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

/**
 * Reads the Message Board RPC base URL from Vite configuration.
 *
 * @param environment Supplies Vite environment values.
 * @returns Returns the configured HTTP or HTTPS RPC base URL.
 */
export const LocalBoardGateway: Readonly<{
  url(environment: Readonly<Record<string, string | undefined>>): string;
}> = Object.freeze({
  url(environment: Readonly<Record<string, string | undefined>>): string {
    const value = environment.VITE_MESSAGE_BOARD_GATEWAY_URL ?? "http://127.0.0.1:8090";
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(
        "VITE_MESSAGE_BOARD_GATEWAY_URL must be a loopback HTTP URL with an explicit port.",
      );
    }
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.port === "" ||
      url.username !== "" ||
      url.password !== ""
    )
      throw new Error(
        "VITE_MESSAGE_BOARD_GATEWAY_URL must be an HTTP or HTTPS URL with an explicit port and no credentials.",
      );
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65_535)
      throw new Error("VITE_MESSAGE_BOARD_GATEWAY_URL must use a port from 1 through 65535.");
    return url.toString().replace(/\/$/u, "");
  },
});
