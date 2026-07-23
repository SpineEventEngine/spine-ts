import type { ServiceImpl } from "@connectrpc/connect";
import { AdminService, InboxService, ShardService } from "@spine-ts/proto/delivery-server";

import { createAdminPublisher } from "../admin/admin-service.js";
import { InMemoryDeliveryState } from "../core/in-memory-delivery-state.js";
import { createInboxService } from "../core/inbox-service.js";
import { MutationAdmission } from "../core/mutation-admission.js";
import { createShardService } from "../core/shard-service.js";

export interface DeliveryAssembly {
  readonly inbox: ServiceImpl<typeof InboxService>;
  readonly shards: ServiceImpl<typeof ShardService>;
  readonly admin: ServiceImpl<typeof AdminService>;
  closeAdmission(): void;
  closeAdmin(): void;
}

export function createDeliveryAssembly(processingTimeoutMs = 0): DeliveryAssembly {
  const state = new InMemoryDeliveryState();
  const admission = new MutationAdmission();
  const admin = createAdminPublisher(state);
  return Object.freeze({
    inbox: createInboxService(state, admission, (shard, delta) => {
      admin.recordMessageTransition(shard, delta);
    }),
    shards: createShardService(state, admission, Date.now, processingTimeoutMs, (shard) => {
      admin.publish(shard);
    }),
    admin: admin.service,
    closeAdmission: () => {
      admission.close();
    },
    closeAdmin: () => {
      admin.close();
    },
  });
}
