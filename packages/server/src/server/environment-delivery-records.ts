/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */
import type {
  DeliveryRunScope,
  DeliveryScopeSettlement,
} from "../delivery/delivery-run-coordinator.js";
import {
  ParkedDeliveryObligations,
  type ParkedDeliveryObligationRecord,
  type ParkedDeliveryObligationSelection,
} from "../delivery/parked-delivery-obligations.js";

/**
 * Stores delivery scopes and parked obligations for one environment generation.
 *
 * @internal
 */
export class EnvironmentDeliveryRecords {
  readonly #registrations = new Map<string, Map<string, DeliveryRunScope>>();
  readonly #scopes = new Map<string, DeliveryRunScope>();
  readonly #generationScopes = new Map<string, DeliveryRunScope>();
  #obligations: ParkedDeliveryObligations | undefined;

  /**
   * Returns the number of distinct configured scopes.
   *
   * @returns The number of scopes retained by this generation.
   */
  get configuredScopeCount(): number {
    return this.#scopes.size;
  }

  /**
   * Registers scopes once while retaining their first configured order.
   *
   * @param token Identifies the owning environment attachment.
   * @param scopes Supplies the scopes to retain.
   */
  register(token: string, scopes: readonly DeliveryRunScope[]): void {
    const registered = this.#registrations.get(token) ?? new Map<string, DeliveryRunScope>();
    const added: string[] = [];
    for (const scope of scopes) {
      const key = EnvironmentScopeValues.key(scope);
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

  /**
   * Records one coordinator settlement against its configured owner.
   *
   * @param settlement Supplies the completed scope outcome.
   */
  observe(settlement: DeliveryScopeSettlement): void {
    const tokens = this.#tokensFor(settlement.scope);
    const obligations = this.#requireObligations();
    const unit = EnvironmentScopeValues.key(settlement.scope);
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

  /**
   * Returns every retained parked-obligation record.
   *
   * @returns Immutable records in deterministic order.
   */
  records(): readonly ParkedDeliveryObligationRecord[] {
    return this.#obligations?.records() ?? Object.freeze([]);
  }

  /**
   * Returns records owned by one attachment.
   *
   * @param token Identifies the attachment.
   * @returns Immutable records retained for the attachment.
   */
  registrationRecords(token: string): readonly ParkedDeliveryObligationRecord[] {
    return Object.freeze(
      this.records().filter(({ owner }) => owner.kind === "registration" && owner.token === token),
    );
  }

  /**
   * Returns configured scopes for an attachment in stable order.
   *
   * @param token Identifies the attachment.
   * @returns Immutable configured scopes.
   */
  configuredScopes(token: string): readonly DeliveryRunScope[] {
    return Object.freeze([...(this.#registrations.get(token)?.values() ?? [])]);
  }

  /**
   * Returns scopes still pending or represented by parked records for each attachment.
   *
   * @param pending Supplies scopes still active in the coordinator.
   * @returns A stable attachment-to-scope snapshot.
   */
  retainedScopeSnapshot(
    pending: readonly DeliveryRunScope[],
  ): ReadonlyMap<string, readonly DeliveryRunScope[]> {
    const retained = new Set(pending.map(EnvironmentScopeValues.key));
    for (const record of this.records()) {
      for (const unit of record.units) {
        retained.add(unit);
      }
    }
    const snapshot = new Map<string, readonly DeliveryRunScope[]>();
    for (const [token, configured] of this.#registrations) {
      snapshot.set(
        token,
        Object.freeze(
          [...configured.values()].filter((scope) =>
            retained.has(EnvironmentScopeValues.key(scope)),
          ),
        ),
      );
    }
    return snapshot;
  }

  /**
   * Records and removes one attachment's ownership atomically.
   *
   * @param token Identifies the attachment to detach.
   * @returns Reportable failures released by the detach.
   */
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

  /**
   * Removes failed-start ownership while retaining reported generation evidence.
   *
   * @param token Identifies the failed attachment.
   * @returns Reportable failures released by rollback.
   */
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

  /**
   * Records and consumes every generation record atomically.
   *
   * @returns Reportable failures released by retirement.
   */
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
    const key = EnvironmentScopeValues.key(scope);
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

/**
 * @internal Groups canonical delivery-scope identity encoding for one environment generation.
 */
const EnvironmentScopeValues = Object.freeze({
  key(scope: DeliveryRunScope): string {
    return JSON.stringify([
      scope.owner.key,
      scope.ready.tenantId ?? null,
      scope.ready.label,
      scope.ready.targetTypeUrl,
      scope.ready.shard.index,
      scope.ready.shard.ofTotal,
    ]);
  },
});
