import type { Storage } from "./storage.js";

/** Small base for closeable storage implementations. */
export abstract class StorageObject implements Storage {
  #open = true;

  /** Whether this storage object still accepts operations. */
  isOpen(): boolean {
    return this.#open;
  }

  /** Close this storage object. Future operations fail. */
  close(): void {
    this.#open = false;
  }

  protected requireOpen(owner: string): void {
    if (!this.#open) {
      throw new Error(`${owner} is closed.`);
    }
  }
}
