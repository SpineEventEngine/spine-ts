import {
  DEFAULT_DELIVERY_STATE_LIMITS,
  MAX_DELIVERY_LIMIT,
  MAX_DELIVERY_RESPONSE_SHARDS,
  MAX_DELIVERY_RPC_BYTES,
  DeliveryLimits,
  type DeliveryStateLimits,
} from "../core/limits.js";
import type { DeliveryServerOptions } from "./delivery-server.js";

/**
 * Describes the resolved delivery listener and retained-state configuration.
 */
export interface DeliveryConfiguration extends DeliveryStateLimits {
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
   * Holds the automatic Shard processing timeout in milliseconds.
   */
  readonly processingTimeoutMs: number;
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
        MAX_DELIVERY_RPC_BYTES,
        1,
        MAX_DELIVERY_LIMIT,
        "inbound message size",
      ),
      processingTimeoutMs:
        DeliveryConfig.number(
          options.processingTimeoutSeconds,
          "SHARD_PROCESSING_TIMEOUT",
          0,
          0,
          MAX_DELIVERY_LIMIT,
          "processing timeout",
        ) * 1_000,
      ...DeliveryLimits.resolve({
        maxRetainedMessages: DeliveryConfig.number(
          options.maxRetainedMessages,
          "MAX_RETAINED_MESSAGES",
          DEFAULT_DELIVERY_STATE_LIMITS.maxRetainedMessages,
          1,
          MAX_DELIVERY_LIMIT,
          "retained message limit",
        ),
        maxRetainedBytes: DeliveryConfig.number(
          options.maxRetainedBytes,
          "MAX_RETAINED_BYTES",
          DEFAULT_DELIVERY_STATE_LIMITS.maxRetainedBytes,
          1,
          MAX_DELIVERY_LIMIT,
          "retained byte limit",
        ),
        maxTrackedShards: DeliveryConfig.number(
          options.maxTrackedShards,
          "MAX_TRACKED_SHARDS",
          DEFAULT_DELIVERY_STATE_LIMITS.maxTrackedShards,
          1,
          MAX_DELIVERY_RESPONSE_SHARDS,
          "tracked shard limit",
        ),
      }),
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
