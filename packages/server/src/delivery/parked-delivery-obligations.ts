/** @internal Finite package-owned table for unresolved delivery obligations. */
export class ParkedDeliveryObligations {
  readonly #configured = new Map<string, ConfiguredObligation>();
  readonly #records = new Map<string, MutableRecord>();
  #shared: ConfiguredObligation;

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
      key: recordKey(sharedOwner, "shared"),
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
    requireOccurrences(occurrences);
    const configured = this.#configuredObligation(owner, obligation, units);
    const record = this.#record(configured, units);
    record.occurrences = saturatingAdd(record.occurrences, occurrences);
    recordCauses(record, cause, units, configured.units);
  }

  parkFulfilledFailed(owner: ParkedOwner, obligation: string, units: readonly string[]): void {
    const configured = this.#configuredObligation(owner, obligation, units);
    this.#fulfill(configured, units);
    this.#record(configured, units);
  }

  parkShared(units: readonly string[], cause: unknown, occurrences = 1): void {
    requireOccurrences(occurrences);
    const configured = this.#configuredObligation(sharedOwner, "shared", units);
    const record = this.#record(configured, units);
    record.occurrences = saturatingAdd(record.occurrences, occurrences);
    recordCauses(record, cause, units, configured.units);
  }

  /** @internal Extend one live registration's exact configured unit domain in stable order. */
  extendRegistration(token: string, obligation: string, units: readonly string[]): void {
    this.#extendConfigured(registrationOwner(token), obligation, units);
    this.#extendConfigured(generationOwner, "generation", units);
    this.#shared = Object.freeze({
      ...this.#shared,
      units: Object.freeze(appendUnits(this.#shared.units, units)),
    });
  }

  report(selections: readonly ParkedDeliveryObligationSelection[]): readonly unknown[] {
    const selected = this.#selectedUnits(selections);
    const causes: unknown[] = [];
    for (const configured of this.#configured.values()) {
      this.#reportRecord(configured, selected.get(configured.key), causes);
    }
    this.#reportRecord(this.#shared, selected.get(this.#shared.key), causes);
    return Object.freeze(causes);
  }

  fulfilled(owner: ParkedOwner, obligation: string, units: readonly string[]): void {
    const configured = this.#configuredObligation(owner, obligation, units);
    this.#fulfill(configured, units);
  }

  removeRegistration(token: string): void {
    const plan = this.#reclassificationPlan(token);
    for (const { sourceKey } of plan) {
      this.#records.delete(sourceKey);
    }
    for (const { destinations } of plan) {
      for (const { configured, source } of destinations) {
        this.#coalesce(configured, source);
      }
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

  #extendConfigured(owner: ParkedOwner, obligation: string, units: readonly string[]): void {
    if (units.length === 0) {
      return;
    }
    const key = recordKey(owner, obligation);
    const existing = this.#configured.get(key);
    if (existing === undefined) {
      this.#addConfigured({ key, owner, obligation, units });
      return;
    }
    this.#configured.set(
      key,
      Object.freeze({
        ...existing,
        units: Object.freeze(appendUnits(existing.units, units)),
      }),
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
      existing.units = orderUnits([...existing.units, ...units], configured.units);
      return existing;
    }
    const record: MutableRecord = {
      key: configured.key,
      owner: configured.owner,
      obligation: configured.obligation,
      units: orderUnits(units, configured.units),
      occurrences: 0,
      causes: new Map(),
      reportedSinceResolution: false,
    };
    this.#records.set(configured.key, record);
    return record;
  }

  #fulfill(configured: ConfiguredObligation, units: readonly string[]): void {
    const record = this.#records.get(configured.key);
    if (record === undefined) {
      return;
    }
    const resolved = new Set(units);
    record.units = record.units.filter((unit) => !resolved.has(unit));
    for (const unit of resolved) {
      record.causes.delete(unit);
    }
    if (record.units.length === 0) {
      this.#records.delete(configured.key);
    }
  }

  #selectedUnits(
    selections: readonly ParkedDeliveryObligationSelection[],
  ): ReadonlyMap<string, ReadonlySet<string>> {
    const selected = new Map<string, Set<string>>();
    for (const selection of selections) {
      const configured = this.#configuredObligation(
        selection.owner,
        selection.obligation,
        selection.units,
      );
      const units = selected.get(configured.key) ?? new Set<string>();
      for (const unit of selection.units) {
        units.add(unit);
      }
      selected.set(configured.key, units);
    }
    return selected;
  }

  #reportRecord(
    configured: ConfiguredObligation,
    selected: ReadonlySet<string> | undefined,
    causes: unknown[],
  ): void {
    const record = this.#records.get(configured.key);
    if (record === undefined || selected === undefined) {
      return;
    }
    const representative = representativeCause(record, configured.units);
    if (
      representative === undefined ||
      representative.evidence.reported ||
      !selected.has(representative.unit)
    ) {
      return;
    }
    causes.push(representative.evidence.cause);
    representative.evidence.reported = true;
    record.reportedSinceResolution = true;
  }

  #reclassificationPlan(token: string): readonly Reclassification[] {
    const plan: Reclassification[] = [];
    for (const [sourceKey, source] of this.#records) {
      if (source.owner.kind !== "registration" || source.owner.token !== token) {
        continue;
      }
      plan.push({ sourceKey, destinations: this.#generationDestinations(source) });
    }
    return plan;
  }

  #generationDestinations(source: MutableRecord): readonly ReclassificationDestination[] {
    const generation = Array.from(this.#configured.values()).filter(
      (configured) => configured.owner.kind === "generation",
    );
    const grouped = new Map<string, string[]>();
    for (const unit of source.units) {
      const destination = generation.find((configured) => configured.units.includes(unit));
      if (destination === undefined) {
        throw new Error(
          "Removed registration obligation has no configured generation destination.",
        );
      }
      const units = grouped.get(destination.key) ?? [];
      units.push(unit);
      grouped.set(destination.key, units);
    }
    return generation.flatMap((configured) => {
      const units = grouped.get(configured.key);
      return units === undefined ? [] : [{ configured, source: reclassifiedSource(source, units) }];
    });
  }

  #coalesce(destination: ConfiguredObligation, source: MutableRecord): void {
    const target = this.#record(destination, source.units);
    target.occurrences = saturatingAdd(target.occurrences, source.occurrences);
    target.reportedSinceResolution ||= source.reportedSinceResolution;
    for (const [unit, evidence] of source.causes) {
      const existing = target.causes.get(unit);
      if (existing === undefined || (existing.reported && !evidence.reported)) {
        target.causes.set(unit, { ...evidence });
      }
    }
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

/** @internal Exact package-local record units eligible for reporting. */
export interface ParkedDeliveryObligationSelection {
  readonly owner: ParkedOwner;
  readonly obligation: string;
  readonly units: readonly string[];
}

/** @internal Immutable inspection result for package-local lifecycle consumers. */
export interface ParkedDeliveryObligationRecord {
  readonly owner: ParkedOwner;
  readonly obligation: string;
  readonly units: readonly string[];
  readonly cause: unknown;
  readonly hasCause: boolean;
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
  causes: Map<string, MutableCause>;
  reportedSinceResolution: boolean;
}

interface MutableCause {
  cause: unknown;
  reported: boolean;
}

interface Reclassification {
  readonly sourceKey: string;
  readonly destinations: readonly ReclassificationDestination[];
}

interface ReclassificationDestination {
  readonly configured: ConfiguredObligation;
  readonly source: MutableRecord;
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

function appendUnits(existing: readonly string[], added: readonly string[]): string[] {
  return Array.from(new Set([...existing, ...added]));
}

function recordCauses(
  record: MutableRecord,
  cause: unknown,
  units: readonly string[],
  configured: readonly string[],
): void {
  for (const unit of orderUnits(units, configured)) {
    const existing = record.causes.get(unit);
    if (existing === undefined || existing.reported) {
      record.causes.set(unit, { cause, reported: false });
    }
  }
}

function representativeCause(
  record: MutableRecord,
  configured: readonly string[],
): { readonly unit: string; readonly evidence: MutableCause } | undefined {
  for (const unit of configured) {
    if (!record.units.includes(unit)) {
      continue;
    }
    const evidence = record.causes.get(unit);
    if (evidence !== undefined) {
      return { unit, evidence };
    }
  }
  return undefined;
}

function reclassifiedSource(source: MutableRecord, units: readonly string[]): MutableRecord {
  const selected = new Set(units);
  return {
    ...source,
    units: [...units],
    causes: new Map(
      Array.from(source.causes)
        .filter(([unit]) => selected.has(unit))
        .map(([unit, evidence]) => [unit, { ...evidence }] as const),
    ),
  };
}

function requireOccurrences(increment: number): void {
  if (!Number.isSafeInteger(increment) || increment <= 0) {
    throw new Error("Parked delivery occurrence increment must be a positive safe integer.");
  }
}

function saturatingAdd(current: number, increment: number): number {
  return current >= Number.MAX_SAFE_INTEGER - increment
    ? Number.MAX_SAFE_INTEGER
    : current + increment;
}

function snapshot(record: MutableRecord): ParkedDeliveryObligationRecord {
  const representative = representativeCause(record, record.units);
  return Object.freeze({
    owner: record.owner,
    obligation: record.obligation,
    units: Object.freeze([...record.units]),
    cause: representative?.evidence.cause,
    hasCause: representative !== undefined,
    occurrences: record.occurrences,
    reportedSinceResolution: record.reportedSinceResolution,
  });
}
