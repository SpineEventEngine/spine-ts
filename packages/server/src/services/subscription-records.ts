import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import {
  SubscriptionSchema,
  type Subscription,
} from "@spine-ts/proto/generated/spine/client/subscription_pb.js";
import { RecordSpec } from "@spine-ts/storage";

/** Durable inactive subscription record persisted by SubscriptionService. */
export interface DurableSubscriptionRecord {
  readonly id: string;
  readonly kind: "event" | "state";
  readonly targetType: string;
  readonly tenantId?: string;
  readonly subscription: Subscription;
  readonly expiresAtMs: number;
}

/** Storage spec for service-owned inactive subscription records. */
export const durableSubscriptionRecordSpec: RecordSpec<string, Any> = new RecordSpec<string, Any>({
  schema: AnySchema,
  extractId: (record) => DurableSubscriptionRecords.read(record).id,
});

/** Encodes and decodes service-owned inactive subscription records. */
export const DurableSubscriptionRecords: Readonly<{
  read(record: Any, expectedId?: string): DurableSubscriptionRecord;
  write(record: DurableSubscriptionRecord): Any;
}> = Object.freeze({
  read(record: Any, expectedId?: string): DurableSubscriptionRecord {
    const stored = readStoredRecord(record);
    if (expectedId !== undefined && stored.id !== expectedId) {
      throw new Error("Durable subscription record ID does not match storage key.");
    }

    return Object.freeze({
      id: stored.id,
      kind: stored.kind,
      targetType: stored.targetType,
      ...(stored.tenantId === undefined ? {} : { tenantId: stored.tenantId }),
      subscription: fromBinary(
        SubscriptionSchema,
        Buffer.from(stored.subscriptionBinaryBase64, "base64"),
      ),
      expiresAtMs: stored.expiresAtMs,
    });
  },

  write(record: DurableSubscriptionRecord): Any {
    const stored: StoredSubscriptionRecord = {
      id: requireText(record.id, "Durable subscription ID"),
      kind: record.kind,
      targetType: requireText(record.targetType, "Durable subscription target type"),
      ...(record.tenantId === undefined ? {} : { tenantId: record.tenantId }),
      subscriptionBinaryBase64: Buffer.from(
        toBinary(SubscriptionSchema, record.subscription),
      ).toString("base64"),
      expiresAtMs: requireTime(record.expiresAtMs, "Durable subscription expiry"),
    };

    return create(AnySchema, {
      typeUrl: durableSubscriptionRecordTypeUrl,
      value: new TextEncoder().encode(JSON.stringify(stored)),
    });
  },
});

interface StoredSubscriptionRecord {
  readonly id: string;
  readonly kind: "event" | "state";
  readonly targetType: string;
  readonly tenantId?: string;
  readonly subscriptionBinaryBase64: string;
  readonly expiresAtMs: number;
}

const durableSubscriptionRecordTypeUrl = "type.spine-ts.dev/internal/DurableSubscriptionRecord";
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function readStoredRecord(record: Any): StoredSubscriptionRecord {
  if (record.typeUrl !== durableSubscriptionRecordTypeUrl) {
    throw new Error("Durable subscription record type URL is invalid.");
  }

  const decoded = JSON.parse(utf8Decoder.decode(record.value)) as unknown;
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
    throw new Error("Durable subscription record is not a JSON object.");
  }

  const value = decoded as Record<string, unknown>;
  const kind = value.kind;
  if (kind !== "event" && kind !== "state") {
    throw new Error("Durable subscription record kind is invalid.");
  }

  return Object.freeze({
    id: requireText(value.id, "Durable subscription ID"),
    kind,
    targetType: requireText(value.targetType, "Durable subscription target type"),
    ...(value.tenantId === undefined
      ? {}
      : { tenantId: requireText(value.tenantId, "Durable subscription tenant") }),
    subscriptionBinaryBase64: requireText(
      value.subscriptionBinaryBase64,
      "Durable subscription payload",
    ),
    expiresAtMs: requireTime(value.expiresAtMs, "Durable subscription expiry"),
  });
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }

  return value;
}

function requireTime(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number.`);
  }

  return value;
}
