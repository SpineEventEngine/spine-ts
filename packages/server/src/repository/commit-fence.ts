import { AsyncLocalStorage } from "node:async_hooks";

type Commit = { readonly status: string };
type Guard = () => Promise<void>;

const fences = new AsyncLocalStorage<Guard>();

export async function withDeliveryCommitFence<T>(
  guard: Guard,
  callback: () => Promise<T>,
): Promise<T> {
  return fences.run(guard, callback);
}

export async function commitFenced<T extends Commit>(
  entity: object,
  commit: (entity: object) => T,
): Promise<T> {
  await fences.getStore()?.();
  return commit(entity);
}
