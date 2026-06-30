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

type SignalIntakeDiagnosticInput = Readonly<Record<string, unknown>>;

const payloadDiagnosticKeys = new Set(["payload", "message", "signal", "envelope"]);

/** Create an immutable accepted-for-async-work signal intake result. */
export function acceptSignalIntake<Kind extends SignalKind>(
  signalKind: Kind,
): SignalIntakeAccepted<Kind> {
  return Object.freeze({
    status: "accepted",
    signalKind,
    acceptedFor: "async-work",
  });
}

/** Create an immutable immediate signal intake failure result. */
export function failSignalIntake<Kind extends SignalKind>(
  signalKind: Kind,
  code: SignalIntakeFailureCode,
  diagnostics: SignalIntakeDiagnosticInput = {},
): SignalIntakeFailure<Kind> {
  return Object.freeze({
    status: "failed",
    signalKind,
    failure: Object.freeze({
      code,
      diagnostics: sanitizeDiagnostics(diagnostics),
    }),
  });
}

function sanitizeDiagnostics(
  diagnostics: SignalIntakeDiagnosticInput,
): SignalIntakeFailureDiagnostics {
  const sanitized: Record<string, string | number | boolean | null> = {};

  for (const [key, value] of Object.entries(diagnostics)) {
    if (payloadDiagnosticKeys.has(key)) {
      continue;
    }
    if (isDiagnosticScalar(value)) {
      sanitized[key] = value;
    }
  }

  return Object.freeze(sanitized);
}

function isDiagnosticScalar(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}
