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

import type { DeliveryServerOptions } from "./delivery-server.js";

/**
 * Maximum message length in protobuf's 32-bit framing and Connect 2.1.2.
 */
const PROTOBUF_FRAME_MAX_BYTES = 0xffff_ffff;

/**
 * Describes the resolved delivery listener and session configuration.
 */
export interface DeliveryConfiguration {
  // prettier-ignore

  /**
   * Holds the validated listener host.
   */
  readonly host: string;

  /**
   * Holds the validated listener port.
   */
  readonly port: number;

  /**
   * Holds the maximum inbound RPC message size in bytes.
   */
  readonly maxInboundMessageBytes: number;

  /**
   * Holds the maximum outbound RPC message size in bytes.
   */
  readonly maxOutboundMessageBytes: number;

  /**
   * Holds the automatic Shard processing timeout in milliseconds.
   */
  readonly processingTimeoutMs: number;

  /**
   * Interval between notices while work remains free and pending.
   */
  readonly reminderIntervalMs: number;
}

/**
 * Provides delivery listener configuration resolution.
 */
export const DeliveryConfig: Readonly<{
  // prettier-ignore

  /**
   * Resolves delivery configuration from explicit options, environment, and defaults.
   *
   * @param options Holds explicit delivery server options.
   * @returns The frozen validated delivery configuration.
   */
  resolve: (options?: DeliveryServerOptions) => DeliveryConfiguration;

  /**
   * Resolves and validates a bounded numeric option.
   *
   * @param explicit Holds the explicit numeric override.
   * @param environment Names the environment variable.
   * @param fallback Holds the default value.
   * @param minimum Holds the inclusive lower bound.
   * @param maximum Holds the inclusive upper bound.
   * @param name Describes the value in validation errors.
   * @returns The resolved validated numeric value.
   */
  number: (
    explicit: number | undefined,
    environment: string,
    fallback: number,
    minimum: number,
    maximum: number,
    name: string,
  ) => number;

  /**
   * Parses an environment numeric option or returns its default.
   *
   * @param value Holds the environment value.
   * @param fallback Holds the default value.
   * @param name Describes the value in validation errors.
   * @returns The parsed environment value or default.
   */
  environmentNumber: (value: string | undefined, fallback: number, name: string) => number;
}> = Object.freeze({
  resolve: (options: DeliveryServerOptions = {}): DeliveryConfiguration => {
    const host = options.host ?? process.env.HOST ?? "127.0.0.1";
    if (typeof host !== "string" || host.trim().length === 0)
      throw new RangeError("Delivery server host is invalid.");
    return Object.freeze({
      host,
      port: DeliveryConfig.number(options.port, "PORT", 8484, 0, 65_535, "port"),
      maxInboundMessageBytes: DeliveryConfig.number(
        options.maxInboundMessageBytes,
        "MAX_INBOUND_MESSAGE_SIZE",
        PROTOBUF_FRAME_MAX_BYTES,
        1,
        PROTOBUF_FRAME_MAX_BYTES,
        "inbound message size",
      ),
      maxOutboundMessageBytes: DeliveryConfig.number(
        options.maxOutboundMessageBytes,
        "MAX_OUTBOUND_MESSAGE_SIZE",
        PROTOBUF_FRAME_MAX_BYTES,
        1,
        PROTOBUF_FRAME_MAX_BYTES,
        "outbound message size",
      ),
      processingTimeoutMs:
        DeliveryConfig.number(
          options.processingTimeoutSeconds,
          "SHARD_PROCESSING_TIMEOUT",
          60,
          1,
          315_576_000_000,
          "processing timeout",
        ) * 1_000,
      reminderIntervalMs: DeliveryConfigSupport.reminderInterval(options),
    });
  },
  number: (
    explicit: number | undefined,
    environment: string,
    fallback: number,
    minimum: number,
    maximum: number,
    name: string,
  ): number => {
    const value =
      explicit ?? DeliveryConfig.environmentNumber(process.env[environment], fallback, name);
    if (!Number.isInteger(value) || value < minimum || value > maximum)
      throw new RangeError(`Delivery server ${name} is invalid.`);
    return value;
  },
  environmentNumber: (value: string | undefined, fallback: number, name: string): number => {
    if (value === undefined || value === "") return fallback;
    if (!/^(?:0|[1-9][0-9]*)$/.test(value))
      throw new RangeError(`Delivery server ${name} is invalid.`);
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new RangeError(`Delivery server ${name} is invalid.`);
    return number;
  },
});

/**
 * Resolves supporting delivery server configuration values.
 */
const DeliveryConfigSupport = Object.freeze({
  /**
   * Resolves the work-reminder interval without a feature-specific cap.
   *
   * @param options Supplies the explicit seconds override.
   * @returns The positive interval in safe integer milliseconds.
   */
  reminderInterval(options: DeliveryServerOptions): number {
    return (
      DeliveryConfig.number(
        options.workReminderSeconds,
        "WORK_REMINDER_SECONDS",
        10,
        1,
        Math.floor(Number.MAX_SAFE_INTEGER / 1_000),
        "work reminder interval",
      ) * 1_000
    );
  },
});
