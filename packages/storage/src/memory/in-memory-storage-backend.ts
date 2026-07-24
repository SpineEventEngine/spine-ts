/**
 * Opaque token selecting one ephemeral in-memory storage backend.
 *
 * A factory constructed without a token owns a fresh backend. Pass this same
 * token to independently constructed factories only when they must share rows.
 */
export class InMemoryStorageBackend {
  readonly [Symbol.toStringTag] = "InMemoryStorageBackend";
}

interface BoundScope {
  readonly fingerprint: string;
  readonly value: unknown;
}

const scopesByBackend = new WeakMap<InMemoryStorageBackend, Map<string, BoundScope>>();

/** Bind one canonical scope to one compatible backend-owned value. */
export function bindMemoryBackendScope<T>(
  backend: InMemoryStorageBackend,
  scope: string,
  fingerprint: string,
  create: () => T,
): T {
  let scopes = scopesByBackend.get(backend);
  if (scopes === undefined) {
    scopes = new Map<string, BoundScope>();
    scopesByBackend.set(backend, scopes);
  }

  const existing = scopes.get(scope);
  if (existing === undefined) {
    const value = create();
    scopes.set(scope, { fingerprint, value });
    return value;
  }
  if (existing.fingerprint !== fingerprint) {
    throw new Error(`Storage scope "${scope}" has an incompatible record specification.`);
  }
  return existing.value as T;
}
