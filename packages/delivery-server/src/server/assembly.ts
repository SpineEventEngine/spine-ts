import type { ServiceImpl } from "@connectrpc/connect";
import { AdminService, InboxService, ShardService } from "@spine-ts/proto/delivery-server";

import { createAdminPublisher } from "../admin/admin-service.js";
import { InMemoryDeliveryState } from "../core/in-memory-delivery-state.js";
import { createInboxService } from "../core/inbox-service.js";
import { MutationAdmission } from "../core/mutation-admission.js";
import { createShardService } from "../core/shard-service.js";
import { DEFAULT_DELIVERY_STATE_LIMITS } from "../core/limits.js";
import type { DeliveryConfiguration } from "./config.js";

export interface DeliveryAssembly {
  readonly inbox: ServiceImpl<typeof InboxService>;
  readonly shards: ServiceImpl<typeof ShardService>;
  readonly admin: ServiceImpl<typeof AdminService>;
  closeAdmission(): void;
  closeAdmin(): void;
}

export function createDeliveryAssembly(
  configuration: Pick<
    DeliveryConfiguration,
    "processingTimeoutMs" | "maxRetainedMessages" | "maxRetainedBytes" | "maxTrackedShards"
  > = {
    processingTimeoutMs: 0,
    ...DEFAULT_DELIVERY_STATE_LIMITS,
  },
): DeliveryAssembly {
  const state = new InMemoryDeliveryState(configuration);
  const admission = new MutationAdmission();
  const admin = createAdminPublisher(state);
  return Object.freeze({
    inbox: createInboxService(state, admission, (shard, delta) => {
      admin.recordMessageTransition(shard, delta);
    }),
    shards: createShardService(
      state,
      admission,
      Date.now,
      configuration.processingTimeoutMs,
      (shard) => {
        admin.publish(shard);
      },
    ),
    admin: admin.service,
    closeAdmission: () => {
      admission.close();
    },
    closeAdmin: () => {
      admin.close();
    },
  });
}
