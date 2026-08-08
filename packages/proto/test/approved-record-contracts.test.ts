import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getOption, type DescMessage } from "@bufbuild/protobuf";
import { FeatureSet_FieldPresence } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";
import {
  file_spine_auth_authenticated_subscription,
  GatewayAuthenticatedSubscriptionSchema,
} from "../generated/spine/auth/authenticated_subscription_pb.js";
import {
  file_spine_client_subscription_record,
  SubscriptionRecordSchema,
  SubscriptionStatusSchema,
} from "../generated/spine/client/subscription_record_pb.js";
import {
  ApplicationNodeEndpointSchema,
  ApplicationNodeLeaseSchema,
  file_spine_deployment_node_discovery,
  NodeRegistrationIdSchema,
} from "../generated/spine/deployment/node_discovery_pb.js";
import { required, type_url_prefix, validate } from "../generated/spine/options_pb.js";
import * as authFacet from "@spine-event-engine/proto/auth";
import type { GatewayAuthenticatedSubscription } from "@spine-event-engine/proto/auth";
import * as clientFacet from "@spine-event-engine/proto/client";
import type { SubscriptionRecord } from "@spine-event-engine/proto/client";
import * as deploymentFacet from "@spine-event-engine/proto/deployment";
import type {
  ApplicationNodeEndpoint,
  ApplicationNodeLease,
  NodeRegistrationId,
} from "@spine-event-engine/proto/deployment";

const contracts = Object.freeze({
  auth: "packages/proto/proto/spine/auth/authenticated_subscription.proto",
  client: "packages/proto/proto/spine/client/subscription_record.proto",
  deployment: "packages/proto/proto/spine/deployment/node_discovery.proto",
});

describe("approved framework record sources", () => {
  it("places every record in its approved package and file", () => {
    for (const path of Object.values(contracts)) {
      expect(existsSync(resolve(path)), path).toBe(true);
    }
  });

  it("declares the approved record and identifier names", () => {
    const deployment = readFileSync(resolve(contracts.deployment), "utf8");
    const client = readFileSync(resolve(contracts.client), "utf8");
    const auth = readFileSync(resolve(contracts.auth), "utf8");

    expect(deployment).toContain("package spine.deployment;");
    expect(deployment).toContain("message NodeRegistrationId");
    expect(deployment).toContain("message ApplicationNodeLease");
    expect(client).toContain("package spine.client;");
    expect(client).toContain("message SubscriptionRecord");
    expect(client).toContain("enum SubscriptionStatus");
    expect(auth).toContain("package spine.auth;");
    expect(auth).toContain("message GatewayAuthenticatedSubscription");
  });

  it("pins literal field numbers and referenced types", () => {
    expect(messageShape(NodeRegistrationIdSchema)).toEqual({
      file: "spine/deployment/node_discovery.proto",
      typeName: "spine.deployment.NodeRegistrationId",
      reservedNames: [],
      reservedRanges: [],
      oneofs: [],
      fields: [
        {
          name: "value",
          number: 1,
          type: "scalar:9",
          presence: 2,
          required: true,
          validate: false,
        },
      ],
    });
    expect(messageShape(ApplicationNodeEndpointSchema).fields).toEqual([
      { name: "origin", number: 1, type: "scalar:9", presence: 2, required: true, validate: false },
      {
        name: "tls_server_name",
        number: 2,
        type: "scalar:9",
        presence: 2,
        required: false,
        validate: false,
      },
    ]);
    expect(messageShape(ApplicationNodeLeaseSchema).fields).toEqual([
      {
        name: "node_id",
        number: 1,
        type: "message:spine.server.NodeId",
        presence: 1,
        required: true,
        validate: true,
      },
      {
        name: "endpoint",
        number: 2,
        type: "message:spine.deployment.ApplicationNodeEndpoint",
        presence: 1,
        required: true,
        validate: true,
      },
      {
        name: "when_expires",
        number: 3,
        type: "message:google.protobuf.Timestamp",
        presence: 1,
        required: true,
        validate: false,
      },
      {
        name: "registration_id",
        number: 4,
        type: "message:spine.deployment.NodeRegistrationId",
        presence: 1,
        required: true,
        validate: true,
      },
    ]);
    expect(messageShape(SubscriptionRecordSchema).fields).toEqual([
      {
        name: "id",
        number: 1,
        type: "message:spine.client.SubscriptionId",
        presence: 1,
        required: true,
        validate: true,
      },
      {
        name: "subscription",
        number: 2,
        type: "message:spine.client.Subscription",
        presence: 1,
        required: true,
        validate: true,
      },
      {
        name: "status",
        number: 3,
        type: "enum:spine.client.SubscriptionStatus",
        presence: 2,
        required: true,
        validate: false,
      },
      {
        name: "when_created",
        number: 4,
        type: "message:google.protobuf.Timestamp",
        presence: 1,
        required: true,
        validate: false,
      },
      {
        name: "when_activation_expires",
        number: 5,
        type: "message:google.protobuf.Timestamp",
        presence: 1,
        required: false,
        validate: false,
      },
    ]);
    expect(messageShape(GatewayAuthenticatedSubscriptionSchema).fields).toEqual([
      {
        name: "id",
        number: 1,
        type: "message:spine.client.SubscriptionId",
        presence: 1,
        required: true,
        validate: true,
      },
      {
        name: "subscription",
        number: 2,
        type: "message:spine.client.Subscription",
        presence: 1,
        required: true,
        validate: true,
      },
      {
        name: "when_expires",
        number: 3,
        type: "message:google.protobuf.Timestamp",
        presence: 1,
        required: true,
        validate: false,
      },
    ]);
    for (const schema of [
      ApplicationNodeEndpointSchema,
      ApplicationNodeLeaseSchema,
      SubscriptionRecordSchema,
      GatewayAuthenticatedSubscriptionSchema,
    ]) {
      expect(messageShape(schema)).toMatchObject({
        reservedNames: [],
        reservedRanges: [],
        oneofs: [],
      });
    }
  });

  it("pins status values, file options, and validation options", () => {
    expect(SubscriptionStatusSchema.values.map((value) => [value.name, value.number])).toEqual([
      ["SS_UNSPECIFIED", 0],
      ["PENDING", 1],
      ["ACTIVE", 2],
    ]);
    expect(SubscriptionStatusSchema.proto.reservedName).toEqual([]);
    expect(SubscriptionStatusSchema.proto.reservedRange).toEqual([]);
    expect([
      [ApplicationNodeEndpointSchema.file.proto.package, ApplicationNodeEndpointSchema.typeName],
      [ApplicationNodeLeaseSchema.file.proto.package, ApplicationNodeLeaseSchema.typeName],
      [SubscriptionRecordSchema.file.proto.package, SubscriptionRecordSchema.typeName],
      [
        GatewayAuthenticatedSubscriptionSchema.file.proto.package,
        GatewayAuthenticatedSubscriptionSchema.typeName,
      ],
    ]).toEqual([
      ["spine.deployment", "spine.deployment.ApplicationNodeEndpoint"],
      ["spine.deployment", "spine.deployment.ApplicationNodeLease"],
      ["spine.client", "spine.client.SubscriptionRecord"],
      ["spine.auth", "spine.auth.GatewayAuthenticatedSubscription"],
    ]);
    for (const file of [
      file_spine_auth_authenticated_subscription,
      file_spine_client_subscription_record,
      file_spine_deployment_node_discovery,
    ]) {
      expect(getOption(file, type_url_prefix)).toBe("type.spine.io");
    }
    expect(ApplicationNodeEndpointSchema.fields[1]?.presence).toBe(
      FeatureSet_FieldPresence.IMPLICIT,
    );
    expect(
      [
        ...ApplicationNodeLeaseSchema.fields,
        ...SubscriptionRecordSchema.fields,
        ...GatewayAuthenticatedSubscriptionSchema.fields,
      ].every((field) => field.fieldKind !== "list" && field.fieldKind !== "map"),
    ).toBe(true);
  });

  it("exports every approved schema and type from its named facet", () => {
    expect(clientFacet.SubscriptionRecordSchema.typeName).toBe("spine.client.SubscriptionRecord");
    expect(clientFacet.SubscriptionStatus).toMatchObject({
      SS_UNSPECIFIED: 0,
      PENDING: 1,
      ACTIVE: 2,
    });
    expect(authFacet.GatewayAuthenticatedSubscriptionSchema.typeName).toBe(
      "spine.auth.GatewayAuthenticatedSubscription",
    );
    expect(deploymentFacet.NodeRegistrationIdSchema.typeName).toBe(
      "spine.deployment.NodeRegistrationId",
    );
    expect(deploymentFacet.ApplicationNodeEndpointSchema.typeName).toBe(
      "spine.deployment.ApplicationNodeEndpoint",
    );
    expect(deploymentFacet.ApplicationNodeLeaseSchema.typeName).toBe(
      "spine.deployment.ApplicationNodeLease",
    );
    const typesCompile: readonly [
      SubscriptionRecord?,
      GatewayAuthenticatedSubscription?,
      NodeRegistrationId?,
      ApplicationNodeEndpoint?,
      ApplicationNodeLease?,
    ] = [];
    expect(typesCompile).toEqual([]);
  });

  it("keeps obsolete names out of new contracts and public facets", () => {
    const newSources = Object.values(contracts)
      .map((path) => readFileSync(resolve(path), "utf8"))
      .join("\n");
    for (const obsolete of [
      "StandSubscriptionRecord",
      "SubscriptionPhase",
      "revision",
      "generation",
      "encoding_version",
      "expires_at_millis",
    ]) {
      expect(newSources).not.toContain(obsolete);
      expect(clientFacet).not.toHaveProperty(obsolete);
      expect(authFacet).not.toHaveProperty(obsolete);
      expect(deploymentFacet).not.toHaveProperty(obsolete);
    }
    expect(
      existsSync(resolve("packages/proto/proto/spine/system/server/stand_subscription.proto")),
    ).toBe(false);
    expect(
      existsSync(
        resolve("packages/proto/proto/spine/system/deployment/application_node_lease.proto"),
      ),
    ).toBe(false);
  });
});

function messageShape(schema: DescMessage) {
  return {
    file: `${schema.file.name}.proto`,
    typeName: schema.typeName,
    reservedNames: schema.proto.reservedName,
    reservedRanges: schema.proto.reservedRange,
    oneofs: schema.oneofs,
    fields: schema.fields.map((field) => {
      let type: string;
      if (field.fieldKind === "message") type = `message:${field.message.typeName}`;
      else if (field.fieldKind === "enum") type = `enum:${field.enum.typeName}`;
      else if (field.fieldKind === "scalar") type = `scalar:${String(field.scalar)}`;
      else type = field.fieldKind;
      return {
        name: field.name,
        number: field.number,
        type,
        presence: field.presence,
        required: getOption(field, required),
        validate: getOption(field, validate),
      };
    }),
  };
}
