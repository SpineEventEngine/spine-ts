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
