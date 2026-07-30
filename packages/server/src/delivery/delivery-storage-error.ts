/** Raised by public delivery APIs when durable delivery records are corrupt or invalid. */
export class DeliveryStorageCorruptionError extends Error {
  /**
   * Creates an error describing invalid durable delivery data.
   *
   * @param message - Describes the corrupted record or value.
   * @param options - Optionally preserves the originating failure.
   */
  constructor(message: string, options?: ErrorOptions) {
    super(`Delivery storage corruption: ${message}`, options);
    this.name = "DeliveryStorageCorruptionError";
  }
}
