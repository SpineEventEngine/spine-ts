/** @internal Finite package-owned table for unresolved delivery obligations. */
export class ParkedDeliveryObligations {
  readonly #configured = new Map<string, ConfiguredObligation>();
  readonly #records = new Map<string, MutableRecord>();
  readonly #shared: ConfiguredObligation;

  constructor(options: ParkedDeliveryObligationOptions) {
    for (const registration of options.registrations) {
      for (const obligation of registration.obligations) {
        this.#addConfigured({
          key: recordKey(registrationOwner(registration.token), obligation.key),
          owner: registrationOwner(registration.token),
          obligation: obligation.key,
          units: obligation.units,
        });
      }
    }
    for (const obligation of options.generation) {
      this.#addConfigured({
        key: recordKey(generationOwner, obligation.key),
        owner: generationOwner,
        obligation: obligation.key,
        units: obligation.units,
      });
    }
    const units = Array.from(new Set(options.generation.flatMap((obligation) => obligation.units)));
    if (units.length === 0) {
      throw new Error("Parked delivery obligations require a generation obligation.");
    }
    this.#shared = Object.freeze({
      key: "shared",
      owner: sharedOwner,
      obligation: "shared",
      units: Object.freeze(units),
    });
  }

  park(
    owner: ParkedOwner,
    obligation: string,
    units: readonly string[],
    cause: unknown,
    occurrences = 1,
  ): void {
    const configured = this.#configuredObligation(owner, obligation, units);
    const record = this.#record(configured, units);
    record.occurrences = saturatingAdd(record.occurrences, occurrences);
    if (record.cause === undefined || record.reported) {
      record.cause = cause;
      record.causeUnit = firstUnit(units, configured.units);
      record.reported = false;
    }
  }

  parkFulfilledFailed(owner: ParkedOwner, obligation: string, units: readonly string[]): void {
    const configured = this.#configuredObligation(owner, obligation, units);
    this.#record(configured, units);
  }

  parkShared(units: readonly string[], cause: unknown, occurrences = 1): void {
    if (!isConfiguredSubset(units, this.#shared.units)) {
      throw new Error("Parked delivery shared obligation is not configured.");
    }
    const record = this.#record(this.#shared, units);
    record.occurrences = saturatingAdd(record.occurrences, occurrences);
    if (record.cause === undefined || record.reported) {
      record.cause = cause;
      record.causeUnit = firstUnit(units, this.#shared.units);
      record.reported = false;
    }
  }

  report(): readonly unknown[] {
    const causes: unknown[] = [];
    for (const configured of this.#configured.values()) {
      const record = this.#records.get(configured.key);
      if (record === undefined) {
        continue;
      }
      if (record.cause !== undefined && !record.reported) {
        causes.push(record.cause);
        record.reported = true;
        record.reportedSinceResolution = true;
      }
    }
    const shared = this.#records.get(this.#shared.key);
    if (shared?.cause !== undefined && !shared.reported) {
      causes.push(shared.cause);
      shared.reported = true;
      shared.reportedSinceResolution = true;
    }
    return Object.freeze(causes);
  }

  fulfilled(owner: ParkedOwner, obligation: string, units: readonly string[]): void {
    const configured = this.#configuredObligation(owner, obligation, units);
    const record = this.#records.get(configured.key);
    if (record === undefined) {
      return;
    }
    const resolved = new Set(units);
    record.units = record.units.filter((unit) => !resolved.has(unit));
    if (record.units.length === 0) {
      this.#records.delete(configured.key);
    }
  }

  removeRegistration(token: string): void {
    for (const [key, record] of this.#records) {
      if (record.owner.kind !== "registration" || record.owner.token !== token) {
        continue;
      }
      this.#records.delete(key);
      const destination = this.#generationDestination(record.units);
      this.#coalesce(destination, record);
    }
    for (const [key, configured] of this.#configured) {
      if (configured.owner.kind === "registration" && configured.owner.token === token) {
        this.#configured.delete(key);
      }
    }
  }

  records(): readonly ParkedDeliveryObligationRecord[] {
    return Object.freeze(Array.from(this.#records.values(), snapshot));
  }

  #addConfigured(configured: ConfiguredObligation): void {
    const key = configured.key;
    if (this.#configured.has(key) || configured.units.length === 0) {
      throw new Error(
        "Parked delivery obligations require unique non-empty configured obligations.",
      );
    }
    this.#configured.set(
      key,
      Object.freeze({ ...configured, units: Object.freeze([...configured.units]) }),
    );
  }

  #configuredObligation(
    owner: ParkedOwner,
    obligation: string,
    units: readonly string[],
  ): ConfiguredObligation {
    if (
      owner.kind === "shared" &&
      obligation === "shared" &&
      isConfiguredSubset(units, this.#shared.units)
    ) {
      return this.#shared;
    }
    const configured = this.#configured.get(recordKey(owner, obligation));
    if (configured === undefined || !isConfiguredSubset(units, configured.units)) {
      throw new Error("Parked delivery obligation is not configured.");
    }
    return configured;
  }

  #record(configured: ConfiguredObligation, units: readonly string[]): MutableRecord {
    const existing = this.#records.get(configured.key);
    if (existing !== undefined) {
      for (const unit of units) {
        if (!existing.units.includes(unit)) {
          existing.units.push(unit);
        }
      }
      existing.units = orderUnits(existing.units, configured.units);
      return existing;
    }
    const record: MutableRecord = {
      key: configured.key,
      owner: configured.owner,
      obligation: configured.obligation,
      units: orderUnits(units, configured.units),
      occurrences: 0,
      causeUnit: "",
      reportedSinceResolution: false,
      reported: false,
    };
    this.#records.set(configured.key, record);
    return record;
  }

  #generationDestination(units: readonly string[]): ConfiguredObligation {
    for (const configured of this.#configured.values()) {
      if (configured.owner.kind === "generation" && isConfiguredSubset(units, configured.units)) {
        return configured;
      }
    }
    throw new Error("Removed registration obligation has no configured generation destination.");
  }

  #coalesce(destination: ConfiguredObligation, source: MutableRecord): void {
    const target = this.#record(destination, source.units);
    target.occurrences = saturatingAdd(target.occurrences, source.occurrences);
    target.reportedSinceResolution ||= source.reportedSinceResolution;
    if (!shouldReplaceCause(target, source, destination.units)) {
      return;
    }
    target.cause = source.cause;
    target.causeUnit = source.causeUnit;
    target.reported = source.reported;
  }
}

/** @internal Truthful owner for a canonical parked delivery obligation. */
export type ParkedOwner =
  | { readonly kind: "generation" }
  | { readonly kind: "registration"; readonly token: string }
  | { readonly kind: "shared" };

/** @internal One configured canonical obligation. */
export interface ParkedConfiguredObligation {
  readonly key: string;
  readonly units: readonly string[];
}

/** @internal Configuration used to bound parked delivery records. */
export interface ParkedDeliveryObligationOptions {
  readonly registrations: readonly {
    readonly token: string;
    readonly obligations: readonly ParkedConfiguredObligation[];
  }[];
  readonly generation: readonly ParkedConfiguredObligation[];
}

/** @internal Immutable inspection result for package-local lifecycle consumers. */
export interface ParkedDeliveryObligationRecord {
  readonly owner: ParkedOwner;
  readonly obligation: string;
  readonly units: readonly string[];
  readonly cause?: unknown;
  readonly occurrences: number;
  readonly reportedSinceResolution: boolean;
}

interface ConfiguredObligation {
  readonly key: string;
  readonly owner: ParkedOwner;
  readonly obligation: string;
  readonly units: readonly string[];
}

interface MutableRecord extends ConfiguredObligation {
  units: string[];
  occurrences: number;
  cause?: unknown;
  causeUnit: string;
  reported: boolean;
  reportedSinceResolution: boolean;
}

const generationOwner = Object.freeze({ kind: "generation" } as const);
const sharedOwner = Object.freeze({ kind: "shared" } as const);

function registrationOwner(token: string): ParkedOwner {
  return Object.freeze({ kind: "registration", token });
}

function recordKey(owner: ParkedOwner, obligation: string): string {
  return JSON.stringify([
    owner.kind,
    owner.kind === "registration" ? owner.token : null,
    obligation,
  ]);
}

function isConfiguredSubset(units: readonly string[], configured: readonly string[]): boolean {
  return units.length > 0 && units.every((unit) => configured.includes(unit));
}

function orderUnits(units: readonly string[], configured: readonly string[]): string[] {
  const selected = new Set(units);
  return configured.filter((unit) => selected.has(unit));
}

function firstUnit(units: readonly string[], configured: readonly string[]): string {
  const first = orderUnits(units, configured)[0];
  if (first === undefined) {
    throw new Error("Parked delivery obligation requires at least one configured unit.");
  }
  return first;
}

function shouldReplaceCause(
  target: MutableRecord,
  source: MutableRecord,
  configured: readonly string[],
): boolean {
  if (source.cause === undefined) {
    return false;
  }
  if (target.cause === undefined || target.reported) {
    return !source.reported || target.cause === undefined;
  }
  if (source.reported) {
    return false;
  }
  return configured.indexOf(source.causeUnit) < configured.indexOf(target.causeUnit);
}

function saturatingAdd(current: number, increment: number): number {
  if (increment <= 0) {
    return current;
  }
  return current >= Number.MAX_SAFE_INTEGER - increment
    ? Number.MAX_SAFE_INTEGER
    : current + increment;
}

function snapshot(record: MutableRecord): ParkedDeliveryObligationRecord {
  return Object.freeze({
    owner: record.owner,
    obligation: record.obligation,
    units: Object.freeze([...record.units]),
    cause: record.cause,
    occurrences: record.occurrences,
    reportedSinceResolution: record.reportedSinceResolution,
  });
}
