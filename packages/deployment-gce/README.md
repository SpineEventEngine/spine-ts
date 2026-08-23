# Deploy a Spine TS application on GCE

`@spine-event-engine/deployment-gce` helps you run one Spine TS application
across several Google Compute Engine (GCE) virtual machines. It includes an
editable Terraform template and small TypeScript entrypoints. The template
keeps application nodes, the Gateway, and the simple delivery server private;
you provide the public TLS, authentication, and traffic-routing edge that fits
your organisation.

This experimental snapshot package is for operators who already own
the application images and their Google Cloud environment. Install its library
API when writing the application or Gateway entrypoints:

```bash
pnpm add @spine-event-engine/deployment-gce@snapshot
```

Copy the packaged Terraform directory into your deployment repository only
when you want its GCE reference topology; installing the library neither
creates cloud resources nor configures your application Gateway, authentication,
sessions, secrets, or storage.

For exact discovery, lease, and lifecycle behavior, read the
[deployment reference](REFERENCE.md).

## Before you begin

You need an existing Google Cloud project, VPC network, regional subnetwork,
and a service account with only the permissions required by your images and
their application configuration. Install [Google Cloud CLI](https://cloud.google.com/sdk/docs/install)
and Terraform 1.6 or newer. Authenticate Terraform through Application Default
Credentials:

```bash
gcloud auth application-default login
```

Build and publish three immutable images: your application, one standalone
Gateway, and the in-memory simple delivery server. Use image digests such as
`@sha256:...`, not mutable tags. The template deliberately does not publish an
image, choose Datastore, MySQL, or another storage backend, create secrets, or
configure an identity provider.

## First Terraform plan

Copy the packaged template into an operator-owned deployment repository. The
following commands assume its Terraform directory is your current directory;
create a values file and obtain a validated plan before wiring advanced Gateway
or registry behavior:

```bash
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform fmt -check
terraform validate
terraform plan -var-file=terraform.tfvars
```

Replace every placeholder with your existing project, network, service account,
and immutable image digests before `plan`. A plan showing only private Spine
resources is the first success; review it before any `terraform apply`.

## What this deployment creates

The application managed instance group (MIG) is regional and distributes
identical application nodes across your selected zones. A ready node registers
its private listener in a durable application registry. The single
Gateway reads the same registry every 10 seconds and routes commands, queries,
and subscriptions to the live nodes.

```mermaid
flowchart LR
  Edge["Your TLS and authentication edge"] --> Gateway["One private Gateway"]
  Gateway --> Registry["Durable application node registry"]
  Registry --> Gateway
  Gateway --> AppA["Application node A"]
  Gateway --> AppB["Application node B"]
  AppA --> Delivery["One in-memory simple delivery server"]
  AppB --> Delivery
```

The template gives the Gateway and delivery server separate one-instance MIGs
and stable private addresses behind internal passthrough load balancers. This
is easy to inspect and lets an operator move them to separate failure or
resource boundaries. A smaller deployment may colocate the two processes, but
the simple delivery server remains in-memory: it is neither durable nor highly
available.

This is a fixed, single-Gateway topology. Multiple Gateways and Cloud Run are
outside the supported offering.

Every listener receives only private VPC traffic and health checks. Terraform
does not create an external IP, public load balancer, TLS certificate,
authentication provider, or Internet firewall rule.

## Configure the template

Copy the values file and replace every placeholder. Keep it outside source
control because it identifies your network and deployment, even though it
contains no secret values.

```bash
cp terraform.tfvars.example terraform.tfvars
```

Set the project, region, two or more application zones, VPC/subnetwork,
least-privilege service-account email, and the three image digests. Set
`registry_namespace` and `registry_storage_reference` identically for
application and Gateway images. Each entrypoint passes that reference to its
application-supplied `registryStorage.storageFactoryFor(reference)` resolver. The
resolver chooses the shared durable `StorageFactory`; Terraform only transports
the reference and never chooses a storage engine.

`application_secret_reference` and `gateway_secret_reference` are identifiers
your images resolve through the selected configuration mechanism. They are passed
as environment values only. Terraform neither reads secret values nor writes
them into state.

Grant the VM service account `roles/artifactregistry.reader` on each Artifact
Registry repository that stores these images. The template uses the broad
`cloud-platform` OAuth scope so Google Cloud IAM can evaluate that role; the IAM
role, not the scope alone, authorizes image pulls.

Every image must use an Artifact Registry host such as
`us-docker.pkg.dev`. Each COS startup script extracts that exact host from its
configured immutable image name, creates a writable Docker configuration under
`/var/lib/spine-docker`, and runs `docker-credential-gcr configure-docker` for
that host before it pulls the image. The helper uses the attached VM service
account; no registry credential or key is placed in Terraform, metadata, or the
Docker command.

## Connect your application entrypoints

The application image starts a managed application node. Its private VM port is
the Node Coordinator port; managed children are complete application replicas
on loopback and are never discoverable directly. The deployer must set both
`application_process_count` and `delivery_shard_count` in Terraform. They are
independent: the first selects Node processes, while the second is passed to
your context assembly for its explicit Delivery strategy.

Use the complete, tested
[`GceApplicationEntrypoint`](examples/application.ts) instead of copying only
its happy path. It starts the managed application, publishes the Coordinator
only after it is ready, withdraws that lease before shutdown, and preserves
startup or cleanup failures. Supply your complete child assembly through
`createServer`, and pass the same environment object when testing custom
deployment values. The framework-owned `SPINE_MANAGED_SERVER_CHILD` marker is
read from that environment so child executions do not publish separate leases.

The Gateway resolves the same storage reference and namespace through its
environment. It manages a GCE discovery lifecycle that refreshes the complete
live-node registry snapshot every 10 seconds, stops that schedule when the
browser server stops, and then closes its registry. Supply browser collaborators
in `browserOptions`. Choose one admission mode there: authenticated mode
supplies `sessions` and may supply named durable subscription bindings; public
mode supplies `publicAccess: true`, and the framework owns process-local
bindings. Public mode cannot supply bindings.

<!-- docs-snippet-path: packages/deployment-gce/examples/gateway.ts -->

```ts
import { LeasedNodeRegistry } from "@spine-event-engine/deployment";
import { GceNodeDiscovery } from "@spine-event-engine/deployment-gce";
import { BrowserServer, type BrowserServerOptions } from "@spine-event-engine/server/browser";

type GatewayBrowserOptions = BrowserServerOptions extends infer Options
  ? Options extends BrowserServerOptions
    ? Omit<Options, "host" | "port" | "discovery">
    : never
  : never;

import {
  GceDeploymentSettings,
  type DeploymentEnvironment,
  type RegistryStorageResolver,
} from "./deployment-settings.js";

export interface GatewayOptions {
  readonly browser: GatewayBrowserOptions;
  readonly registryStorage: RegistryStorageResolver;
}

export const GceGatewayEntrypoint = Object.freeze({
  async run(
    options: GatewayOptions,
    environment: DeploymentEnvironment = process.env,
  ): Promise<void> {
    const registry = new LeasedNodeRegistry({
      factory: options.registryStorage.storageFactoryFor(
        GceDeploymentSettings.registryStorageReference(environment),
      ),
      namespace: GceDeploymentSettings.registryNamespace(environment),
    });
    const discovery = new GceNodeDiscovery({ registry });
    await BrowserServer.run({
      host: "0.0.0.0",
      port: GceDeploymentSettings.port(environment, "PORT"),
      ...options.browser,
      discovery,
    });
  },
});
```

The complete, packaged examples are
[`examples/application.ts`](examples/application.ts) and
[`examples/gateway.ts`](examples/gateway.ts). They deliberately keep business
contexts, storage configuration, identity, and (when using authenticated mode)
durable subscription bindings in your application code. The GCE entrypoint's returned handle withdraws its
Coordinator lease before stopping child replicas; abrupt VM loss remains covered
by the existing lease expiry. The managed child marker is framework-owned
process state: it makes the shared module assemble a child replica without
creating a competing VM lease.

## Deploy

Initialize the provider, then make the first safe success a formatting,
validation, and plan review. Apply only the reviewed plan.

```bash
terraform init
terraform fmt -check
terraform validate
terraform plan -out=tfplan
terraform apply tfplan
```

The plan should contain one application MIG, one Gateway MIG, one delivery MIG,
and private load balancers only. The [reference](REFERENCE.md) records scaling,
replacement, rollback, registry, and image-pull limits before you change those
operations.

The first VM can take several minutes to start. Autohealing waits for the
configured startup delay (120 seconds by default) before treating a failed
application listener as unhealthy.

The template uses Container-Optimized OS and runs each image with a startup
script. It configures the exact Artifact Registry host with
`docker-credential-gcr`, then uses `docker run --rm --network host`. If a
container exits, Docker removes it and the listener health check fails; the MIG
can then repair that VM after the startup delay. Use
`journalctl -u google-startup-scripts.service` or the VM serial-console log to
diagnose credential-helper, startup-script, and container failures.

## Verify the deployment

Check that GCE created the three groups and that all intended instances become
healthy:

```bash
gcloud compute instance-groups managed list --regions=REGION
gcloud compute instance-groups managed list-instances spine-application --region=REGION
terraform output gateway_private_address
```

From a trusted VPC client or your operator-managed edge, reach the returned
Gateway address. Post a command, query its Projection, and activate a durable
subscription. The Gateway may need one 10-second refresh interval after a
fresh application node becomes ready.

Each VM obtains a unique registration identity for its ready Coordinator,
renews its lease every 20 seconds, and leases it for 60 seconds. A graceful
entrypoint close withdraws that lease before it stops its managed children. A
crash may leave a row behind temporarily, but it is ignored after expiry;
healthy registrars perform finite cleanup.

## Scale application nodes

With the default `autoscaling_enabled = false`, Terraform controls manual capacity:

```bash
terraform apply -var='application_replicas=4'
terraform apply -var='application_replicas=0'
terraform apply -var='application_replicas=2'
```

At zero nodes, the registry becomes empty after at most the 60-second lease
expiry. The Gateway remains alive but reports backend unavailability until a
node returns; it keeps refreshing every 10 seconds. If an autoscaler is already
enabled, first remove it in the same transition:

```bash
terraform apply -var='autoscaling_enabled=false' -var='application_replicas=0'
```

To let Compute Engine scale the same application version, set
`autoscaling_enabled = true`. For `autoscaling_signal = "cpu"`,
`autoscaling_target` is the CPU utilization target. For
`autoscaling_signal = "monitoring"`, choose the metric name, a filter that
selects only the intended resource and series, a metric target kind, and the
declared `per_instance` or `whole_group` scope. A per-instance filter must set
`resource.type = "gce_instance"`; a whole-group filter must select another
resource type, such as `global`. Terraform validates that relationship, then
omits the MIG size and GCE is the sole capacity owner.

CPU and per-instance metrics require a running VM, so they cannot scale from
zero. For scale-from-zero, use a `whole_group` Cloud Monitoring metric that is
produced while no application VM exists, and set
`autoscaling_min_replicas = 0`; otherwise use an operator action or schedule.
Internal passthrough load-balancer utilization is not a suitable autoscaling
signal for this topology.

## Replace an application version

For a compatible change, publish a new immutable application digest, set it in
`terraform.tfvars`, and apply. The regional MIG performs a proactive rolling
replacement with one permitted surge instance for each selected application
zone and no planned unavailable instance. Old and new nodes can overlap, so
they must understand the same stored data and messages during the rollout.

For an incompatible business-logic or data change, first disable any enabled
autoscaler and set application capacity to zero. Wait until the old nodes exit,
apply the new image while capacity remains zero, then restore manual capacity
or explicitly enable the new autoscaler. This framework does not negotiate
compatibility. Pending Inbox work may execute under the new version, so make
the change safe for those messages before starting it.

```bash
terraform apply -var='autoscaling_enabled=false' -var='application_replicas=0'
test -z "$(gcloud compute instance-groups managed list-instances spine-application --region=REGION --format='value(instance)')"
# Set the new application_image digest in terraform.tfvars.
terraform apply -var='autoscaling_enabled=false' -var='application_replicas=0'
terraform apply -var='autoscaling_enabled=false' -var='application_replicas=2'
```

The Gateway normally stays in place during an application replacement. A
Gateway interruption disconnects browser clients. In authenticated mode, durable
subscription definitions survive only when the supplied named bindings use the
same persistent application storage. Public-mode definitions are process-local
and end with the Gateway process. Clients reconnect and issue an authoritative query.
Replacing `gateway_image` performs its explicit one-unavailable, zero-surge
singleton update and therefore causes that interruption. Replacing
`delivery_image` performs the same singleton update; the supplied in-memory
delivery server loses its state whenever its process stops.

## Roll back

To roll back a compatible application image, restore the prior immutable digest
and run `terraform apply`. GCE creates the previous instance template and
performs the same rolling update. For an incompatible rollback, disable an
enabled autoscaler, reduce the application group to zero, wait for shutdown,
apply the prior image, then restore manual capacity or deliberately re-enable
autoscaling. Confirm the group is empty before applying the prior image:

```bash
terraform apply -var='autoscaling_enabled=false' -var='application_replicas=0'
test -z "$(gcloud compute instance-groups managed list-instances spine-application --region=REGION --format='value(instance)')"
# Restore the prior application_image digest in terraform.tfvars.
terraform apply -var='autoscaling_enabled=false' -var='application_replicas=0'
terraform apply -var='autoscaling_enabled=false' -var='application_replicas=2'
```

## Troubleshooting

| Symptom                              | Check                                                                                                                                                             |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gateway has no backend               | Confirm the application group has healthy instances, registry references and namespace match, then allow a 10-second refresh.                                     |
| A node remains listed after a crash  | Wait up to 60 seconds for lease expiry; cleanup is finite and does not make expired nodes routable.                                                               |
| An application VM keeps restarting   | Check the image starts its listener on `HOST=0.0.0.0` and `PORT`, and increase the startup delay only when its real startup needs it.                             |
| A client cannot reach the Gateway    | Reach the private output from the VPC or configure a separate TLS/authentication edge; this module creates no public path.                                        |
| Autoscaling does not wake zero nodes | CPU and per-instance metrics cannot observe an empty group; use a whole-group metric with `autoscaling_min_replicas = 0` or set a manual/scheduled minimum.       |
| Delivery state disappeared           | The supplied delivery server is in-memory and loses state whenever it is replaced or restarted. Do not describe it as durable or highly available.                |
| A container fails during startup     | Read `journalctl -u google-startup-scripts.service` or serial-console output; `docker run --rm` removes an exited container and health checks trigger MIG repair. |

## Remove the deployment

Disable any enabled autoscaler and remove application capacity first when you
need a controlled domain shutdown, then destroy the infrastructure:

```bash
terraform apply -var='autoscaling_enabled=false' -var='application_replicas=0'
terraform destroy
```

`terraform destroy` removes only resources created by this template. It does not
delete the application registry, application storage, externally managed
secrets, images, VPC, or an operator-managed public edge.
