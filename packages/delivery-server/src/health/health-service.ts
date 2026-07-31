import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";
import {
  Health,
  HealthCheckResponse_ServingStatus as ServingStatus,
} from "@spine-event-engine/proto/delivery-server";

const known = new Set([
  "",
  "grpc.health.v1.Health",
  "spine.delivery.InboxService",
  "spine.delivery.ShardService",
  "spine.delivery.AdminService",
]);

/**
 * Provides Delivery health handler implementations.
 */
export const HealthHandlers: Readonly<{
  create(serving: () => boolean): ServiceImpl<typeof Health>;
}> = Object.freeze({
  // prettier-ignore

  /**
   * Creates health handlers.
   *
   * @param serving Reports whether the server accepts traffic.
   * @returns Provides Connect health handlers.
   */
  create(serving: () => boolean): ServiceImpl<typeof Health> {
    return {
      check: (request) => ({
        status:
          serving() && known.has(request.service)
            ? ServingStatus.SERVING
            : ServingStatus.NOT_SERVING,
      }),
      watch: () => {
        throw new ConnectError("Delivery health watch is not implemented.", Code.Unimplemented);
      },
    };
  },
});
