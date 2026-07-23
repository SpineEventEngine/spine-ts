import type { DeliveryServerOptions } from "./delivery-server.js";
import {
  DEFAULT_DELIVERY_STATE_LIMITS,
  MAX_DELIVERY_LIMIT,
  MAX_DELIVERY_RESPONSE_SHARDS,
  MAX_DELIVERY_RPC_BYTES,
  resolveStateLimits,
} from "../core/limits.js";

export interface DeliveryConfiguration extends ReturnType<typeof resolveStateLimits> {
  readonly host: string;
  readonly port: number;
  readonly maxInboundMessageBytes: number;
  readonly processingTimeoutMs: number;
}

export function resolveConfiguration(options: DeliveryServerOptions = {}): DeliveryConfiguration {
  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  if (typeof host !== "string" || host.trim().length === 0)
    throw new RangeError("Delivery server host is invalid.");
  return Object.freeze({
    host,
    port: numberOption(options.port, "PORT", 8484, 0, 65_535, "port"),
    maxInboundMessageBytes: numberOption(
      options.maxInboundMessageBytes,
      "MAX_INBOUND_MESSAGE_SIZE",
      MAX_DELIVERY_RPC_BYTES,
      1,
      MAX_DELIVERY_LIMIT,
      "inbound message size",
    ),
    processingTimeoutMs:
      numberOption(
        options.processingTimeoutSeconds,
        "SHARD_PROCESSING_TIMEOUT",
        0,
        0,
        MAX_DELIVERY_LIMIT,
        "processing timeout",
      ) * 1_000,
    ...resolveStateLimits({
      maxRetainedMessages: numberOption(
        options.maxRetainedMessages,
        "MAX_RETAINED_MESSAGES",
        DEFAULT_DELIVERY_STATE_LIMITS.maxRetainedMessages,
        1,
        MAX_DELIVERY_LIMIT,
        "retained message limit",
      ),
      maxRetainedBytes: numberOption(
        options.maxRetainedBytes,
        "MAX_RETAINED_BYTES",
        DEFAULT_DELIVERY_STATE_LIMITS.maxRetainedBytes,
        1,
        MAX_DELIVERY_LIMIT,
        "retained byte limit",
      ),
      maxTrackedShards: numberOption(
        options.maxTrackedShards,
        "MAX_TRACKED_SHARDS",
        DEFAULT_DELIVERY_STATE_LIMITS.maxTrackedShards,
        1,
        MAX_DELIVERY_RESPONSE_SHARDS,
        "tracked shard limit",
      ),
    }),
  });
}

function numberOption(
  explicit: number | undefined,
  environment: string,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const value = explicit ?? environmentNumber(process.env[environment], fallback, name);
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw new RangeError(`Delivery server ${name} is invalid.`);
  return value;
}

function environmentNumber(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === "") return fallback;
  if (!/^(?:0|[1-9][0-9]*)$/.test(value))
    throw new RangeError(`Delivery server ${name} is invalid.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new RangeError(`Delivery server ${name} is invalid.`);
  return number;
}
