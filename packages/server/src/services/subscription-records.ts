import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import { SubscriptionSchema, type Subscription } from "@spine-event-engine/proto/client";
import { RecordSpec } from "@spine-event-engine/storage";

/**
 * Durable inactive subscription record persisted by SubscriptionService.
 */
export interface DurableSubscriptionRecord {
  // prettier-ignore

  /**
   * Identifies this subscription record and its storage key.
   */
  readonly id: string;

  /**
   * Distinguishes state subscriptions from event subscriptions.
   */
  readonly kind: "event" | "state";

  /**
   * Names the subscribed state or event type URL.
   */
  readonly targetType: string;

  /**
   * Identifies the tenant that owns the subscription when present.
   */
  readonly tenantId?: string;

  /**
   * Preserves the client subscription that created this record.
   */
  readonly subscription: Subscription;

  /**
   * Gives the Unix time in milliseconds after which activation is rejected.
   */
  readonly expiresAtMs: number;
}

/**
 * Describes the durable lifecycle state stored for a subscription.
 */
export type DurableSubscriptionState =
  | {
      // prettier-ignore

      /**
       * Marks a persisted subscription awaiting activation.
       */
      readonly type: "inactive";

      /**
       * Identifies the durable subscription.
       */
      readonly id: string;

      /**
       * Holds the subscription awaiting activation.
       */
      readonly record: DurableSubscriptionRecord;
    }
  | {
      // prettier-ignore

      /**
       * Marks an activation claim held by one service instance.
       */
      readonly type: "claim";

      /**
       * Identifies the claimed subscription.
       */
      readonly id: string;

      /**
       * Identifies the service instance holding the claim.
       */
      readonly owner: string;
    }
  | {
      // prettier-ignore

      /**
       * Marks a cancellation fence awaiting deletion.
       */
      readonly type: "cancel";

      /**
       * Identifies the cancelled subscription.
       */
      readonly id: string;
    };

/**
 * Storage spec for service-owned inactive subscription records.
 */
export const durableSubscriptionRecordSpec: RecordSpec<string, Any> = new RecordSpec<string, Any>({
  schema: AnySchema,
  storageKey: "spine.server.Subscription:durable",
  idKind: "string",
  extractId: (record) => DurableSubscriptionRecords.readState(record).id,
});

/**
 * Encodes and decodes service-owned subscription persistence states.
 */
export const DurableSubscriptionRecords: Readonly<{
  cancel(id: string): Any;
  claim(id: string, owner: string): Any;
  read(record: Any, expectedId?: string): DurableSubscriptionRecord;
  readState(record: Any, expectedId?: string): DurableSubscriptionState;
  write(record: DurableSubscriptionRecord): Any;
}> = Object.freeze({
  cancel(id: string): Any {
    return SubscriptionRecordValues.writeState(cancelTypeUrl, {
      id: SubscriptionRecordValues.requireToken(id, "Durable subscription ID"),
    });
  },

  claim(id: string, owner: string): Any {
    return SubscriptionRecordValues.writeState(claimTypeUrl, {
      id: SubscriptionRecordValues.requireToken(id, "Durable subscription ID"),
      owner: SubscriptionRecordValues.requireToken(owner, "Durable subscription owner"),
    });
  },

  read(record: Any, expectedId?: string): DurableSubscriptionRecord {
    const stored = SubscriptionRecordValues.readStoredRecord(record);
    if (expectedId !== undefined && stored.id !== expectedId) {
      throw new Error("Durable subscription record ID does not match storage key.");
    }

    return Object.freeze({
      id: stored.id,
      kind: stored.kind,
      targetType: stored.targetType,
      ...(stored.tenantId === undefined ? {} : { tenantId: stored.tenantId }),
      subscription: SubscriptionRecordValues.readSubscription(
        stored.subscriptionBinaryBase64,
        stored.id,
      ),
      expiresAtMs: stored.expiresAtMs,
    });
  },

  readState(record: Any, expectedId?: string): DurableSubscriptionState {
    const state = SubscriptionRecordValues.readState(record);
    if (expectedId !== undefined && state.id !== expectedId) {
      throw new Error("Durable subscription record ID does not match storage key.");
    }
    return state;
  },

  write(record: DurableSubscriptionRecord): Any {
    const stored: StoredSubscriptionRecord = {
      id: SubscriptionRecordValues.requireText(record.id, "Durable subscription ID"),
      kind: record.kind,
      targetType: SubscriptionRecordValues.requireText(
        record.targetType,
        "Durable subscription target type",
      ),
      ...(record.tenantId === undefined ? {} : { tenantId: record.tenantId }),
      subscriptionBinaryBase64: Buffer.from(
        toBinary(SubscriptionSchema, record.subscription),
      ).toString("base64"),
      expiresAtMs: SubscriptionRecordValues.requireTime(
        record.expiresAtMs,
        "Durable subscription expiry",
      ),
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

/**
 * Holds validation and wire-format details for durable subscription records.
 */
const SubscriptionRecordValues = Object.freeze({
  readSubscription(encoded: string, recordId: string): Subscription {
    if (!this.hasCanonicalBase64(encoded)) {
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
  },

  hasCanonicalBase64(encoded: string): boolean {
    if (encoded.length % 4 !== 0) return false;
    let padding = 0;
    for (let index = 0; index < encoded.length; index += 1) {
      const code = encoded.charCodeAt(index);
      const isAlphabet =
        (code >= 0x41 && code <= 0x5a) ||
        (code >= 0x61 && code <= 0x7a) ||
        (code >= 0x30 && code <= 0x39) ||
        code === 0x2b ||
        code === 0x2f;
      if (isAlphabet && padding === 0) continue;
      if (code !== 0x3d || index < encoded.length - 2 || ++padding > 2) return false;
    }
    return true;
  },

  readState(record: Any): DurableSubscriptionState {
    if (record.typeUrl === durableRecordTypeUrl) {
      const inactive = DurableSubscriptionRecords.read(record);
      return Object.freeze({ type: "inactive" as const, id: inactive.id, record: inactive });
    }
    const value = this.readJsonObject(record);
    if (record.typeUrl === claimTypeUrl) {
      this.requireExactKeys(value, ["id", "owner"], "Durable subscription claim");
      return Object.freeze({
        type: "claim" as const,
        id: this.requireToken(value.id, "Durable subscription ID"),
        owner: this.requireToken(value.owner, "Durable subscription owner"),
      });
    }
    if (record.typeUrl === cancelTypeUrl) {
      this.requireExactKeys(value, ["id"], "Durable subscription cancel");
      return Object.freeze({
        type: "cancel" as const,
        id: this.requireToken(value.id, "Durable subscription ID"),
      });
    }
    throw new Error("Durable subscription record type URL is invalid.");
  },

  readStoredRecord(record: Any): StoredSubscriptionRecord {
    if (record.typeUrl !== durableRecordTypeUrl) {
      throw new Error("Durable subscription record type URL is invalid.");
    }
    const value = this.readJsonObject(record);
    const kind = value.kind;
    if (kind !== "event" && kind !== "state") {
      throw new Error("Durable subscription record kind is invalid.");
    }
    return Object.freeze({
      id: this.requireText(value.id, "Durable subscription ID"),
      kind,
      targetType: this.requireText(value.targetType, "Durable subscription target type"),
      ...(value.tenantId === undefined
        ? {}
        : { tenantId: this.requireText(value.tenantId, "Durable subscription tenant") }),
      subscriptionBinaryBase64: this.requireText(
        value.subscriptionBinaryBase64,
        "Durable subscription payload",
      ),
      expiresAtMs: this.requireTime(value.expiresAtMs, "Durable subscription expiry"),
    });
  },

  readJsonObject(record: Any): Record<string, unknown> {
    if (record.value.byteLength > durableRecordMaxBytes) {
      throw new Error("Durable subscription record exceeds 33554432 encoded bytes.");
    }
    const decoded = JSON.parse(utf8Decoder.decode(record.value)) as unknown;
    if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
      throw new Error("Durable subscription record is not a JSON object.");
    }
    return decoded as Record<string, unknown>;
  },

  requireExactKeys(
    value: Readonly<Record<string, unknown>>,
    expected: readonly string[],
    label: string,
  ): void {
    const actual = Object.keys(value).sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
      throw new Error(`${label} must contain exactly ${expected.join(" and ")}.`);
    }
  },

  writeState(typeUrl: string, value: Readonly<Record<string, string>>): Any {
    return create(AnySchema, {
      typeUrl,
      value: new TextEncoder().encode(JSON.stringify(value)),
    });
  },

  requireToken(value: unknown, label: string): string {
    const token = this.requireText(value, label);
    if (token.trim() !== token) throw new Error(`${label} must not have surrounding whitespace.`);
    return token;
  },

  requireText(value: unknown, label: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`${label} is required.`);
    }
    return value;
  },

  requireTime(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`${label} must be a non-negative finite number.`);
    }
    return value;
  },
});
