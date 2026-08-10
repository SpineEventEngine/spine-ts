import { describe, expect, it, vi } from "vitest";

import { emitDeliveryServerError } from "../../delivery-server/src/server/delivery-server-log.js";
import { emitGceRegistrarRenewalWarning } from "../../deployment-gce/src/registrar/gce-registrar-log.js";
import { emitGkeDiscoveryWarning } from "../../deployment-gke/src/discovery/gke-log.js";
import { emitDeploymentWarning } from "../src/deployment-log.js";

const secrets = "token password cookie authorization signing session CSRF OIDC";
const emitters = [
  [
    "deployment",
    (logger: unknown) => {
      emitDeploymentWarning(
        logger as never,
        "deployment.discovery.refresh_failed",
        "deployment.discovery.refresh",
      );
    },
  ],
  [
    "gke",
    (logger: unknown) => {
      emitGkeDiscoveryWarning(logger as never);
    },
  ],
  [
    "gce",
    (logger: unknown) => {
      emitGceRegistrarRenewalWarning(logger as never);
    },
  ],
  [
    "delivery-server",
    (logger: unknown) => {
      emitDeliveryServerError(logger as never);
    },
  ],
] as const;

describe("private log emitter containment", () => {
  it.each(emitters)("contains synchronous logger failures for %s", (_name, emit) => {
    expect(() => {
      emit({
        withMetadata: () => {
          throw new Error(secrets);
        },
      });
    }).not.toThrow();
    expect(() => {
      emit({
        withMetadata: () => ({
          warn: () => {
            throw new Error(secrets);
          },
          error: () => {
            throw new Error(secrets);
          },
        }),
      });
    }).not.toThrow();
  });

  it.each(emitters)(
    "contains rejecting callable and object thenables for %s",
    async (_name, emit) => {
      const callable = Object.assign(() => undefined, {
        then: (_resolve: unknown, reject: (reason: Error) => void) => {
          reject(new Error(secrets));
        },
      });
      const object = {
        then: (_resolve: unknown, reject: (reason: Error) => void) => {
          reject(new Error(secrets));
        },
      };
      emit({ withMetadata: () => ({ warn: () => callable, error: () => callable }) });
      emit({ withMetadata: () => ({ warn: () => object, error: () => object }) });
      await Promise.resolve();
    },
  );

  it.each(emitters)("never serializes secret-shaped failure data for %s", (_name, emit) => {
    const warn = vi.fn();
    const error = vi.fn();
    const logger = { withMetadata: vi.fn(() => ({ warn, error })) };
    emit(logger);
    expect(JSON.stringify(logger.withMetadata.mock.calls)).not.toContain(secrets);
    expect(JSON.stringify([warn.mock.calls, error.mock.calls])).not.toContain(secrets);
  });

  it.each(emitters)("accepts an absent application logger for %s", (_name, emit) => {
    expect(() => {
      emit(undefined);
    }).not.toThrow();
  });
});
