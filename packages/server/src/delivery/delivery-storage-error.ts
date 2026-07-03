/** Raised by public delivery APIs when durable delivery records are corrupt or invalid. */
export class DeliveryStorageCorruptionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`Delivery storage corruption: ${message}`, options);
    this.name = "DeliveryStorageCorruptionError";
  }
}
