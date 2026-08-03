import { create } from "@bufbuild/protobuf";
import { AnySchema, type Any, type Timestamp } from "@bufbuild/protobuf/wkt";
import type { SignedTokenRevocation } from "@spine-event-engine/auth";
import { RecordSpec, type RecordStorage, type StorageFactory } from "@spine-event-engine/storage";

const recordKey = "revocations";
const typeUrl = "type.spine.examples.messageboard/internal/SessionRevocations";
const recordLimit = 1_000;
const byteLimit = 64 * 1024;
const retryLimit = 32;

interface RevocationRecord {
  readonly jti: string;
  readonly expiresAt: string;
}

/**
 * Stores a bounded, durable set of immediately revoked MessageBoard session IDs.
 */
export class MessageBoardSessionRevocations implements SignedTokenRevocation {
  readonly kind = "supported" as const;
  readonly #storage: RecordStorage<string, Any>;

  /**
   * Opens a namespace-isolated revocation record using application-selected storage.
   *
   * @param storageFactory The storage factory selected by the MessageBoard application.
   * @param namespace The deployment-shared namespace that isolates this revocation set.
   */
  constructor(storageFactory: StorageFactory, namespace: string) {
    const isolated = SessionRevocationValues.namespace(namespace);
    this.#storage = storageFactory.createRecordStorage(
      { name: `spine.message-board.session-revocations.${isolated}`, multitenant: false },
      new RecordSpec({
        schema: AnySchema,
        storageKey: `spine.examples.messageboard.SessionRevocations:${isolated}:v1`,
        idKind: "string",
        extractId: () => recordKey,
      }),
    );
    if (!this.#storage.atomicCompareAndSet) {
      this.#storage.close();
      throw new Error("MessageBoard session revocation requires atomic compare-and-set.");
    }
  }

  /**
   * Checks whether a session identifier remains revoked.
   *
   * @param jti The exact signed session identifier.
   * @returns Whether the identifier has not yet expired and is revoked.
   */
  async isRevoked(jti: string): Promise<boolean> {
    return (await this.#records()).some((record) => record.jti === jti);
  }

  /**
   * Retains a session identifier through its signed expiry.
   *
   * @param jti The exact signed session identifier.
   * @param expiresAt The signed token expiry.
   * @returns Completes after the conditional durable write succeeds.
   */
  async revoke(jti: string, expiresAt: Timestamp): Promise<void> {
    const record = SessionRevocationValues.record({ jti, expiresAt: expiresAt.seconds.toString() });
    await this.#change((records) => {
      const next = records.filter((candidate) => candidate.jti !== record.jti);
      if (next.length >= recordLimit) throw new Error("MessageBoard session revocation is full.");
      return [...next, record];
    });
  }

  async #records(): Promise<readonly RevocationRecord[]> {
    const now = SessionRevocationValues.now();
    const records = SessionRevocationValues.read(await this.#storage.read(recordKey));
    return records.filter((record) => SessionRevocationValues.expiry(record) >= now);
  }

  async #change(
    change: (records: readonly RevocationRecord[]) => readonly RevocationRecord[],
  ): Promise<void> {
    for (let attempt = 0; attempt < retryLimit; attempt += 1) {
      const current = await this.#storage.read(recordKey);
      const active = SessionRevocationValues.read(current).filter(
        (record) => SessionRevocationValues.expiry(record) >= SessionRevocationValues.now(),
      );
      const next = SessionRevocationValues.write(change(active));
      if (await this.#storage.compareAndSet(recordKey, current, next)) return;
    }
    throw new Error("MessageBoard session revocation update did not converge.");
  }
}

/**
 * Encodes and validates private MessageBoard session-revocation state.
 */
const SessionRevocationValues = Object.freeze({
  namespace(value: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value))
      throw new Error("MessageBoard session revocation namespace is invalid.");
    return value;
  },

  now(): bigint {
    const seconds = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(seconds) || seconds < 0)
      throw new Error("MessageBoard clock is invalid.");
    return BigInt(seconds);
  },

  expiry(record: RevocationRecord): bigint {
    return BigInt(record.expiresAt);
  },

  read(stored: Any | undefined): readonly RevocationRecord[] {
    if (stored === undefined) return [];
    if (stored.typeUrl !== typeUrl) throw new Error("MessageBoard session revocation is invalid.");
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stored.value));
    } catch {
      throw new Error("MessageBoard session revocation is invalid.");
    }
    if (!Array.isArray(value) || value.length > recordLimit)
      throw new Error("MessageBoard session revocation is invalid.");
    return Object.freeze(value.map((record) => this.record(record)));
  },

  write(records: readonly RevocationRecord[]): Any {
    const value = new TextEncoder().encode(JSON.stringify(records));
    if (value.byteLength > byteLimit)
      throw new Error("MessageBoard session revocation exceeds its byte limit.");
    return create(AnySchema, { typeUrl, value });
  },

  record(value: unknown): RevocationRecord {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new Error("MessageBoard session revocation is invalid.");
    const candidate = value as Partial<RevocationRecord>;
    if (
      typeof candidate.jti !== "string" ||
      !/^[A-Za-z0-9_-]{22}$/u.test(candidate.jti) ||
      typeof candidate.expiresAt !== "string" ||
      !/^[0-9]+$/u.test(candidate.expiresAt) ||
      BigInt(candidate.expiresAt) > 253_402_300_799n
    )
      throw new Error("MessageBoard session revocation is invalid.");
    return Object.freeze({ jti: candidate.jti, expiresAt: candidate.expiresAt });
  },
});
