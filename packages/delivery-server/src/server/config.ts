import type { DeliveryServerOptions } from "./delivery-server.js";

export interface DeliveryConfiguration {
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
      4_194_304,
      1,
      2_147_483_647,
      "inbound message size",
    ),
    processingTimeoutMs:
      numberOption(
        options.processingTimeoutSeconds,
        "SHARD_PROCESSING_TIMEOUT",
        0,
        0,
        2_147_483_647,
        "processing timeout",
      ) * 1_000,
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
