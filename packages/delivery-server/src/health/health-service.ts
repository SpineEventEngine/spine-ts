import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";
import {
  Health,
  HealthCheckResponse_ServingStatus,
} from "@spine-event-engine/proto/delivery-server";

const known = new Set([
  "",
  "grpc.health.v1.Health",
  "spine.delivery.InboxService",
  "spine.delivery.ShardService",
  "spine.delivery.AdminService",
]);

export function createHealthService(serving: () => boolean): ServiceImpl<typeof Health> {
  return {
    check: (request) => ({
      status:
        serving() && known.has(request.service)
          ? HealthCheckResponse_ServingStatus.SERVING
          : HealthCheckResponse_ServingStatus.NOT_SERVING,
    }),
    watch: () => {
      throw new ConnectError("Delivery health watch is not implemented.", Code.Unimplemented);
    },
  };
}
