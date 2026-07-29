/**
 * Opaque token selecting one ephemeral in-memory storage backend.
 *
 * A factory constructed without a token owns a fresh backend. Pass this same
 * token to independently constructed factories only when they must share rows.
 */
export class InMemoryStorageBackend {
  /** Identifies this opaque backend in diagnostics. */
  readonly [Symbol.toStringTag] = "InMemoryStorageBackend";

  /** Binds one canonical scope to one compatible backend-owned value.
   * @param backend - Selects the shared ephemeral backend.
   * @param scope - Identifies the canonical storage scope.
   * @param fingerprint - Identifies the compatible record layout.
   * @param create - Creates the value when the scope is first bound.
   * @returns The existing or newly created backend-owned value.
   */
  static bind<T>(
    backend: InMemoryStorageBackend,
    scope: string,
    fingerprint: string,
    create: () => T,
  ): T {
    return MemoryBackendScopes.bind(backend, scope, fingerprint, create);
  }
}

interface BoundScope {
  readonly fingerprint: string;
  readonly value: unknown;
}

const scopesByBackend = new WeakMap<InMemoryStorageBackend, Map<string, BoundScope>>();

/** Owns backend-scoped values and compatibility checks. */
const MemoryBackendScopes = {
  /** Binds one canonical scope to one compatible backend-owned value. */
  bind<T>(backend: InMemoryStorageBackend, scope: string, fingerprint: string, create: () => T): T {
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
  },
};
