import { create } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import type { RemovalQuarantineRecord } from "@spine-event-engine/delivery-client";
import { RecordSpec, type RecordStorage, type StorageFactory } from "@spine-event-engine/storage";

const context = { name: "spine.message-board.delivery-quarantine", multitenant: false };
const storageKey = "spine.examples.messageboard.DeliveryQuarantine:v1";
const recordKey = "records";
const recordLimit = 100;
const retryLimit = 32;
const tokenBytes = 256;
const serializedBytes = 64 * 1024;
const typeUrl = "type.spine.examples.messageboard/internal/DeliveryQuarantine";

/**
 * Stores bounded recovery records for MessageBoard remote delivery operations.
 */
export class DeliveryQuarantine {
  readonly #storage: RecordStorage<string, Any>;

  /**
   * Opens a durable, namespace-isolated quarantine using the application's storage factory.
   *
   * @param storageFactory The application-selected storage factory.
   */
  constructor(storageFactory: StorageFactory) {
    this.#storage = storageFactory.createRecordStorage(
      context,
      new RecordSpec({
        schema: AnySchema,
        storageKey,
        idKind: "string",
        extractId: () => recordKey,
      }),
    );
    if (!this.#storage.atomicCompareAndSet) {
      this.#storage.close();
      throw new Error("MessageBoard delivery quarantine requires atomic compare-and-set.");
    }
  }

  /**
   * Reads one durable recovery record.
   *
   * @param id The remote inbox-message key.
   * @returns The matching recovery record when present.
   */
  async get(id: string): Promise<RemovalQuarantineRecord | undefined> {
    return (await this.#records()).find((record) => record.id === id);
  }

  /**
   * Stores one recovery record before remote delivery work continues.
   *
   * @param record The bounded recovery record to persist.
   * @returns A promise that resolves after a conditional durable write.
   */
  async put(record: RemovalQuarantineRecord): Promise<void> {
    const valid = QuarantineValues.record(record);
    await this.#change((records) => {
      const next = records.filter((candidate) => candidate.id !== valid.id);
      if (next.length >= recordLimit) throw new Error("MessageBoard delivery quarantine is full.");
      return [...next, valid];
    });
  }

  /**
   * Deletes one recovery record after the remote state is confirmed.
   *
   * @param id The remote inbox-message key.
   * @returns A promise that resolves after a conditional durable deletion.
   */
  async delete(id: string): Promise<void> {
    await this.#change((records) => records.filter((record) => record.id !== id));
  }

  /**
   * Closes the owned storage handle without closing the application storage factory.
   */
  close(): void {
    this.#storage.close();
  }

  async #records(): Promise<readonly RemovalQuarantineRecord[]> {
    return QuarantineValues.read(await this.#storage.read(recordKey));
  }

  async #change(
    change: (records: readonly RemovalQuarantineRecord[]) => readonly RemovalQuarantineRecord[],
  ): Promise<void> {
    for (let attempt = 0; attempt < retryLimit; attempt += 1) {
      const current = await this.#storage.read(recordKey);
      const next = QuarantineValues.write(change(QuarantineValues.read(current)));
      if (await this.#storage.compareAndSet(recordKey, current, next)) return;
    }
    throw new Error("MessageBoard delivery quarantine update did not converge.");
  }
}

/**
 * Encodes and validates private MessageBoard quarantine state.
 */
const QuarantineValues = Object.freeze({
  read(stored: Any | undefined): readonly RemovalQuarantineRecord[] {
    if (stored === undefined) return [];
    if (stored.typeUrl !== typeUrl) throw new Error("MessageBoard delivery quarantine is invalid.");
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stored.value));
    } catch {
      throw new Error("MessageBoard delivery quarantine is invalid.");
    }
    if (!Array.isArray(value) || value.length > recordLimit)
      throw new Error("MessageBoard delivery quarantine is invalid.");
    return Object.freeze(value.map((record) => this.record(record)));
  },

  write(records: readonly RemovalQuarantineRecord[]): Any {
    const value = new TextEncoder().encode(JSON.stringify(records));
    if (value.byteLength > serializedBytes)
      throw new Error("MessageBoard delivery quarantine exceeds its byte limit.");
    return create(AnySchema, { typeUrl, value });
  },

  record(value: unknown): RemovalQuarantineRecord {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new Error("MessageBoard delivery quarantine is invalid.");
    const candidate = value as Partial<RemovalQuarantineRecord>;
    if (
      !this.token(candidate.id) ||
      typeof candidate.fingerprint !== "string" ||
      !/^[a-f0-9]{64}$/u.test(candidate.fingerprint) ||
      (candidate.phase !== "ADMITTED" && candidate.phase !== "REMOVING")
    ) {
      throw new Error("MessageBoard delivery quarantine is invalid.");
    }
    return Object.freeze({
      id: candidate.id,
      fingerprint: candidate.fingerprint,
      phase: candidate.phase,
    });
  },

  token(value: unknown): value is string {
    return (
      typeof value === "string" &&
      value.length > 0 &&
      Buffer.byteLength(value, "utf8") <= tokenBytes
    );
  },
});
