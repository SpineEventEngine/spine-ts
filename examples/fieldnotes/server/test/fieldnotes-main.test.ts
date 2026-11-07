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

import { afterEach, beforeEach, expect, it, vi } from "vitest";

const collaborators = vi.hoisted(() => ({
  open: vi.fn(),
  install: vi.fn(),
}));

vi.mock("../src/fieldnotes-host.js", () => ({ FieldnotesHost: { open: collaborators.open } }));
vi.mock("../src/fieldnotes-process.js", () => ({
  FieldnotesProcessSignals: { install: collaborators.install },
}));

const environment = {
  FIELDNOTES_POSTGRES_URL: "postgres://localhost/fieldnotes",
  FIELDNOTES_PUBLIC_ORIGIN: "https://localhost:3000",
  FIELDNOTES_SESSION_PASSWORD: "test-password",
  FIELDNOTES_CSRF_SECRET_BASE64: Buffer.alloc(32, 1).toString("base64"),
  FIELDNOTES_READER_PROOF_SECRET_BASE64: Buffer.alloc(32, 2).toString("base64"),
  FIELDNOTES_SESSION_TTL_MS: "3600000",
  FIELDNOTES_AUTH_ROUTE_TIMEOUT_MS: "10000",
  FIELDNOTES_AUTH_ROUTE_MAX_BYTES: "65536",
  FIELDNOTES_GATEWAY_PORT: "4242",
  FIELDNOTES_AUTH_MODE: "google",
  FIELDNOTES_GOOGLE_CLIENT_ID: "client-id",
  FIELDNOTES_GOOGLE_CLIENT_SECRET: "client-secret",
};

const previous = new Map<string, string | undefined>();
const priorExitCode = process.exitCode;
const stdout: string[] = [];
const stderr: string[] = [];

beforeEach(() => {
  vi.resetModules();
  collaborators.open.mockReset();
  collaborators.install.mockReset();
  stdout.length = 0;
  stderr.length = 0;
  for (const [name, value] of Object.entries(environment)) {
    previous.set(name, process.env[name]);
    process.env[name] = value;
  }
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  process.exitCode = undefined;
});

afterEach(() => {
  for (const [name, value] of previous) {
    if (value === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = value;
  }
  previous.clear();
  process.exitCode = priorExitCode;
  vi.restoreAllMocks();
});

it("launches a parsed host, installs signal shutdown and reports only the ready port", async () => {
  const host = { close: vi.fn() };
  collaborators.open.mockResolvedValue(host);
  await import("../src/main.js");
  expect(collaborators.open).toHaveBeenCalledWith(
    expect.objectContaining({ publicOrigin: environment.FIELDNOTES_PUBLIC_ORIGIN }),
    {
      authentication: { mode: "google", clientId: "client-id", clientSecret: "client-secret" },
      gatewayPort: 4242,
    },
  );
  expect(collaborators.install).toHaveBeenCalledExactlyOnceWith(host);
  expect(stdout).toEqual(["Fieldnotes Gateway ready on 127.0.0.1:4242.\n"]);
  expect(process.exitCode).toBeUndefined();
});

it("rejects malformed deployment settings before opening the host", async () => {
  process.env.FIELDNOTES_GATEWAY_PORT = "0";
  await import("../src/main.js");
  expect(collaborators.open).not.toHaveBeenCalled();
  expect(stderr).toEqual(["Fieldnotes startup failed.\n"]);
  expect(process.exitCode).toBe(1);
});

it("reports a provider startup failure without printing its settings", async () => {
  collaborators.open.mockRejectedValue(new Error("client-secret leaked"));
  await import("../src/main.js");
  expect(collaborators.install).not.toHaveBeenCalled();
  expect(stderr).toEqual(["Fieldnotes startup failed.\n"]);
  expect(stderr.join("")).not.toContain("client-secret");
  expect(process.exitCode).toBe(1);
});
