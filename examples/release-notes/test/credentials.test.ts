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

import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";

import { CredentialStore } from "../src/trusted/credential-store.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })),
  );
});

test("credential updates are encrypted, atomic, and retain installation identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "release-notes-credentials-"));
  directories.push(directory);
  const cipher = {
    encrypt: (value: string): Uint8Array =>
      Buffer.from(Buffer.from(value, "utf8").toString("base64url").split("").reverse().join("")),
    decrypt: (value: Uint8Array): string =>
      Buffer.from(Buffer.from(value).toString().split("").reverse().join(""), "base64url").toString(
        "utf8",
      ),
  };
  const store = new CredentialStore(directory, cipher);
  const hostId = await store.hostId();
  expect(hostId).toMatch(/^urn:uuid:/);
  await store.save({
    clientId: "issued-client",
    issuer: "https://auth.openai.com",
    subject: "subject-1",
    email: "person@example.com",
    scopes: ["openid", "chatgpt.tokens.use.direct"],
    accessToken: "access-secret",
    refreshToken: "refresh-secret",
    idToken: "id-secret",
    expiresAt: 2000,
  });
  const contents = await readFile(join(directory, "credentials.bin"));
  expect(contents.toString()).not.toContain("access-secret");
  expect(contents.toString()).not.toContain("refresh-secret");
  expect((await stat(join(directory, "credentials.bin"))).mode & 0o777).toBe(0o600);
  expect(await readdir(directory)).toEqual(["credentials.bin"]);
  const reopened = new CredentialStore(directory, cipher);
  expect(await reopened.hostId()).toBe(hostId);
  expect((await reopened.registration("issued-client"))?.accessToken).toBe("access-secret");
  await reopened.clearTokens("issued-client");
  expect(await reopened.registration("issued-client")).toMatchObject({
    clientId: "issued-client",
    subject: "subject-1",
  });
  expect((await reopened.registration("issued-client"))?.accessToken).toBeUndefined();
});

test("corrupt credentials and failed encryption never create a plaintext replacement", async () => {
  const directory = await mkdtemp(join(tmpdir(), "release-notes-credentials-"));
  directories.push(directory);
  const path = join(directory, "credentials.bin");
  await writeFile(path, "corrupt encrypted data", { mode: 0o600 });
  const store = new CredentialStore(directory, {
    encrypt: () => {
      throw new Error("OS encryption unavailable");
    },
    decrypt: () => {
      throw new Error("OS decryption failed");
    },
  });
  await expect(store.registrations()).rejects.toThrow("OS decryption failed");
  await expect(store.hostId()).rejects.toThrow("OS decryption failed");
  expect(await readFile(path, "utf8")).toBe("corrupt encrypted data");
  expect(await readdir(directory)).toEqual(["credentials.bin"]);
  const emptyDirectory = await mkdtemp(join(tmpdir(), "release-notes-credentials-"));
  directories.push(emptyDirectory);
  const unavailable = new CredentialStore(emptyDirectory, {
    encrypt: () => {
      throw new Error("OS encryption unavailable");
    },
    decrypt: () => {
      throw new Error("OS decryption failed");
    },
  });
  await expect(unavailable.hostId()).rejects.toThrow("OS encryption unavailable");
  expect(await readdir(emptyDirectory)).toEqual([]);
});
