/**
 * Opaque token selecting one ephemeral in-memory storage backend.
 *
 * A factory constructed without a token owns a fresh backend. Pass this same
 * token to independently constructed factories only when they must share rows.
 */
export class InMemoryStorageBackend {
  // prettier-ignore

  /**
   * Identifies this opaque backend in diagnostics.
   */
  readonly [Symbol.toStringTag] = "InMemoryStorageBackend";

  /**
   * Binds one canonical scope to one backend-owned value.
   * @param backend Selects the shared ephemeral backend.
   * @param namespace Separates Entity and generic record backend values.
   * @param scope Identifies the canonical storage scope.
   * @param create Creates the value when the scope is first bound.
   * @returns The existing or newly created backend-owned value.
   */
  static bind<T>(
    backend: InMemoryStorageBackend,
    namespace: "entity" | "record",
    scope: string,
    create: () => T,
  ): T {
    return MemoryBackendScopes.bind(backend, namespace, scope, create);
  }
}

const scopesByBackend = new WeakMap<InMemoryStorageBackend, Map<string, unknown>>();

/**
 * Binds canonical scopes to values for each in-memory backend.
 */
const MemoryBackendScopes = {
  // prettier-ignore

  /**
   * Binds one canonical scope to one backend-owned value.
   */
  bind<T>(
    backend: InMemoryStorageBackend,
    namespace: "entity" | "record",
    scope: string,
    create: () => T,
  ): T {
    let scopes: Map<string, unknown> | undefined = scopesByBackend.get(backend);
    if (scopes === undefined) {
      scopes = new Map<string, unknown>();
      scopesByBackend.set(backend, scopes);
    }

    const key = `${namespace}:${scope}`;
    const existing = scopes.get(key);
    if (existing === undefined) {
      const value = create();
      scopes.set(key, value);
      return value;
    }
    return existing as T;
  },
};
