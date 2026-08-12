/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { create } from "@bufbuild/protobuf";
import {
  EmailAddressSchema,
  InternetDomainSchema,
  TenantIdSchema,
  type TenantId,
} from "@spine-event-engine/proto";

export function tenant(value: string): TenantId {
  return create(TenantIdSchema, { kind: { case: "value", value } });
}

export function domainTenant(value: string): TenantId {
  return create(TenantIdSchema, {
    kind: { case: "domain", value: create(InternetDomainSchema, { value }) },
  });
}

export function emailTenant(value: string): TenantId {
  return create(TenantIdSchema, {
    kind: { case: "email", value: create(EmailAddressSchema, { value }) },
  });
}
