/** Write-side signal kinds accepted by the first intake-result seam. */
export type SignalKind = "command" | "event";

/** Marker for intake that accepted responsibility for later asynchronous work. */
export type SignalIntakeAcceptedFor = "async-work";

/** Stable machine-readable reason code for immediate signal intake failures. */
export type SignalIntakeFailureCode =
  "RUNTIME_NOT_ACCEPTING" | "MALFORMED_ENVELOPE" | "UNSUPPORTED_SIGNAL_KIND";

/** Sanitized scalar diagnostic metadata for immediate signal intake failures. */
export type SignalIntakeFailureDiagnostics = Readonly<
  Record<string, string | number | boolean | null>
>;

/** Result returned when a write-side signal is accepted for later asynchronous work. */
export interface SignalIntakeAccepted<Kind extends SignalKind = SignalKind> {
  /** Discriminant for accepted intake. */
  readonly status: "accepted";
  /** Whether the accepted signal is a command or event. */
  readonly signalKind: Kind;
  /** Accepted intake only promises future asynchronous work ownership. */
  readonly acceptedFor: SignalIntakeAcceptedFor;
}

/** Structured immediate failure details with sanitized diagnostics only. */
export interface SignalIntakeFailureDetails {
  /** Stable machine-readable intake failure reason. */
  readonly code: SignalIntakeFailureCode;
  /** Copy-safe scalar diagnostics; never a full signal, envelope, or message payload. */
  readonly diagnostics: SignalIntakeFailureDiagnostics;
}

/** Result returned when a write-side signal fails immediately at intake. */
export interface SignalIntakeFailure<Kind extends SignalKind = SignalKind> {
  /** Discriminant for immediate intake failure. */
  readonly status: "failed";
  /** Whether the rejected signal is a command or event. */
  readonly signalKind: Kind;
  /** Stable failure reason and sanitized diagnostics. */
  readonly failure: SignalIntakeFailureDetails;
}

/** Write-side signal intake result value. */
export type SignalIntakeResult<Kind extends SignalKind = SignalKind> =
  SignalIntakeAccepted<Kind> | SignalIntakeFailure<Kind>;

declare const process: {
  readonly getBuiltinModule: (specifier: "node:util") => {
    readonly types: {
      readonly isProxy: (value: object) => boolean;
    };
  };
};

const isProxy = process.getBuiltinModule("node:util").types.isProxy;

const allowedDiagnosticKeys = new Set([
  "attempt",
  "boundedContext",
  "messageType",
  "reason",
  "retryable",
  "runtimeState",
]);

/** Creates an immutable accepted-for-async-work signal intake result.
 *
 * @param signalKind the kind of accepted signal.
 * @returns the accepted intake result.
 */
export function acceptSignalIntake<Kind extends SignalKind>(
  signalKind: Kind,
): SignalIntakeAccepted<Kind> {
  return Object.freeze({
    status: "accepted",
    signalKind,
    acceptedFor: "async-work",
  });
}

/** Creates an immutable immediate signal intake failure result.
 *
 * @param signalKind the kind of rejected signal.
 * @param code the stable intake failure code.
 * @param diagnostics scalar diagnostic details to retain.
 * @returns the failed intake result.
 */
export function failSignalIntake<Kind extends SignalKind>(
  signalKind: Kind,
  code: SignalIntakeFailureCode,
  diagnostics: Readonly<Record<string, unknown>> = {},
): SignalIntakeFailure<Kind> {
  return Object.freeze({
    status: "failed",
    signalKind,
    failure: Object.freeze({
      code,
      diagnostics: SignalIntakeValues.sanitizeDiagnostics(diagnostics),
    }),
  });
}

/** Private signal-intake diagnostic helpers. */
const SignalIntakeValues = Object.freeze({
  sanitizeDiagnostics(
    diagnostics: Readonly<Record<string, unknown>>,
  ): SignalIntakeFailureDiagnostics {
    const sanitized: Record<string, string | number | boolean | null> = {};
    const descriptors = SignalIntakeValues.getOwnDiagnosticDescriptors(diagnostics);

    if (descriptors === undefined) {
      return Object.freeze(sanitized);
    }

    for (const key of allowedDiagnosticKeys) {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
        continue;
      }
      const value: unknown = descriptor.value;
      if (SignalIntakeValues.isDiagnosticScalar(value)) {
        sanitized[key] = value;
      }
    }

    return Object.freeze(sanitized);
  },

  getOwnDiagnosticDescriptors(
    diagnostics: Readonly<Record<string, unknown>>,
  ): PropertyDescriptorMap | undefined {
    if (isProxy(diagnostics)) {
      return undefined;
    }

    try {
      return Object.getOwnPropertyDescriptors(diagnostics);
    } catch {
      return undefined;
    }
  },

  isDiagnosticScalar(value: unknown): value is string | number | boolean | null {
    return (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    );
  },
});
