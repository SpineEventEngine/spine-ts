/**
 * Public facade for the Node delivery-server client.
 */
export {
  DeliveryClient,
  DeliveryOutcomeUnknownError,
  DeliveryPagingError,
  DeliveryProtocolError,
  DeliveryShardObservationError,
  ShardObservationOverflowError,
  MAX_DELIVERY_BATCH_MESSAGES,
  MAX_DELIVERY_RPC_BYTES,
  MAX_INBOX_PAYLOAD_BYTES,
} from "./client/client.js";
export { RemoteInbox, RemoteWorkRegistry } from "./remote/adapters.js";
export { RemoteDelivery, type RemoteDeliveryConfig } from "./remote/remote-delivery.js";

export type {
  DeliveryClientOptions,
  DeliveryFindOneOptions,
  DeliveryMutationOptions,
  DeliveryReadPageOptions,
  DeliveryShardObservationStream,
  DeliveryWorkerId,
  ReleasedShardSession,
  RemoteShardObservation,
  RemoteShardSession,
} from "./client/client.js";
