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

export type DurableSubscriptionState =
  | {
      readonly type: "inactive";
      readonly id: string;
      readonly record: DurableSubscriptionRecord;
    }
  | {
      readonly type: "claim";
      readonly id: string;
      readonly owner: string;
    }
  | {
      readonly type: "cancel";
      readonly id: string;
    };

/** Storage spec for service-owned inactive subscription records. */
export const durableSubscriptionRecordSpec: RecordSpec<string, Any> = new RecordSpec<string, Any>({
  schema: AnySchema,
  extractId: (record) => DurableSubscriptionRecords.readState(record).id,
});

/** Encodes and decodes service-owned subscription persistence states. */
export const DurableSubscriptionRecords: Readonly<{
  cancel(id: string): Any;
  claim(id: string, owner: string): Any;
  read(record: Any, expectedId?: string): DurableSubscriptionRecord;
  readState(record: Any, expectedId?: string): DurableSubscriptionState;
  write(record: DurableSubscriptionRecord): Any;
}> = Object.freeze({
  cancel(id: string): Any {
    return writeState(cancelTypeUrl, {
      id: requireToken(id, "Durable subscription ID"),
    });
  },

  claim(id: string, owner: string): Any {
    return writeState(claimTypeUrl, {
      id: requireToken(id, "Durable subscription ID"),
      owner: requireToken(owner, "Durable subscription owner"),
    });
  },

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
      subscription: readSubscription(stored.subscriptionBinaryBase64, stored.id),
      expiresAtMs: stored.expiresAtMs,
    });
  },

  readState(record: Any, expectedId?: string): DurableSubscriptionState {
    const state = readState(record);
    if (expectedId !== undefined && state.id !== expectedId) {
      throw new Error("Durable subscription record ID does not match storage key.");
    }
    return state;
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
      typeUrl: durableRecordTypeUrl,
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

const durableRecordTypeUrl = "type.spine-ts.dev/internal/DurableSubscriptionRecord";
const claimTypeUrl = "type.spine-ts.dev/internal/DurableSubscriptionClaim";
const cancelTypeUrl = "type.spine-ts.dev/internal/DurableSubscriptionCancel";
const durableRecordMaxBytes = 33_554_432;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function readSubscription(encoded: string, recordId: string): Subscription {
  if (!hasCanonicalBase64Alphabet(encoded)) {
    throw new Error("Durable subscription payload must be canonical Base64.");
  }
  const binary = Buffer.from(encoded, "base64");
  if (binary.toString("base64") !== encoded) {
    throw new Error("Durable subscription payload must be canonical Base64.");
  }
  const subscription = fromBinary(SubscriptionSchema, binary);
  if (subscription.id?.value !== recordId) {
    throw new Error("Durable subscription payload ID does not match record ID.");
  }
  return subscription;
}

function hasCanonicalBase64Alphabet(encoded: string): boolean {
  if (encoded.length % 4 !== 0) {
    return false;
  }

  let padding = 0;
  for (let index = 0; index < encoded.length; index += 1) {
    const code = encoded.charCodeAt(index);
    const isAlphabet =
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a) ||
      (code >= 0x30 && code <= 0x39) ||
      code === 0x2b ||
      code === 0x2f;
    if (isAlphabet && padding === 0) {
      continue;
    }
    if (code !== 0x3d || index < encoded.length - 2 || ++padding > 2) {
      return false;
    }
  }
  return true;
}

function readState(record: Any): DurableSubscriptionState {
  if (record.typeUrl === durableRecordTypeUrl) {
    const inactive = DurableSubscriptionRecords.read(record);
    return Object.freeze({ type: "inactive", id: inactive.id, record: inactive });
  }

  const value = readJsonObject(record);
  if (record.typeUrl === claimTypeUrl) {
    requireExactKeys(value, ["id", "owner"], "Durable subscription claim");
    return Object.freeze({
      type: "claim",
      id: requireToken(value.id, "Durable subscription ID"),
      owner: requireToken(value.owner, "Durable subscription owner"),
    });
  }
  if (record.typeUrl === cancelTypeUrl) {
    requireExactKeys(value, ["id"], "Durable subscription cancel");
    return Object.freeze({
      type: "cancel",
      id: requireToken(value.id, "Durable subscription ID"),
    });
  }
  throw new Error("Durable subscription record type URL is invalid.");
}

function readStoredRecord(record: Any): StoredSubscriptionRecord {
  if (record.typeUrl !== durableRecordTypeUrl) {
    throw new Error("Durable subscription record type URL is invalid.");
  }

  const value = readJsonObject(record);
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

function readJsonObject(record: Any): Record<string, unknown> {
  if (record.value.byteLength > durableRecordMaxBytes) {
    throw new Error("Durable subscription record exceeds 33554432 encoded bytes.");
  }
  const decoded = JSON.parse(utf8Decoder.decode(record.value)) as unknown;
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
    throw new Error("Durable subscription record is not a JSON object.");
  }

  return decoded as Record<string, unknown>;
}

function requireExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} must contain exactly ${expected.join(" and ")}.`);
  }
}

function writeState(typeUrl: string, value: Readonly<Record<string, string>>): Any {
  return create(AnySchema, {
    typeUrl,
    value: new TextEncoder().encode(JSON.stringify(value)),
  });
}

function requireToken(value: unknown, label: string): string {
  const token = requireText(value, label);
  if (token.trim() !== token) {
    throw new Error(`${label} must not have surrounding whitespace.`);
  }
  return token;
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
