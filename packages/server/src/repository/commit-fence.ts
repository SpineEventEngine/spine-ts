import { AsyncLocalStorage } from "node:async_hooks";

interface Commit {
  readonly status: string;
}
type Guard = () => Promise<void>;

const fences = new AsyncLocalStorage<Guard>();

/**
 * Executes a delivery callback with a commit-time ownership guard.
 *
 * @param guard Verifies that the delivery worker still owns its shard.
 * @param callback Performs the delivery work within the guarded scope.
 * @returns The value produced by the delivery callback.
 */
export async function withDeliveryCommitFence<T>(
  guard: Guard,
  callback: () => Promise<T>,
): Promise<T> {
  return fences.run(guard, callback);
}

/**
 * Verifies delivery ownership immediately before committing an Entity.
 *
 * @param entity Supplies the Entity whose transaction is committed.
 * @param commit Commits the active Entity transaction synchronously.
 * @returns The result produced by the Entity transaction commit.
 */
export async function commitFenced<T extends Commit>(
  entity: object,
  commit: (entity: object) => T,
): Promise<T> {
  await fences.getStore()?.();
  return commit(entity);
}
