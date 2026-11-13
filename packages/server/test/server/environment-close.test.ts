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

import { type StorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import {
  ServerEnvironment,
  type ServerEnvironmentCloseable,
  type ServerEnvironmentSettings,
} from "../../src/server/server-environment.js";
import { EnvironmentType } from "../../src/server/environment.js";

function serverEnvironment(settings: ServerEnvironmentSettings = {}): ServerEnvironment {
  return ServerEnvironment.newBuilder()
    .under(EnvironmentType.Local, (configuration) => {
      configuration.use(settings);
    })
    .build();
}

describe("ServerEnvironment close", () => {
  it("flattens nested and cyclic owned-facility failures in facility order", async () => {
    const attempts: string[] = [];
    const deliveryError = new Error("delivery close failed");
    const nestedDeliveryError = new Error("nested delivery close failed");
    const storageError = new Error("storage close failed");
    const cyclicStorageFailure = new AggregateError([storageError], "storage aggregate");
    (cyclicStorageFailure.errors as unknown[]).push(cyclicStorageFailure);
    const sharedDeliveryFailure = new AggregateError(
      [nestedDeliveryError],
      "shared delivery aggregate",
    );
    const deliveryFailure = new AggregateError(
      [
        new AggregateError([deliveryError, sharedDeliveryFailure], "delivery branch aggregate"),
        sharedDeliveryFailure,
        deliveryError,
      ],
      "delivery aggregate",
    );
    const environment = serverEnvironment({
      delivery: failingOnceCloseable("delivery", deliveryFailure, attempts),
      storageFactory: failingOnceCloseable(
        "storage",
        cyclicStorageFailure,
        attempts,
      ) as StorageFactory,
    });

    const failure = await environment.close().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).message).toBe("ServerEnvironment close failed.");
    expect((failure as AggregateError).errors).toEqual([
      deliveryError,
      nestedDeliveryError,
      nestedDeliveryError,
      deliveryError,
      storageError,
      cyclicStorageFailure,
    ]);
    expect(attempts).toEqual(["delivery", "storage"]);
  });

  it("flattens iterable aggregate errors while continuing later facilities", async () => {
    const attempts: string[] = [];
    const iterableLeaf = new Error("iterable delivery close failed");
    const iterableFailure = new AggregateError([], "iterable delivery aggregate");
    (iterableFailure as unknown as { errors: Set<unknown> }).errors = new Set([iterableLeaf]);
    const environment = serverEnvironment({
      delivery: failingOnceCloseable("delivery", iterableFailure, attempts),
      storageFactory: successfulCloseable("storage", attempts) as StorageFactory,
    });

    const failure = await environment.close().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([iterableLeaf]);
    expect(attempts).toEqual(["delivery", "storage"]);
  });

  it("flattens a deep aggregate chain without blocking later facilities or completed-index retries", async () => {
    const attempts: string[] = [];
    const leaf = new Error("deep delivery close failed once");
    let failure: unknown = leaf;
    for (let depth = 0; depth < 20_000; depth += 1) {
      failure = new AggregateError([failure], "deep aggregate");
    }
    const environment = serverEnvironment({
      delivery: failingOnceCloseable("delivery", failure as AggregateError, attempts),
      storageFactory: successfulCloseable("storage", attempts) as StorageFactory,
    });

    const firstFailure = await environment.close().catch((error: unknown) => error);

    expect(firstFailure).toBeInstanceOf(AggregateError);
    expect((firstFailure as AggregateError).errors).toEqual([leaf]);
    expect(attempts).toEqual(["delivery", "storage"]);
    await expect(environment.close()).resolves.toBeUndefined();
    expect(attempts).toEqual(["delivery", "storage", "delivery"]);
  });

  it("retries only facilities that previously failed and leaves completed facilities idempotent", async () => {
    const attempts: string[] = [];
    const storageError = new Error("storage close failed once");
    const environment = serverEnvironment({
      delivery: successfulCloseable("delivery", attempts),
      storageFactory: failingOnceCloseable("storage", storageError, attempts) as StorageFactory,
    });

    const firstFailure = await environment.close().catch((error: unknown) => error);
    expect(firstFailure).toBeInstanceOf(AggregateError);
    expect((firstFailure as AggregateError).errors).toEqual([storageError]);

    await expect(environment.close()).resolves.toBeUndefined();
    await expect(environment.close()).resolves.toBeUndefined();

    expect(attempts).toEqual(["delivery", "storage", "storage"]);
  });

  it("contains a throwing close getter, continues later facilities, and retries that facility", async () => {
    const attempts: string[] = [];
    const getterFailure = new Error("delivery close getter failed once");
    let getterAttempts = 0;
    const delivery = Object.freeze({
      get close() {
        getterAttempts += 1;
        if (getterAttempts === 1) {
          throw getterFailure;
        }
        return () => {
          attempts.push("delivery");
        };
      },
    });
    const environment = serverEnvironment({
      delivery,
      storageFactory: successfulCloseable("storage", attempts) as StorageFactory,
    });

    const firstFailure = await environment.close().catch((error: unknown) => error);

    expect(firstFailure).toBeInstanceOf(AggregateError);
    expect((firstFailure as AggregateError).errors).toEqual([getterFailure]);
    expect(attempts).toEqual(["storage"]);
    await expect(environment.close()).resolves.toBeUndefined();
    expect(attempts).toEqual(["storage", "delivery"]);
    expect(getterAttempts).toBe(2);
  });

  it("closes every configured closeable facility", async () => {
    const attempts: string[] = [];
    const environment = serverEnvironment({
      delivery: successfulCloseable("delivery", attempts),
      storageFactory: successfulCloseable("storage", attempts) as StorageFactory,
    });

    await expect(environment.close()).resolves.toBeUndefined();
    await expect(environment.close()).resolves.toBeUndefined();

    expect(attempts).toEqual(["delivery", "storage"]);
  });

  it("ignores owned non-closeable facilities", async () => {
    const environment = serverEnvironment({
      delivery: {} as ServerEnvironmentCloseable,
      storageFactory: {} as StorageFactory,
    });

    await expect(environment.close()).resolves.toBeUndefined();
    await expect(environment.close()).resolves.toBeUndefined();
  });
});

function successfulCloseable(name: string, attempts: string[]): ServerEnvironmentCloseable {
  return {
    close() {
      attempts.push(name);
    },
  };
}

function failingOnceCloseable(
  name: string,
  error: Error | AggregateError,
  attempts: string[],
): ServerEnvironmentCloseable {
  let failed = false;
  return {
    close() {
      attempts.push(name);
      if (!failed) {
        failed = true;
        throw error;
      }
    },
  };
}
