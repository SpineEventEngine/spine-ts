import type { Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";

import * as errorSchemas from "../generated/spine/base/error_pb.js";
import * as fieldPathSchemas from "../generated/spine/base/field_path_pb.js";
import * as ackSchemas from "../generated/spine/core/ack_pb.js";
import * as actorContextSchemas from "../generated/spine/core/actor_context_pb.js";
import * as commandSchemas from "../generated/spine/core/command_pb.js";
import * as diagnosticsSchemas from "../generated/spine/core/diagnostics_pb.js";
import * as enrichmentSchemas from "../generated/spine/core/enrichment_pb.js";
import * as eventSchemas from "../generated/spine/core/event_pb.js";
import * as responseSchemas from "../generated/spine/core/response_pb.js";
import * as tenantSchemas from "../generated/spine/core/tenant_id_pb.js";
import * as userSchemas from "../generated/spine/core/user_id_pb.js";
import * as versionSchemas from "../generated/spine/core/version_pb.js";
import * as emailSchemas from "../generated/spine/net/email_address_pb.js";
import * as domainSchemas from "../generated/spine/net/internet_domain_pb.js";
import * as optionSchemas from "../generated/spine/options_pb.js";
import * as stringSchemas from "../generated/spine/string/template_string_pb.js";
import * as timeSchemas from "../generated/spine/time/time_pb.js";
import * as timeOptionSchemas from "../generated/spine/time_options_pb.js";
import * as languageSchemas from "../generated/spine/ui/language_pb.js";
import * as validationSchemas from "../generated/spine/validation/validation_error_pb.js";
import * as clientSchemas from "./client/index.js";
import * as deliverySchemas from "./delivery/index.js";
import * as deliveryServerSchemas from "./delivery-server/index.js";
import * as catchUpSchemas from "../generated/spine/server/catchup/catch_up_pb.js";
import * as environmentSchemas from "../generated/spine/server/server_environment_pb.js";
import type { ProtoModule } from "./proto-module.js";

/**
 * Temporary complete Spine schema inventory until Slice B generates this file
 * from the canonical Proto manifest.
 */
const spineSchemas = Object.freeze(
  [
    errorSchemas,
    fieldPathSchemas,
    ackSchemas,
    actorContextSchemas,
    commandSchemas,
    diagnosticsSchemas,
    enrichmentSchemas,
    eventSchemas,
    responseSchemas,
    tenantSchemas,
    userSchemas,
    versionSchemas,
    emailSchemas,
    domainSchemas,
    optionSchemas,
    stringSchemas,
    timeSchemas,
    timeOptionSchemas,
    languageSchemas,
    validationSchemas,
    clientSchemas,
    deliverySchemas,
    deliveryServerSchemas,
    catchUpSchemas,
    environmentSchemas,
  ]
    .flatMap((exports): unknown[] => Object.values(exports) as unknown[])
    .filter(isMessageSchema)
    .sort(compareSchemas),
);

/** All Spine schemas shipped by `@spine-event-engine/proto`. */
export const spineProtoModule: ProtoModule = Object.freeze({
  name: "@spine-event-engine/proto",
  schemas: spineSchemas,
  dependencies: Object.freeze([]),
});

function isMessageSchema(value: unknown): value is GenMessage<Message> {
  return (
    typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "message"
  );
}

function compareSchemas(left: GenMessage<Message>, right: GenMessage<Message>): number {
  if (left.typeName < right.typeName) {
    return -1;
  }

  return left.typeName > right.typeName ? 1 : 0;
}
