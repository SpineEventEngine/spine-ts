/** Raised when durable delivery records cannot be decoded safely. */
export class DeliveryStorageCorruptionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`Delivery storage corruption: ${message}`, options);
    this.name = "DeliveryStorageCorruptionError";
  }
}
