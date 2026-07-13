import type {
  DeliveryRunScope,
  DeliveryScopeSettlement,
} from "../delivery/delivery-run-coordinator.js";
import {
  ParkedDeliveryObligations,
  type ParkedDeliveryObligationRecord,
  type ParkedDeliveryObligationSelection,
} from "../delivery/parked-delivery-obligations.js";

/** @internal Generation-local mapping from configured scopes to canonical parked delivery obligations. */
export class EnvironmentDeliveryRecords {
  readonly #registrations = new Map<string, Map<string, DeliveryRunScope>>();
  readonly #scopes = new Map<string, DeliveryRunScope>();
  readonly #generationScopes = new Map<string, DeliveryRunScope>();
  #obligations: ParkedDeliveryObligations | undefined;

  get configuredScopeCount(): number {
    return this.#scopes.size;
  }

  /** @internal Register initial or dynamic scopes once, retaining their first configured order. */
  register(token: string, scopes: readonly DeliveryRunScope[]): void {
    const registered = this.#registrations.get(token) ?? new Map<string, DeliveryRunScope>();
    const added: string[] = [];
    for (const scope of scopes) {
      const key = scopeKey(scope);
      if (!registered.has(key)) {
        registered.set(key, scope);
        this.#scopes.set(key, scope);
        this.#generationScopes.set(key, scope);
        added.push(key);
      }
    }
    this.#registrations.set(token, registered);
    if (added.length === 0) {
      return;
    }
    if (this.#obligations === undefined) {
      this.#obligations = new ParkedDeliveryObligations({
        registrations: [{ token, obligations: [{ key: "delivery", units: added }] }],
        generation: [{ key: "generation", units: added }],
      });
      return;
    }
    this.#obligations.extendRegistration(token, "delivery", added);
  }

  /** @internal Observe one recorded coordinator settlement against its exact configured owner. */
  observe(settlement: DeliveryScopeSettlement): void {
    const tokens = this.#tokensFor(settlement.scope);
    const obligations = this.#requireObligations();
    const unit = scopeKey(settlement.scope);
    for (const token of tokens) {
      const owner = { kind: "registration" as const, token };
      switch (settlement.disposition) {
        case "REJECTED":
          obligations.park(owner, "delivery", [unit], settlement.cause);
          break;
        case "PARKED":
          obligations.parkFulfilledFailed(owner, "delivery", [unit]);
          break;
        case "IDLE":
          obligations.fulfilled(owner, "delivery", [unit]);
          break;
        case "STOPPED":
          break;
      }
    }
  }

  records(): readonly ParkedDeliveryObligationRecord[] {
    return this.#obligations?.records() ?? Object.freeze([]);
  }

  /** @internal Current registration-owned records for one opaque attachment handle. */
  registrationRecords(token: string): readonly ParkedDeliveryObligationRecord[] {
    return Object.freeze(
      this.records().filter(({ owner }) => owner.kind === "registration" && owner.token === token),
    );
  }

  /** @internal Stable configured scope order for a registration. */
  configuredScopes(token: string): readonly DeliveryRunScope[] {
    return Object.freeze([...(this.#registrations.get(token)?.values() ?? [])]);
  }

  /** @internal Stable configured scopes still pending or represented by parked records. */
  retainedScopes(token: string, pending: readonly DeliveryRunScope[]): readonly DeliveryRunScope[] {
    const retained = new Set(pending.map(scopeKey));
    for (const record of this.records()) {
      for (const unit of record.units) {
        retained.add(unit);
      }
    }
    return Object.freeze(
      this.configuredScopes(token).filter((scope) => retained.has(scopeKey(scope))),
    );
  }

  /** @internal Atomically select, report, consume, and remove one registration's ownership. */
  detach(token: string): readonly unknown[] {
    const registration = this.#registrations.get(token);
    if (registration === undefined) {
      throw new Error("Environment delivery registration is not configured.");
    }
    const units = [...registration.keys()];
    if (units.length === 0) {
      this.#registrations.delete(token);
      return Object.freeze([]);
    }
    const orphaned = units.filter((unit) => !this.#ownedBySibling(token, unit));
    const obligations = this.#requireObligations();
    obligations.removeRegistration(token);
    this.#registrations.delete(token);
    const selections: ParkedDeliveryObligationSelection[] = [];
    if (orphaned.length > 0) {
      selections.push({ owner: { kind: "generation" }, obligation: "generation", units: orphaned });
    }
    const causes = obligations.report(selections);
    if (orphaned.length > 0) {
      obligations.fulfilled({ kind: "generation" }, "generation", orphaned);
      for (const unit of orphaned) {
        this.#scopes.delete(unit);
      }
    }
    return causes;
  }

  /** @internal Remove failed-start ownership while retaining reported generation evidence. */
  rollback(token: string): readonly unknown[] {
    const registration = this.#registrations.get(token);
    if (registration === undefined) {
      throw new Error("Environment delivery registration is not configured.");
    }
    const units = [...registration.keys()];
    const causes = this.#requireObligations().report([
      { owner: { kind: "registration", token }, obligation: "delivery", units },
    ]);
    this.#requireObligations().removeRegistration(token);
    this.#registrations.delete(token);
    for (const unit of units) {
      if (!this.#ownedByAnyRegistration(unit)) {
        this.#scopes.delete(unit);
      }
    }
    return causes;
  }

  /** @internal Atomically select, report, and consume every generation record. */
  retire(): readonly unknown[] {
    if (this.#obligations === undefined) {
      this.#registrations.clear();
      this.#scopes.clear();
      this.#generationScopes.clear();
      return Object.freeze([]);
    }
    const obligations = this.#requireObligations();
    const units = [...this.#generationScopes.keys()];
    const selections: ParkedDeliveryObligationSelection[] = [];
    for (const [token, scopes] of this.#registrations) {
      selections.push({
        owner: { kind: "registration", token },
        obligation: "delivery",
        units: [...scopes.keys()],
      });
    }
    if (units.length > 0) {
      selections.push({ owner: { kind: "generation" }, obligation: "generation", units });
      selections.push({ owner: { kind: "shared" }, obligation: "shared", units });
    }
    const causes = obligations.report(selections);
    for (const token of [...this.#registrations.keys()]) {
      obligations.removeRegistration(token);
    }
    if (units.length > 0) {
      obligations.fulfilled({ kind: "generation" }, "generation", units);
      obligations.fulfilled({ kind: "shared" }, "shared", units);
    }
    this.#registrations.clear();
    this.#scopes.clear();
    this.#generationScopes.clear();
    return causes;
  }

  #tokensFor(scope: DeliveryRunScope): readonly string[] {
    const key = scopeKey(scope);
    const tokens: string[] = [];
    for (const [token, scopes] of this.#registrations) {
      if (scopes.has(key)) {
        tokens.push(token);
      }
    }
    if (tokens.length === 0) {
      throw new Error("Environment delivery settlement scope is not registered.");
    }
    return tokens;
  }

  #ownedBySibling(token: string, unit: string): boolean {
    for (const [candidate, scopes] of this.#registrations) {
      if (candidate !== token && scopes.has(unit)) {
        return true;
      }
    }
    return false;
  }

  #ownedByAnyRegistration(unit: string): boolean {
    for (const scopes of this.#registrations.values()) {
      if (scopes.has(unit)) {
        return true;
      }
    }
    return false;
  }

  #requireObligations(): ParkedDeliveryObligations {
    if (this.#obligations === undefined) {
      throw new Error("Environment delivery records require a registered scope.");
    }
    return this.#obligations;
  }
}

function scopeKey(scope: DeliveryRunScope): string {
  return JSON.stringify([
    scope.owner.key,
    scope.ready.tenantId ?? null,
    scope.ready.label,
    scope.ready.targetTypeUrl,
    scope.ready.shard.index,
    scope.ready.shard.ofTotal,
  ]);
}
