# Spine Rust Server Framework — Exploratory Design Draft

> **Status:** Disposable working document; not an accepted specification.
>
> **Date:** 2026-08-13.
>
> **Audience:** (1) a reader with little or no Rust experience who knows Spine
> conceptually, and (2) a future Codex agent asked to analyze or refine the
> proposal.
>
> **Scope:** The server-side framework and the code written by an application
> developer who uses it. A Rust-native browser UI and a complete Rust client are
> discussed only where they affect the server interface.

This document explores what a server-side Spine implementation in Rust could
look like. It is intentionally detailed. It is meant to be questioned and
edited over several rounds rather than treated as a decision that has already
been made.

Most Rust code below is **proposed syntax**, not an implementation known to
exist. Names such as `CommandScope`, `spine_build`, and `#[spine::handlers]`
are design candidates. Code blocks marked **conceptual expansion** describe
what generated code would accomplish; they are not promised to compile as
written.

## Contents

1. [Executive position](#1-executive-position)
2. [How to read the Rust examples](#2-how-to-read-the-rust-examples)
3. [What “Spine Rust” should mean](#3-what-spine-rust-should-mean)
4. [Design principles](#4-design-principles)
5. [The proposed end-user experience](#5-the-proposed-end-user-experience)
6. [A complete small application](#6-a-complete-small-application)
7. [Handler syntax in detail](#7-handler-syntax-in-detail)
8. [Why this is different from JVM annotations and TS decorators](#8-why-this-is-different-from-jvm-annotations-and-ts-decorators)
9. [Protobuf and model code generation](#9-protobuf-and-model-code-generation)
10. [What the handler macro generates](#10-what-the-handler-macro-generates)
11. [Entity state and transaction semantics](#11-entity-state-and-transaction-semantics)
12. [Aggregates, Projections, and Process Managers](#12-aggregates-projections-and-process-managers)
13. [Bounded-context assembly](#13-bounded-context-assembly)
14. [Server and transport interface](#14-server-and-transport-interface)
15. [Storage interface](#15-storage-interface)
16. [Commands, events, queries, and subscriptions](#16-commands-events-queries-and-subscriptions)
17. [Rejections and failures](#17-rejections-and-failures)
18. [Testing experience](#18-testing-experience)
19. [Concurrency, performance, and reliability](#19-concurrency-performance-and-reliability)
20. [Crate and module layout](#20-crate-and-module-layout)
21. [Diagnostics and developer tooling](#21-diagnostics-and-developer-tooling)
22. [Interoperability requirements](#22-interoperability-requirements)
23. [Alternatives considered](#23-alternatives-considered)
24. [Possible delivery sequence](#24-possible-delivery-sequence)
25. [Open questions](#25-open-questions)
26. [Compact glossary](#26-compact-glossary)
27. [Reference material](#27-reference-material)

## 1. Executive position

A server-side Spine Rust is technically feasible. The recommended product is
not a translation of Java classes into Rust structs or TypeScript decorators
into decorative Rust attributes. It is a new implementation of the same Spine
domain and wire semantics using Rust's static type system, ownership rules,
traits, generated code, and explicit registration.

The central proposal is:

- Keep application contracts in Protobuf.
- Generate Rust message types and Spine-specific marker traits from the same
  descriptors and custom options used by Spine JVM and Spine TS.
- Let an application author write ordinary Rust `struct` and `impl` blocks.
- Put one procedural macro on the handler `impl` block. Method attributes such
  as `#[spine::assign]` are role markers consumed by that outer macro.
- Generate statically typed dispatcher adapters during compilation.
- Register handler hosts explicitly with a bounded context. Do not scan source
  files, the filesystem, the classpath, or the final executable.
- Give handlers a short-lived, typed `CommandScope` or `EventScope` through
  which they read and update one entity's transactional draft.
- Keep domain handlers synchronous. Storage, buses, network transports,
  delivery, and server lifecycle remain asynchronous around them.
- Represent a business rejection as Rust's ordinary `Result::Err` containing a
  generated Protobuf rejection message. Do not throw it.
- Continue serving the existing Protobuf command/query/subscription protocol,
  allowing existing TypeScript and JVM clients to use the Rust server.

The normal application code should look approximately like this:

```rust
use spine::prelude::*;
use crate::model::{CompleteTask, Task, TaskAlreadyDone, TaskCompleted};

#[derive(Default)]
struct TaskAggregate;

#[spine::handlers(state = Task)]
impl TaskAggregate {
    #[spine::assign]
    fn complete_task(
        &self,
        _command: &CompleteTask,
        scope: &mut CommandScope<'_, Task>,
    ) -> Result<TaskCompleted, TaskAlreadyDone> {
        if scope.state().completed {
            return Err(TaskAlreadyDone {
                id: Some(scope.id().clone()),
            });
        }

        scope.update(|task| task.completed = true);

        Ok(TaskCompleted {
            id: Some(scope.id().clone()),
        })
    }
}
```

The attributes are visible, but the architecture is not annotation-driven in
the JVM reflection sense. The compiler macro turns the `impl` block into typed
Rust code. Generated marker traits prove that `CompleteTask` is a command,
`TaskCompleted` is an event, `TaskAlreadyDone` is a rejection, and `Task` is an
Aggregate state. If any role is wrong, compilation fails.

The strongest initial product shape would be:

> **Rust application runtime + existing universal Spine protocol + existing
> TypeScript browser client.**

An all-Rust client can be added, but it is not required to validate the server
architecture or realize the server-side performance and reliability benefits.

## 2. How to read the Rust examples

This section provides just enough Rust vocabulary to understand the proposed
framework-user code. It is not a general Rust tutorial.

### 2.1 Cargo package, crate, and module

Cargo is Rust's build and package tool.

- A **package** is described by a `Cargo.toml` file.
- A **crate** is one compiled Rust library or executable target within a
  package.
- A **module** organizes names inside a crate, similarly to a TypeScript module
  or a Java package, although the rules are different.
- A Cargo **workspace** groups multiple packages, similarly to a pnpm
  workspace or Gradle multi-project build.

### 2.2 `struct` and `impl`

A `struct` declares data. An `impl` block declares functions associated with a
type and methods that receive `self`.

```rust
struct TaskPolicy {
    maximum_title_length: usize,
}

impl TaskPolicy {
    fn accepts(&self, title: &str) -> bool {
        title.len() <= self.maximum_title_length
    }
}
```

Rust has no class inheritance. A Spine Rust Aggregate should therefore not
pretend to extend an `Aggregate` base class. Framework capabilities should be
supplied through traits and handler scopes instead.

### 2.3 Borrowing: `&T` and `&mut T`

`&T` is a shared, read-only reference to a value. `&mut T` is an exclusive,
mutable reference. The compiler prevents an exclusive mutable reference from
coexisting with other active references to the same value.

In the proposed handler:

```rust
fn rename(
    &self,
    command: &RenameTask,
    scope: &mut CommandScope<'_, Task>,
) -> TaskRenamed
```

- `&self` means the handler host is shared and not mutated.
- `&RenameTask` means the framework lends the decoded command to the handler.
- `&mut CommandScope` means the handler temporarily has exclusive authority to
  update this entity transaction.

This signature communicates the ownership model to both the human reader and
the compiler.

### 2.4 The lifetime spelling `'_`

The `'_` in `CommandScope<'_, Task>` says that the scope contains temporary
references whose exact lifetime the compiler should infer. The application
does not choose or store that lifetime. The scope exists only while the handler
runs.

### 2.5 `Result`, `Ok`, `Err`, and `?`

Rust commonly expresses a successful or unsuccessful operation as:

```rust
Result<SuccessType, ErrorType>
```

For a Spine command handler, the error can be a domain rejection:

```rust
Result<TaskCompleted, TaskAlreadyDone>
```

`Ok(event)` accepts the command and emits the event. `Err(rejection)` rejects
the command. The `?` operator returns an error early when a nested operation
fails.

Unlike an exception, the rejection is visible in the function's type and must
be handled by generated dispatcher code.

### 2.6 Attributes and derive macros

Rust attributes start with `#`:

```rust
#[derive(Default)]
struct TaskAggregate;

#[spine::handlers(state = Task)]
impl TaskAggregate {
    #[spine::assign]
    fn create_task(/* ... */) { /* ... */ }
}
```

Attributes are normal Rust syntax. A procedural macro can consume Rust syntax
at compile time and emit more Rust syntax. This differs from storing passive
runtime annotations and later finding them through reflection.

`#[derive(Default)]` generates the standard `Default` trait implementation.
For the zero-sized `TaskAggregate`, the default value is simply
`TaskAggregate`.

### 2.7 Traits

A trait describes behavior or a compile-time capability. It resembles an
interface, but Rust traits are also used heavily for generic constraints and
generated behavior.

Conceptually, model generation could produce:

```rust
impl spine::model::CommandMessage for CreateTask { /* generated metadata */ }
impl spine::model::EventMessage for TaskCreated { /* generated metadata */ }
impl spine::model::EntityState for Task { /* generated entity metadata */ }
```

Application code normally would not write these implementations. Their
presence lets the compiler reject an event accidentally used as an assigned
command.

### 2.8 `async`, `.await`, and the proposed handler rule

Rust marks asynchronous functions explicitly:

```rust
async fn start_server() -> Result<(), ServerError> {
    Server::new().run().await
}
```

The proposed server runtime uses async I/O. Domain handlers do not:

```rust
// Proposed and supported.
fn complete_task(&self, command: &CompleteTask, scope: &mut CommandScope<'_, Task>)
    -> Result<TaskCompleted, TaskAlreadyDone>;

// Proposed to be rejected by the handler macro.
async fn complete_task(/* ... */) -> TaskCompleted;
```

This prevents an application from holding an entity transaction open while it
waits on arbitrary network I/O. It also makes transaction duration,
concurrency, and retries much easier to reason about.

## 3. What “Spine Rust” should mean

### 3.1 A compatible implementation, not a port

“Spine Rust” should mean an implementation of Spine's public model and runtime
semantics for Rust applications. It should preserve behavior where behavior is
part of the cross-language contract, while selecting Rust-native mechanisms
inside the language.

The following should remain compatible:

- Protobuf message definitions and binary wire encoding.
- Full message names and Spine type URL prefixes.
- Spine custom Protobuf options.
- Command, event, rejection, entity, validation, query, and subscription
  concepts.
- Command, Query, and Subscription service contracts.
- Actor, tenant, origin, timestamp, and causality metadata.
- The rule that one command type has one assignee in the applicable context.
- Event fan-out to matching subscribers and reactors.
- Domain rejection envelopes and rejected-command context, subject to the same
  client-facing redaction policy.
- Entity routing rules, including compatible defaults and explicit override
  semantics.

The following need not remain mechanically similar:

- Java base classes or inheritance.
- Runtime annotation reflection.
- TypeScript decorators as metadata containers.
- TypeScript compiler source analysis.
- JVM classpath scanning.
- Java builders or TypeScript object factories.
- Node's event-loop execution model.
- Java or TypeScript package layout.

### 3.2 Behavioral baseline must be named

Before implementation, the project would need to state exactly which behavior
is authoritative when Spine JVM and Spine TS differ.

A reasonable initial rule would be:

1. Shared Protobuf and network contracts are authoritative.
2. Accepted domain semantics from Spine JVM are authoritative where Spine TS
   intentionally seeks JVM parity.
3. Accepted Spine TS behavior is authoritative for its explicitly documented
   deviations and newer universal browser protocol.
4. Rust-specific implementation decisions may differ only where externally
   observable behavior remains compatible or the difference is documented.

This draft assumes the current Spine TS model in which the latest stored entity
state is authoritative and the stored event journal is not used to reconstruct
Aggregates on every command. A future event-sourced mode would be a separate
architectural decision rather than something silently introduced by the Rust
port.

### 3.3 Server-side scope

A complete server framework eventually includes:

- model generation and validation metadata;
- bounded contexts;
- Aggregate, Projection, and Process Manager execution;
- command and event buses;
- repositories and entity transactions;
- typed rejections;
- query execution and subscriptions;
- storage adapters;
- inbox/delivery processing and deduplication;
- authentication/authorization seams at the network edge;
- native gRPC and browser-compatible transport;
- lifecycle, readiness, shutdown, tracing, and diagnostics;
- black-box application testing.

The existence of a Rust client is not a prerequisite. A Rust server can be
valuable while TypeScript, JVM, or other generated clients use it.

## 4. Design principles

### 4.1 Make invalid application structures fail at compile time

When generated metadata proves that `CreateTask` is a command, a handler with
this shape should compile:

```rust
#[spine::assign]
fn create(&self, command: &CreateTask, scope: &mut CommandScope<'_, Task>)
    -> TaskCreated;
```

These should fail compilation:

```rust
// Input is an event, not a command.
#[spine::assign]
fn create(&self, event: &TaskCreated, scope: &mut CommandScope<'_, Task>)
    -> TaskCreated;

// An assignee must emit at least one event.
#[spine::assign]
fn create(&self, command: &CreateTask, scope: &mut CommandScope<'_, Task>);

// An assignee cannot emit a command.
#[spine::assign]
fn create(&self, command: &CreateTask, scope: &mut CommandScope<'_, Task>)
    -> ScheduleTask;
```

The macro does not need compiler-private semantic reflection to achieve this.
It emits ordinary generic Rust constraints, and `rustc` type-checks them.

### 4.2 Use attributes as compile-time syntax, not runtime metadata

Rust attributes are appropriate. Frameworks such as serialization, async
runtimes, command-line parsers, and web routers commonly use them. The design
mistake would be to make them passive markers later searched at runtime.

The outer `#[spine::handlers]` macro should consume the complete handler `impl`
block and generate adapters immediately. Inner method attributes identify
roles. No runtime method name lookup is required.

### 4.3 Keep registration explicit

The application should say which handler hosts belong to a bounded context:

```rust
BoundedContext::single_tenant("Tasks")
    .add(TaskAggregate)
    .add(TaskViewProjection)
    .build()
    .await
```

This is preferable to hidden linker registries, source-directory conventions,
or executable scanning because it is:

- visible in code review;
- deterministic across native targets;
- friendly to dead-code elimination;
- straightforward in tests;
- compatible with dependency injection;
- independent of linker-specific tricks.

### 4.4 Separate shared behavior from per-entity state

The handler host is a shared behavior object. It may hold immutable policies or
thread-safe dependencies. It should not hold the mutable state of one entity.

```rust
struct PricingAggregate {
    policy: std::sync::Arc<PricingPolicy>,
}
```

The per-command draft lives in `CommandScope`. This avoids simulating a Java
object whose fields are secretly replaced each time a different entity is
loaded. It also makes concurrent use of one handler host safe and visible.

### 4.5 Make mutation authority explicit

Only a mutable scope can change state:

```rust
scope.update(|task| task.completed = true);
```

The handler cannot retain `scope` or a reference to its state after returning.
Rust's lifetime checker enforces that property.

### 4.6 Keep handlers synchronous

The runtime may await storage before and after a handler. It should not await
inside a handler while holding a transaction draft or entity lock.

Expected flow:

```text
await load -> invoke synchronous handler -> validate/prepare -> await commit
```

External I/O belongs in adapters, gateways, or separately modeled workflows,
not inside an Aggregate state transition.

### 4.7 Use `Result` for expected domain refusal

Business refusal is data and belongs in the function type:

```rust
Result<TaskCompleted, TaskAlreadyDone>
```

A panic means a defect or violated internal invariant. A storage timeout means
an infrastructure failure. Neither should be presented as the modeled
`TaskAlreadyDone` rejection.

### 4.8 Generate into Cargo's output directory

Normal generation should write to Cargo's `OUT_DIR`, not modify `src/` during a
build. Cargo explicitly supports build-time generation in `build.rs` and
inclusion through `include!`.

Generated files can remain untracked and reproducible. A separate inspection
command may render them into a temporary human-readable directory when users
need to debug generation.

### 4.9 Keep the public interface small

A normal application should mostly learn:

- generated message types;
- `#[spine::handlers]` and the four ordinary handler role attributes;
- `CommandScope` and `EventScope`;
- `BoundedContext`;
- `Server`;
- a selected storage adapter;
- `BlackBox` for tests.

Registries, erased dispatchers, descriptor visitors, queue workers, transaction
coordinators, and transport frames should remain framework implementation.

## 5. The proposed end-user experience

This section presents the intended development workflow before explaining each
mechanism in depth.

### 5.1 Create a Cargo package

An application package might contain:

```text
tasks-server/
├── Cargo.toml
├── build.rs
├── proto/
│   └── example/
│       └── tasks/
│           ├── task_id.proto
│           ├── task_commands.proto
│           ├── task_events.proto
│           ├── task_rejections.proto
│           ├── tasks.proto
│           └── task_views.proto
├── src/
│   ├── main.rs
│   ├── model.rs
│   ├── context.rs
│   └── domain/
│       ├── mod.rs
│       ├── task_aggregate.rs
│       └── task_view_projection.rs
└── tests/
    └── tasks.rs
```

Large systems should normally put shared Protobuf models in separate Cargo
packages so servers, native clients, and tests depend on one generated model
crate.

### 5.2 Declare dependencies

Proposed `Cargo.toml`:

```toml
[package]
name = "tasks-server"
version = "0.1.0"
edition = "2024"

[dependencies]
spine = { version = "0.1", features = ["server", "testing"] }
tokio = { version = "1", features = ["macros", "rt-multi-thread", "signal"] }

[build-dependencies]
spine-build = "0.1"

[dev-dependencies]
pretty_assertions = "1"
```

Version numbers are placeholders. The important interface decision is that the
application should generally depend on one `spine` facade, while build-time
generation uses a separate `spine-build` package because Cargo compiles build
dependencies for the host environment.

Durable adapters can remain separate dependencies:

```toml
spine-storage-sql = { version = "0.1", features = ["postgres"] }
```

### 5.3 Generate the model in `build.rs`

Proposed `build.rs`:

```rust
fn main() -> Result<(), Box<dyn std::error::Error>> {
    spine_build::Model::new()
        .proto_root("proto")
        .include_spine_protos()
        .compile_package("example/tasks")?;

    Ok(())
}
```

`spine_build` would:

1. Tell Cargo which `.proto` files trigger regeneration.
2. Run or embed a compatible Protobuf compiler.
3. produce a descriptor set with source information;
4. validate Spine file naming and custom options;
5. generate Rust message types;
6. generate validation code;
7. generate Spine marker-trait implementations and static metadata;
8. generate a model registry module;
9. write all artifacts beneath `OUT_DIR`.

### 5.4 Include the generated module

Proposed `src/model.rs`:

```rust
spine::include_model!("example.tasks");
```

The macro is a small wrapper around Cargo's `include!` pattern. It includes the
generated message modules, Spine metadata, descriptor bytes, and a model
registry.

The generated module should re-export an application-friendly prelude:

```rust
use crate::model::prelude::*;
```

This prelude may include message types and generated extension traits, but it
must avoid importing broad framework internals or causing common name clashes.

### 5.5 Write handler hosts

```rust
#[derive(Default)]
struct TaskAggregate;

#[spine::handlers(state = Task)]
impl TaskAggregate {
    #[spine::assign]
    fn create_task(
        &self,
        command: &CreateTask,
        scope: &mut CommandScope<'_, Task>,
    ) -> TaskCreated {
        // Domain behavior.
    }
}
```

The struct can be empty. If the behavior needs dependencies, the application
puts them in the struct and passes a configured value to the bounded context.

### 5.6 Assemble a bounded context

```rust
async fn tasks_context() -> spine::Result<BoundedContext> {
    BoundedContext::single_tenant("Tasks")
        .storage(spine::storage::InMemory::new())
        .add(TaskAggregate)
        .add(TaskViewProjection)
        .build()
        .await
}
```

At build time, the context validates duplicate assignees, model registration,
entity kinds, routes, and storage capabilities before accepting traffic.

### 5.7 Run the server

```rust
#[tokio::main]
async fn main() -> spine::Result<()> {
    let tasks = tasks_context().await?;

    Server::builder()
        .listen(([127, 0, 0, 1], 8080))
        .add(tasks)
        .run()
        .await
}
```

`run()` owns signal handling and graceful shutdown. An embedded host could use
`start()` and close the returned server handle itself.

### 5.8 Test through `BlackBox`

```rust
#[tokio::test]
async fn completing_a_task_updates_the_view() -> spine::Result<()> {
    let context = tasks_context().await?;
    let app = BlackBox::from(context).await?;
    let alice = app.on_behalf_of("alice");

    let id = TaskId { value: "T-100".into() };

    alice.post(CreateTask {
        id: Some(id.clone()),
        title: "Write the Rust design".into(),
    }).await?;

    alice.post(CompleteTask {
        id: Some(id.clone()),
    }).await?;

    let view = app.eventually(|| async {
        alice.query::<TaskView>()
            .by_id(id.clone())
            .one()
            .await
    }).await?;

    assert!(view.completed);
    app.close().await?;
    Ok(())
}
```

The exact query DSL is still open. The stable requirement is that BlackBox use
the same public command/query/subscription services as a real client, not a
test-only repository shortcut.

## 6. A complete small application

This example is intentionally longer than a quick-start. It shows how all
visible pieces could fit together.

### 6.1 Protobuf model

`proto/example/tasks/task_id.proto`:

```proto
syntax = "proto3";

package example.tasks;

import "spine/options.proto";

option (type_url_prefix) = "type.example.tasks";

message TaskId {
  string value = 1 [(required) = true];
}
```

`proto/example/tasks/task_commands.proto`:

```proto
syntax = "proto3";

package example.tasks;

import "example/tasks/task_id.proto";
import "spine/options.proto";

option (type_url_prefix) = "type.example.tasks";

message CreateTask {
  TaskId id = 1 [(required) = true, (validate) = true];
  string title = 2 [(required) = true];
}

message RenameTask {
  TaskId id = 1 [(required) = true, (validate) = true];
  string title = 2 [(required) = true];
}

message CompleteTask {
  TaskId id = 1 [(required) = true, (validate) = true];
}
```

`proto/example/tasks/task_events.proto`:

```proto
syntax = "proto3";

package example.tasks;

import "example/tasks/task_id.proto";
import "spine/options.proto";

option (type_url_prefix) = "type.example.tasks";

message TaskCreated {
  TaskId id = 1 [(required) = true, (validate) = true];
  string title = 2 [(required) = true];
}

message TaskRenamed {
  TaskId id = 1 [(required) = true, (validate) = true];
  string title = 2 [(required) = true];
}

message TaskCompleted {
  TaskId id = 1 [(required) = true, (validate) = true];
}
```

`proto/example/tasks/task_rejections.proto`:

```proto
syntax = "proto3";

package example.tasks;

import "example/tasks/task_id.proto";
import "spine/options.proto";

option (type_url_prefix) = "type.example.tasks";

message TaskAlreadyCompleted {
  TaskId id = 1 [(required) = true, (validate) = true];
}

message TaskTitleUnchanged {
  TaskId id = 1 [(required) = true, (validate) = true];
  string title = 2 [(required) = true];
}
```

`proto/example/tasks/tasks.proto`:

```proto
syntax = "proto3";

package example.tasks;

import "example/tasks/task_id.proto";
import "spine/options.proto";

option (type_url_prefix) = "type.example.tasks";

message Task {
  option (entity).kind = AGGREGATE;

  TaskId id = 1 [
    (required) = true,
    (validate) = true,
    (set_once) = true
  ];
  string title = 2 [(required) = true];
  bool completed = 3;
}
```

`proto/example/tasks/task_views.proto`:

```proto
syntax = "proto3";

package example.tasks;

import "example/tasks/task_id.proto";
import "spine/options.proto";

option (type_url_prefix) = "type.example.tasks";

message TaskView {
  option (entity).kind = PROJECTION;
  option (entity).visibility = FULL;

  TaskId id = 1 [
    (required) = true,
    (validate) = true,
    (set_once) = true
  ];
  string title = 2 [(required) = true, (column) = true];
  bool completed = 3 [(column) = true];
}
```

The naming conventions allow the model compiler to classify commands, events,
and rejections. The `(entity)` option classifies state messages. Field options
produce validation, transition, and query-column metadata.

### 6.2 Aggregate handler host

`src/domain/task_aggregate.rs`:

```rust
use spine::prelude::*;

use crate::model::{
    CompleteTask,
    CreateTask,
    RenameTask,
    Task,
    TaskAlreadyCompleted,
    TaskCompleted,
    TaskCreated,
    TaskRenamed,
    TaskTitleUnchanged,
};

#[derive(Default)]
pub(crate) struct TaskAggregate;

#[spine::handlers(state = Task)]
impl TaskAggregate {
    #[spine::assign]
    fn create_task(
        &self,
        command: &CreateTask,
        scope: &mut CommandScope<'_, Task>,
    ) -> TaskCreated {
        scope.replace(Task {
            id: Some(scope.id().clone()),
            title: command.title.clone(),
            completed: false,
        });

        TaskCreated {
            id: Some(scope.id().clone()),
            title: command.title.clone(),
        }
    }

    #[spine::assign]
    fn rename_task(
        &self,
        command: &RenameTask,
        scope: &mut CommandScope<'_, Task>,
    ) -> Result<TaskRenamed, TaskTitleUnchanged> {
        if scope.state().title == command.title {
            return Err(TaskTitleUnchanged {
                id: Some(scope.id().clone()),
                title: command.title.clone(),
            });
        }

        scope.update(|task| task.title.clone_from(&command.title));

        Ok(TaskRenamed {
            id: Some(scope.id().clone()),
            title: command.title.clone(),
        })
    }

    #[spine::assign]
    fn complete_task(
        &self,
        _command: &CompleteTask,
        scope: &mut CommandScope<'_, Task>,
    ) -> Result<TaskCompleted, TaskAlreadyCompleted> {
        if scope.state().completed {
            return Err(TaskAlreadyCompleted {
                id: Some(scope.id().clone()),
            });
        }

        scope.update(|task| task.completed = true);

        Ok(TaskCompleted {
            id: Some(scope.id().clone()),
        })
    }
}
```

Points important to a non-Rust reader:

- `TaskAggregate` contains no entity state. It represents shared behavior.
- `pub(crate)` makes it visible inside this application crate, but not a public
  type exported to unrelated crates.
- The framework routes the command before invoking the handler, so
  `scope.id()` is a validated, typed `TaskId`.
- Protobuf message-valued fields are shown as `Option<T>` because that is the
  conventional shape in common Rust Protobuf generators. `Some(value)` means
  the field is present.
- `clone()` creates an owned ID for the state or emitted event. The scope still
  owns its original ID.
- `scope.replace` initializes the entire draft. `scope.update` changes selected
  fields.
- If a handler returns `Err`, every draft change made during that handler is
  discarded before the typed rejection event is published.
- The return type itself tells code generation which event and rejection types
  can be produced.

### 6.3 Projection handler host

`src/domain/task_view_projection.rs`:

```rust
use spine::prelude::*;

use crate::model::{
    TaskCompleted,
    TaskCreated,
    TaskRenamed,
    TaskView,
};

#[derive(Default)]
pub(crate) struct TaskViewProjection;

#[spine::handlers(state = TaskView)]
impl TaskViewProjection {
    #[spine::subscribe]
    fn on_task_created(
        &self,
        event: &TaskCreated,
        scope: &mut EventScope<'_, TaskView>,
    ) {
        scope.replace(TaskView {
            id: Some(scope.id().clone()),
            title: event.title.clone(),
            completed: false,
        });
    }

    #[spine::subscribe]
    fn on_task_renamed(
        &self,
        event: &TaskRenamed,
        scope: &mut EventScope<'_, TaskView>,
    ) {
        scope.update(|view| view.title.clone_from(&event.title));
    }

    #[spine::subscribe]
    fn on_task_completed(
        &self,
        _event: &TaskCompleted,
        scope: &mut EventScope<'_, TaskView>,
    ) {
        scope.update(|view| view.completed = true);
    }
}
```

The first field of each event is a `TaskId`, matching the Projection ID. The
generated default event router can therefore route these events without an
application-defined routing function.

The Projection changes queryable state but emits no signal. `#[subscribe]`
requires a unit return (`()`), which is implicit when the function ends without
a final value.

### 6.4 Bounded-context assembly

`src/context.rs`:

```rust
use spine::prelude::*;

use crate::domain::{TaskAggregate, TaskViewProjection};

pub async fn tasks_context<S>(storage: S) -> spine::Result<BoundedContext>
where
    S: StorageFactory,
{
    BoundedContext::single_tenant("Tasks")
        .storage(storage)
        .model(crate::model::registry())
        .add(TaskAggregate)
        .add(TaskViewProjection)
        .build()
        .await
}
```

The generic parameter `S` lets this function accept an in-memory or durable
storage adapter without changing handlers. The `where` clause says that `S`
must implement the framework's `StorageFactory` trait.

The `.model(...)` call may be unnecessary if every handler's generated
metadata can compose the complete registry. Keeping it explicit initially is
safer for models that contain client-visible types not mentioned by a server
handler. This is an open interface choice.

### 6.5 Server entry point

`src/main.rs`:

```rust
mod context;
mod domain;
mod model;

use spine::prelude::*;

#[tokio::main]
async fn main() -> spine::Result<()> {
    spine::telemetry::init_from_environment()?;

    let storage = spine::storage::InMemory::new();
    let tasks = context::tasks_context(storage).await?;

    Server::builder()
        .listen(([127, 0, 0, 1], 8080))
        .add(tasks)
        .run()
        .await
}
```

A production application could replace one line:

```rust
let storage = spine_storage_sql::Postgres::connect_from_environment().await?;
```

No domain handler changes.

### 6.6 A rejection test

```rust
#[tokio::test]
async fn completing_twice_produces_a_typed_rejection() -> spine::Result<()> {
    let app = test_application().await?;
    let user = app.on_behalf_of("alice");
    let id = TaskId { value: "T-101".into() };

    user.post(CreateTask {
        id: Some(id.clone()),
        title: "Study Rust Result".into(),
    }).await?;

    user.post(CompleteTask { id: Some(id.clone()) }).await?;

    let outcome = user
        .post(CompleteTask { id: Some(id.clone()) })
        .await?;

    let rejection = outcome.rejection::<TaskAlreadyCompleted>()?;
    assert_eq!(rejection.id, Some(id));

    app.close().await?;
    Ok(())
}
```

Whether `post()` returns an immediate typed outcome or command acceptance plus
a separate observed rejection must match the chosen Spine service contract.
The example expresses the desired type-safe testing experience, not a change to
the wire protocol.

## 7. Handler syntax in detail

### 7.1 One outer macro per state/handler group

Recommended normal form:

```rust
#[spine::handlers(state = Task)]
impl TaskAggregate {
    // Handler methods.
}
```

The outer macro sees the complete `impl` block. It can check structural rules,
consume handler-role attributes, preserve ordinary methods, and generate one
coherent handler descriptor for the state type.

Initial restrictions should be deliberately simple:

- One `#[spine::handlers]` block per handler-host type.
- Every handler is an instance method with `&self`.
- The first non-receiver parameter is a borrowed signal.
- The second parameter is a mutable command/event scope for the declared state.
- Return types are explicit.
- Handler methods are synchronous.
- Ordinary helper methods belong in a separate, unannotated `impl` block.

Example with a helper:

```rust
struct TaskAggregate {
    titles: TitlePolicy,
}

impl TaskAggregate {
    fn normalized_title(&self, value: &str) -> String {
        self.titles.normalize(value)
    }
}

#[spine::handlers(state = Task)]
impl TaskAggregate {
    #[spine::assign]
    fn rename(
        &self,
        command: &RenameTask,
        scope: &mut CommandScope<'_, Task>,
    ) -> Result<TaskRenamed, InvalidTaskTitle> {
        let title = self.normalized_title(&command.title);
        // ...
    }
}
```

Keeping helpers separate lets the macro treat every method in its block as an
intentional handler declaration and improves diagnostics.

### 7.2 `#[spine::assign]`

An assignee handles a command routed to an entity and emits one or more events,
or a typed rejection.

```rust
#[spine::assign]
fn complete(
    &self,
    command: &CompleteTask,
    scope: &mut CommandScope<'_, Task>,
) -> Result<TaskCompleted, TaskAlreadyCompleted>
```

Generated constraints should require:

- `CompleteTask: CommandMessage`;
- `Task: EntityState` with an entity kind that permits assignment;
- scope state exactly equal to the handler group's state;
- accepted output contains at least one `EventMessage`;
- rejected output is a `RejectionMessage`;
- no `async`, generic handler method, variadic input, or arbitrary extra
  parameter.

Allowed output forms could be:

```rust
// One event, cannot reject.
fn handle(/* ... */) -> TaskCreated

// One event or one rejection type.
fn handle(/* ... */) -> Result<TaskCreated, TaskAlreadyExists>

// Two events.
fn handle(/* ... */) -> (TaskCreated, TaskAssigned)

// One required event and one conditional event.
fn handle(/* ... */) -> (TaskCreated, Option<TaskAssigned>)

// Multiple events of one type, statically non-empty.
fn handle(/* ... */) -> NonEmpty<TaskItemAdded>

// Multiple heterogeneous events, if a literal macro is provided.
fn handle(/* ... */) -> EmittedEvents
```

An ordinary `Vec<Event>` should not be the only accepted assignee output if an
empty vector would violate the rule that a command produces an outcome. A
`NonEmpty<E>` type or `spine::events![first, ...]` macro can preserve the
invariant.

### 7.3 `#[spine::subscribe]`

A subscriber consumes an event or rejection and updates entity state without
emitting another signal.

```rust
#[spine::subscribe]
fn on_task_completed(
    &self,
    event: &TaskCompleted,
    scope: &mut EventScope<'_, TaskView>,
) {
    scope.update(|view| view.completed = true);
}
```

Generated constraints should require:

- input implements `EventMessage` or `RejectionMessage`;
- return type is `()` in the initial interface;
- scope contains the declared entity state;
- a default or explicit route exists.

A later reliability design may allow a typed delivery failure return. It
should not casually reuse domain rejections. A failed event delivery and a
rejected command are different concepts.

### 7.4 `#[spine::react]`

A reactor consumes an event or rejection and emits zero or more events.

```rust
#[spine::react]
fn on_payment_expired(
    &self,
    event: &PaymentExpired,
    scope: &mut EventScope<'_, OrderProcess>,
) -> Option<OrderCancelled> {
    if scope.state().finished {
        return None;
    }

    scope.update(|process| process.finished = true);
    Some(OrderCancelled {
        order: Some(scope.id().clone()),
    })
}
```

Unlike an assignee, a reactor may legitimately emit nothing. Reasonable output
forms are `()`, `Option<E>`, `Vec<E>`, a tuple, or a framework collection of
heterogeneous generated events.

### 7.5 `#[spine::command]`

A command reaction consumes an event or rejection and emits one or more
commands:

```rust
#[spine::command]
fn reserve_stock(
    &self,
    event: &OrderPaid,
    scope: &mut EventScope<'_, OrderProcess>,
) -> ReserveStock {
    ReserveStock {
        order: Some(scope.id().clone()),
        items: event.items.clone(),
    }
}
```

Generated constraints should require an event/rejection input and command
outputs. Commands are posted after the current state transaction commits.

### 7.6 No ordinary public `#[spine::apply]`

The current Spine TS direction treats generated command/event handlers and
latest entity state as the normal runtime and keeps legacy event application
out of ordinary application syntax. Spine Rust should not introduce an
`#[apply]` concept merely because an older framework version has it.

If event-sourced Aggregate reconstruction becomes a requirement, it should be
designed explicitly with replay semantics, snapshots, deterministic appliers,
and migration rules. It should not be an unexplained fifth annotation.

### 7.7 Context metadata

The scope should expose the signal context without adding a third handler
parameter:

```rust
#[spine::assign]
fn create(
    &self,
    command: &CreateTask,
    scope: &mut CommandScope<'_, Task>,
) -> TaskCreated {
    let actor = scope.context().actor();
    let tenant = scope.context().tenant();
    let timestamp = scope.context().timestamp();
    // ...
}
```

For event delivery:

```rust
let producer = scope.context().producer();
let origin = scope.context().origin();
let rejection = scope.context().rejection();
```

The exact generated Protobuf context message can remain available through a
lower-level accessor when an application genuinely needs it. Convenience
accessors should preserve presence semantics rather than silently inventing
metadata.

### 7.8 External events

JVM Spine uses an annotation to distinguish external events. A Rust-native
option is a wrapper type:

```rust
#[spine::react]
fn on_payment_captured(
    &self,
    event: External<'_, PaymentCaptured>,
    scope: &mut EventScope<'_, OrderProcess>,
) -> OrderPaid
```

`External<'_, E>` would lend an `E` and statically mark its origin
classification. This is preferable to a second passive method annotation
because the distinction appears in the handler's input type.

Whether external/domestic classification belongs in the first Rust milestone
depends on the chosen Spine parity target.

### 7.9 Routing

Compatible default routing should be generated from Protobuf metadata:

- command routing uses the modeled command target ID convention;
- event routing first uses compatible producer-ID rules and then appropriate
  event fields;
- state metadata identifies its ID type and first ID field;
- explicit routes override only the cases they declare.

For a non-default route, prefer a typed Rust function path:

```rust
fn board_from_message(event: &MessagePosted) -> BoardId {
    event.board.clone().unwrap_or_default()
}

#[spine::handlers(state = BoardView)]
impl BoardViewProjection {
    #[spine::subscribe(route = board_from_message)]
    fn on_message(
        &self,
        event: &MessagePosted,
        scope: &mut EventScope<'_, BoardView>,
    ) {
        // ...
    }
}
```

The attribute argument is a Rust path, not a string containing a method name.
Generated code type-checks:

- the router's input type;
- its returned ID type;
- compatibility with the state ID;
- whether one or many targets are permitted.

For fan-out routing, a router could return an iterator or a framework-owned
`Routes<Id>` value. That requires a separate detailed contract for duplicates,
ordering, and empty results.

### 7.10 Dependency injection

Because state lives in a scope, the handler host can safely be a shared value:

```rust
use std::sync::Arc;

struct OrderAggregate {
    pricing: Arc<PricingPolicy>,
}

impl OrderAggregate {
    fn new(pricing: Arc<PricingPolicy>) -> Self {
        Self { pricing }
    }
}

#[spine::handlers(state = Order)]
impl OrderAggregate {
    #[spine::assign]
    fn place_order(
        &self,
        command: &PlaceOrder,
        scope: &mut CommandScope<'_, Order>,
    ) -> Result<OrderPlaced, PriceRejected> {
        let total = self.pricing.total(&command.items)?;
        // ...
    }
}
```

The context receives a configured value:

```rust
.add(OrderAggregate::new(pricing))
```

The handler host should satisfy `Send + Sync + 'static` because the async
runtime may invoke it from multiple worker threads. Ordinary immutable fields
often satisfy these traits automatically. Shared mutable caches require an
appropriate synchronization type and should not contain entity state.

## 8. Why this is different from JVM annotations and TS decorators

### 8.1 The current TS shape

In Spine TS, bare decorators mark methods such as `@Assign` and `@Subscribe`.
A build-time analyzer uses the TypeScript compiler to resolve imported
generated message types, validate parameter and return roles, and write a
versioned handler registry. The runtime loads and ingests that registry.

That is already better than relying only on runtime decorator metadata: the
registry is a generated bridge from source declarations to canonical metadata.

Rust changes which bridge is natural.

### 8.2 Rust procedural macros see syntax, not all compiler semantics

A stable procedural macro receives token streams. It can parse the `impl`
block and generate code, but it does not receive the same semantic type-checker
interface available to a TypeScript compiler plugin.

This is not a blocker. The macro should not try to reimplement Rust type
resolution. Instead it emits code with trait constraints and lets the Rust
compiler resolve and verify the types.

Example principle:

```rust
// The macro can generate an adapter whose generic bounds require this.
where
    CreateTask: CommandMessage,
    TaskCreated: EventMessage,
    TaskAlreadyCompleted: RejectionMessage,
    Task: EntityState<Id = TaskId>,
```

If generated model code does not implement one of these traits, normal Rust
type checking fails.

### 8.3 No runtime reflection

Rust has runtime type identification facilities, but no Java-style reflection
over arbitrary methods and annotations. A Spine server does not need it.

The macro generates a direct function adapter for each handler. At runtime,
dispatch uses the registered type URL to choose an adapter. The adapter decodes
or downcasts to a statically known type and calls the method directly.

There is no operation equivalent to:

```text
find method by string -> inspect annotation -> invoke reflectively
```

### 8.4 No separate Rust source scanner

A custom tool could parse every `.rs` file using `syn`, but that would be a
poor default because it would need to approximate:

- conditional compilation;
- macro expansion;
- module resolution;
- renamed dependencies;
- type aliases;
- generated modules;
- Cargo features and target-specific code.

`rustc` already owns those semantics. Procedural macros and trait checking
should operate inside normal compilation instead.

### 8.5 Attributes remain ergonomic and idiomatic

Rejecting attributes entirely would not necessarily make the interface more
Rust-like. Attributes are conventional Rust when they generate or validate
code at compile time.

The idiomatic distinction is:

- **Good:** `#[spine::assign]` contributes to generated typed dispatch code.
- **Bad:** `#[spine::assign]` stores a name in runtime metadata and a reflective
  registry later searches for it.

### 8.6 Why not only traits?

Pure trait syntax is possible:

```rust
impl Assign<CreateTask> for TaskAggregate {
    type State = Task;
    type Events = TaskCreated;
    type Rejection = Infallible;

    fn handle(
        &self,
        command: &CreateTask,
        scope: &mut CommandScope<'_, Task>,
    ) -> TaskCreated {
        // ...
    }
}
```

This is statically excellent, but one handler requires a large amount of
ceremony. Rust also cannot automatically enumerate every trait implementation
for a type. The application would still need to list command/event types or use
another macro to create the handler set.

The proposed attribute form generates these trait-like adapters while keeping
domain code compact. An explicit trait form could remain available as an
advanced escape hatch, but two equally promoted declaration styles would
increase documentation and compatibility cost.

## 9. Protobuf and model code generation

### 9.1 Inputs

The generator must consume a complete `FileDescriptorSet`, including source
information and interpreted or interpretable custom options.

It needs access to:

- application `.proto` files;
- Spine option and core model descriptors;
- imported model packages;
- exact type URL prefix declarations;
- message/field/file options;
- service descriptors where service generation is in scope.

### 9.2 Outputs

For every generated message, normal Protobuf code supplies serialization and
field access. Spine generation adds appropriate metadata and capabilities.

Conceptual generated traits:

```rust
pub trait SpineMessage: prost::Message + Default + Clone + Send + Sync + 'static {
    const FULL_NAME: &'static str;
    const TYPE_URL: &'static str;
    const DESCRIPTOR: MessageDescriptor;
}

pub trait CommandMessage: SpineMessage {
    type TargetId: EntityId;
    fn target_id(&self) -> Result<&Self::TargetId, ValidationError>;
}

pub trait EventMessage: SpineMessage {}

pub trait RejectionMessage: SpineMessage {}

pub trait EntityState: SpineMessage {
    type Id: EntityId;
    const KIND: EntityKind;
    const VISIBILITY: Visibility;
    const COLUMNS: &'static [ColumnDescriptor];
    const SET_ONCE_FIELDS: &'static [FieldDescriptor];

    fn id(&self) -> Option<&Self::Id>;
}
```

These exact trait shapes are provisional. The important properties are:

- message roles are explicit to the compiler;
- full names and type URLs are generated once;
- entity ID, kind, visibility, columns, and transition constraints are static;
- dispatch code need not infer roles from Rust type names;
- the public runtime does not need to expose a particular descriptor library
  everywhere.

### 9.3 Role classification

The model generator must follow an explicit, compatible rule for classifying
messages. Candidate inputs include:

- Spine-established file suffixes such as `commands.proto`, `events.proto`, and
  `rejections.proto`;
- custom options that directly identify roles;
- the `(entity)` message option;
- known framework message types.

The rule must not classify a message from its Rust module or struct name. Rust
names are generated representation, not the domain contract.

An ambiguous or contradictory descriptor should fail model generation with the
original `.proto` location.

### 9.4 Custom options

Spine Rust must understand at least the options required by its supported
behavior, including:

- `(type_url_prefix)`;
- `(entity).kind`;
- `(entity).visibility`;
- `(required)` and nested validation;
- `(set_once)`;
- `(column)`;
- message role/mixin options relevant to shared models;
- routing and external-event metadata when those features are supported.

It is insufficient to generate serializable structs while ignoring these
options. They define runtime behavior.

### 9.5 Required-field ergonomics

This is an important unresolved design area.

Common Rust Protobuf generators represent a singular message field as
`Option<T>` because the wire may omit it. Spine validates `(required)` before a
handler runs, but the generated Rust field type may still be optional. Without
additional support, handler code repeatedly writes:

```rust
let id = command.id.as_ref().expect("validated command must have ID");
```

That is noisy and can panic if used outside the validated handler path.

Possible solutions:

1. **Use raw generated fields.** Smallest generator, worst domain ergonomics.
2. **Generate safe accessors returning `Result`.** Honest everywhere, but a
   handler repeats `?` for fields the framework has already validated.
3. **Pass `Validated<M>` to handlers.** Correctly represents the invariant, but
   generic wrapper accessors are awkward without generated extension traits.
4. **Generate a validated view/newtype per message.** Best typed access, largest
   model surface and conversion burden.
5. **Choose a Protobuf runtime whose generated accessor style hides absence
   behind default views.** Familiar to JVM users, but absence still matters to
   validation and compatibility.

This draft uses `scope.id()` to avoid repeated optional command IDs and plain
struct fields elsewhere. A prototype should explicitly test message ergonomics
before freezing the handler interface.

### 9.6 Protobuf runtime choice

`prost` is the established Tokio/Tonic ecosystem choice and can generate from
a `FileDescriptorSet`. Google's official Rust Protobuf implementation also
exists and has different ownership/view and versioning characteristics.

The framework should hide runtime-specific descriptor operations behind its
own generated traits where practical, but generated message types inevitably
expose some runtime conventions.

The choice should be made through a spike that proves:

- custom Spine option decoding;
- exact type URLs;
- `Any` packing/unpacking;
- descriptor-driven dynamic queries;
- native gRPC and gRPC-Web/Connect compatibility;
- generated code size and build time;
- required-field ergonomics;
- cross-version support policy;
- compatibility with Cargo and IDE tooling.

### 9.7 Build reproducibility

Generation should:

- pin or verify the Protobuf compiler/tool version;
- use deterministic descriptor and source ordering;
- emit exact dependency fingerprints;
- tell Cargo `rerun-if-changed` for every relevant input;
- clean or atomically replace only its own `OUT_DIR` subtree;
- never rely on `OUT_DIR` initially being empty;
- avoid timestamps and absolute paths in generated source;
- provide a CI command that generates from a clean checkout;
- optionally emit a manifest of input hashes and generator versions.

### 9.8 Imported model crates

A real application will import messages generated by other Cargo packages.
Spine build tooling needs a supported linking model so one Protobuf definition
has one Rust type identity.

A model crate should export:

- its generated Rust modules;
- descriptor-set bytes or structured descriptors;
- its Spine type registry contribution;
- generation provenance/version metadata.

The consuming crate should link rather than regenerate those messages. This is
essential for shared contracts and prevents duplicate Rust types representing
the same Protobuf full name.

## 10. What the handler macro generates

### 10.1 The macro's responsibilities

For each annotated `impl`, the macro should:

1. Parse handler methods and role attributes.
2. Enforce structural syntax with source-located diagnostics.
3. Preserve the user's methods as ordinary Rust methods.
4. Generate one typed adapter per handler.
5. Generate compile-time trait constraints for signal, state, output, and
   rejection roles.
6. Generate static handler descriptors with full message identities.
7. Generate a handler-set implementation for bounded-context registration.
8. Generate route adapters for explicit route functions.
9. Avoid exposing generated names as application interface.

It should not:

- read arbitrary application files;
- invoke Cargo recursively;
- contact the network;
- discover other handler hosts;
- parse `.proto` files itself;
- perform storage or runtime registration during compilation;
- write generated files outside compiler output.

### 10.2 Conceptual expansion

Application code:

```rust
#[spine::handlers(state = Task)]
impl TaskAggregate {
    #[spine::assign]
    fn complete(
        &self,
        command: &CompleteTask,
        scope: &mut CommandScope<'_, Task>,
    ) -> Result<TaskCompleted, TaskAlreadyCompleted> {
        // ...
    }
}
```

Conceptually produces something like:

```rust
// The original method remains.
impl TaskAggregate {
    fn complete(/* original signature */) -> /* original return */ {
        // original body
    }
}

// Generated, private adapter. Exact names are implementation details.
struct __TaskAggregateComplete;

impl AssignAdapter for __TaskAggregateComplete {
    type Host = TaskAggregate;
    type State = Task;
    type Command = CompleteTask;
    type Outcome = Result<TaskCompleted, TaskAlreadyCompleted>;

    fn invoke(
        host: &TaskAggregate,
        command: &CompleteTask,
        scope: &mut CommandScope<'_, Task>,
    ) -> Self::Outcome {
        host.complete(command, scope)
    }
}

impl EntityHandlerSet for TaskAggregate {
    type State = Task;

    fn handlers(&self) -> &'static [ErasedHandlerDescriptor] {
        // A static descriptor containing a direct adapter function and
        // generated message metadata.
    }
}
```

Because `AssignAdapter` has appropriate trait bounds, compilation fails unless
the generated model types have the required roles.

### 10.3 Type erasure belongs behind the interface

The bus receives different Protobuf types, so some internal erasure is
unavoidable. It should occur after typed code generation, not in application
code.

An internal descriptor may contain:

```rust
struct ErasedHandlerDescriptor {
    role: HandlerRole,
    signal_type_url: &'static str,
    emitted_type_urls: &'static [&'static str],
    rejection_type_url: Option<&'static str>,
    invoke: ErasedInvokeFn,
    route: ErasedRouteFn,
}
```

The generated invocation adapter performs checked decoding/downcasting at the
registry seam, calls a typed method, converts its typed output into packed
signals, and returns a framework-owned outcome.

Application authors should never construct `ErasedHandlerDescriptor`.

### 10.4 Registry versioning

Even though the registry is compiled Rust rather than a generated JSON/TS
module, it should have an explicit logical version. This helps the framework:

- reject handler code generated by an incompatible macro/runtime combination;
- evolve descriptor fields deliberately;
- produce useful diagnostics for mixed crate versions;
- test imported application crates.

Version compatibility can be represented through a trait-associated constant
or sealed marker type so many mismatches become linker/compiler errors rather
than late runtime surprises.

### 10.5 Duplicate policy

Rust compilation cannot know every handler host that a bounded context will
combine dynamically. Duplicate command assignees therefore remain a context
assembly error.

The error should identify:

- bounded context name;
- command full name and type URL;
- both handler-host Rust type names;
- both method names and source locations when generated metadata can retain
  them;
- a stable error code.

Event subscribers and reactors preserve fan-out and should not be rejected
merely because multiple receivers consume the same event.

## 11. Entity state and transaction semantics

### 11.1 Scope is a transaction capability

`CommandScope<'a, S>` and `EventScope<'a, S>` are not arbitrary request-context
maps. They are typed, short-lived capabilities owned by the framework.

Candidate common operations:

```rust
scope.id()             // &S::Id
scope.state()          // &S
scope.is_new()         // bool
scope.version()        // EntityVersion
scope.update(|draft|)  // mutate &mut S
scope.replace(state)   // replace the draft
scope.archive()        // update lifecycle draft
scope.delete()         // update lifecycle draft
scope.context()        // command or event context view
```

Operations should be intentionally limited. The scope should not expose:

- raw repository handles;
- a storage connection;
- manual commit or rollback;
- command/event bus internals;
- another entity's mutable state;
- arbitrary asynchronous task spawning;
- a way to keep a draft reference after handler return.

### 11.2 Framework-owned commit

The application handler does not call `commit()`.

For an accepted command, the framework performs:

1. Validate the incoming command.
2. Resolve tenant, entity type, and entity ID.
3. Load the latest state and lifecycle/version metadata.
4. Open a private draft transaction.
5. Invoke the synchronous typed handler.
6. If it returns a rejection, discard the draft.
7. Validate the proposed state transition, including `(set_once)`.
8. Validate emitted messages.
9. Atomically persist the required state/event/outbox facts according to the
   storage contract.
10. Publish or enqueue emitted events only after the commit boundary succeeds.

Manual transaction control would let application code report an event before
state succeeds, commit a rejection, or leave a transaction open. It should not
be public.

### 11.3 State reads and updates

`state()` returns an immutable reference to the current draft view:

```rust
if scope.state().completed {
    // ...
}
```

`update()` lends a mutable draft only for the closure call:

```rust
scope.update(|task| {
    task.title.clone_from(&command.title);
    task.completed = false;
});
```

Rust prevents this from compiling if the handler tries to retain `task` after
the closure or use a stale immutable reference while mutating.

### 11.4 Replacement versus mutation

Both operations are useful:

- `replace(S)` is clear for creation or complete recomputation.
- `update(|&mut S| ...)` is clear for a local state change.

Both affect only the framework-owned draft. Neither performs storage I/O
immediately.

### 11.5 Rejection rollback

This must be guaranteed even when the handler mutated first:

```rust
scope.update(|task| task.completed = true);

if policy_rejects {
    return Err(CannotComplete { /* ... */ });
}
```

The transaction discards the draft on `Err`. Documentation should still advise
checking rejection conditions before mutation when practical, because it is
clearer and avoids wasted work.

### 11.6 Panic behavior

A Rust panic represents a defect, not a modeled rejection. The server should
define whether it catches unwinding panics at the synchronous adapter seam.

A robust native server can catch an unwind when the binary uses unwind panic
semantics, roll back the draft, emit a sanitized internal failure, record
telemetry, and keep unrelated work alive. It cannot promise recovery if built
with `panic = "abort"`.

No panic payload or backtrace should cross the public client boundary by
default.

### 11.7 Optimistic concurrency and multiple nodes

An in-process mutex prevents concurrent writes only within one server process.
A durable multi-node implementation also needs storage-level version
preconditions or transactions.

The commit should include an expected previous version. A conflict can:

- reload and retry the complete synchronous transaction when the command and
  handler contract are retry-safe; or
- fail with a retryable framework outcome.

Automatic retries need a bounded policy, stable command identity, and proof
that no application side effect ran inside the handler. The synchronous,
state-only handler rule makes such retries considerably safer.

### 11.8 Current-state versus event-sourced storage

This draft assumes:

- current entity state is stored directly;
- event records provide domain history/traceability and downstream dispatch;
- loading an Aggregate does not replay its entire event history;
- recent history can be exposed as a bounded separate capability;
- emitted events and latest state must obey one documented commit/order
  contract.

An event-sourced reconstruction mode would change storage, handler, snapshot,
and migration semantics and should be designed separately.

## 12. Aggregates, Projections, and Process Managers

### 12.1 Entity family comes from the state descriptor

The Protobuf state declares:

```proto
option (entity).kind = AGGREGATE;
```

or `PROJECTION` / `PROCESS_MANAGER`.

The Rust handler macro should not duplicate this with
`#[spine::aggregate]`, `#[spine::projection]`, and
`#[spine::process_manager]` unless separate macros materially improve the
interface. `#[spine::handlers(state = Task)]` lets generated `Task` metadata
remain authoritative.

### 12.2 Aggregate

An Aggregate:

- receives assigned commands;
- protects consistency for one ID;
- updates its transactional state;
- emits domain events or typed rejections;
- may react/subscribe only as allowed by accepted Spine semantics;
- is not directly queried when the model calls for Projection read models.

The handler host normally has no mutable fields. One shared host can execute
many entity IDs concurrently because each invocation receives its own scope.

### 12.3 Projection

A Projection:

- consumes events/rejections;
- maintains query-visible state;
- exposes only fields declared as query columns plus framework system columns;
- may have multiple rows keyed by modeled IDs;
- is updated asynchronously relative to originating command completion unless
  the runtime explicitly guarantees otherwise.

Generated column constants can support a typed query DSL:

```rust
let open_tasks = client
    .query::<TaskView>()
    .where_(task_view::COMPLETED.eq(false))
    .order_by(task_view::TITLE.asc())
    .limit(50)
    .all()
    .await?;
```

`task_view::COMPLETED` and `task_view::TITLE` are generated only for fields
marked `(column)`. A query cannot spell an arbitrary field string.

### 12.4 Process Manager

A Process Manager coordinates a workflow over time. It may accept commands,
consume events, emit commands, emit events, and keep its own state.

Example:

```rust
#[derive(Default)]
struct OrderProcessManager;

#[spine::handlers(state = OrderProcess)]
impl OrderProcessManager {
    #[spine::assign]
    fn begin(
        &self,
        command: &BeginOrder,
        scope: &mut CommandScope<'_, OrderProcess>,
    ) -> OrderStarted {
        scope.replace(OrderProcess {
            id: Some(scope.id().clone()),
            paid: false,
            reserved: false,
            finished: false,
        });
        OrderStarted { order: Some(scope.id().clone()) }
    }

    #[spine::command]
    fn on_payment_captured(
        &self,
        event: &PaymentCaptured,
        scope: &mut EventScope<'_, OrderProcess>,
    ) -> ReserveStock {
        scope.update(|process| process.paid = true);
        ReserveStock {
            order: Some(scope.id().clone()),
            items: event.items.clone(),
        }
    }

    #[spine::react]
    fn on_stock_reserved(
        &self,
        _event: &StockReserved,
        scope: &mut EventScope<'_, OrderProcess>,
    ) -> Option<OrderReady> {
        scope.update(|process| process.reserved = true);
        let state = scope.state();
        (state.paid && state.reserved).then(|| OrderReady {
            order: Some(scope.id().clone()),
        })
    }
}
```

This is only domain syntax. Production Process Manager execution also requires
durable inbox rows, deduplication by original signal identity, retry policy,
and correct ordering. Those belong behind the handler interface.

### 12.5 Entity creation policy

The framework must define which signals may create a missing entity:

- an Aggregate assignee for a creation command generally can;
- a Projection subscriber often creates the row on its first event;
- a Process Manager may be created by a command or initiating event;
- other handlers may require existing state.

Possible explicit markers:

```rust
#[spine::assign(creates)]
fn create_task(/* ... */) -> TaskCreated

#[spine::subscribe(creates)]
fn on_task_created(/* ... */)
```

However, this should be added only if compatible Spine semantics cannot derive
the behavior. An annotation that merely repeats a naming convention adds
surface without leverage.

### 12.6 Lifecycle

If archive/delete are supported, scopes can expose intent methods:

```rust
scope.archive();
scope.delete();
scope.require_active()?;
```

These update transaction lifecycle metadata and are committed with state. They
must not immediately remove a storage row or bypass emitted lifecycle events.
The precise behavior should match the chosen baseline.

## 13. Bounded-context assembly

### 13.1 Proposed builder

```rust
let context = BoundedContext::single_tenant("Tasks")
    .model(crate::model::registry())
    .storage(storage)
    .add(TaskAggregate)
    .add(TaskViewProjection)
    .build()
    .await?;
```

Multitenant form:

```rust
let context = BoundedContext::multitenant("Tasks")
    .model(crate::model::registry())
    .storage(storage)
    .add(TaskAggregate)
    .add(TaskViewProjection)
    .build()
    .await?;
```

Tenant resolution comes from trusted server-edge context, never from an
untrusted payload field chosen by a handler.

### 13.2 What `add` accepts

`add` should accept a configured handler-host value whose macro-generated
implementation describes one state and its handlers:

```rust
.add(TaskAggregate)
.add(OrderAggregate::new(pricing))
```

The builder stores it behind an internal shared pointer only after confirming
the required `Send + Sync + 'static` constraints.

No application-authored repository is necessary for ordinary cases. Generated
state metadata and the selected storage factory are enough for the context to
construct the repository implementation.

An explicit repository seam should exist only for genuinely different
repository behavior, not as mandatory boilerplate around every Aggregate.

### 13.3 Build-time validation

`build().await` can validate facts that depend on the complete context:

- context name and tenant mode;
- one assignee per command type;
- handler/state entity-kind compatibility;
- model registry completeness and duplicate full names;
- type URL uniqueness;
- all emitted signal types are registered;
- every handler has a route;
- route ID type matches entity ID type;
- queryable state columns are supported by the storage adapter;
- durable features are not configured on an incapable in-memory adapter;
- delivery/inbox requirements are present;
- external event registrations are coherent;
- imported registry versions are compatible.

Opening storage may require async I/O, which is why build is asynchronous.

### 13.4 Context as an owned resource

`BoundedContext` should own or lease its repositories, buses, delivery workers,
and storage handles. Closing it should:

1. stop new intake;
2. drain or stop owned queues according to documented policy;
3. stop delivery workers;
4. close repository/storage handles it owns;
5. be idempotent or explicitly retryable after partial close failure.

The context must not silently close process-wide resources supplied as shared
dependencies unless ownership was transferred explicitly.

### 13.5 Static alternative

For embedded/no-dynamic-configuration deployments, a macro could assemble a
static context:

```rust
spine::bounded_context! {
    pub Tasks {
        tenant: single,
        handlers: [TaskAggregate, TaskViewProjection],
    }
}
```

This might catch duplicates at compile time, but it introduces a mini-language
and handles dependency injection poorly. The ordinary typed builder is a
better initial interface. Static assembly can be explored later for embedded
or highly optimized deployments.

## 14. Server and transport interface

### 14.1 Native server first

The server executable is a native Rust program. Tokio is the likely async
runtime; Tonic or a compatible lower-level stack can serve native gRPC.

The framework should expose the existing Spine command/query/subscription
services rather than requiring every application to implement transport
methods.

```rust
Server::builder()
    .listen(([0, 0, 0, 0], 8080))
    .add(tasks_context)
    .add(projects_context)
    .run()
    .await
```

The application supplies contexts and edge policy. The framework owns service
adaptation, request decoding, response encoding, readiness, and shutdown.

### 14.2 `run` versus `start`

Two lifecycle modes are useful and should have distinct names:

- `run().await` is for a standalone process. It installs framework-owned
  termination-signal handling and returns after shutdown.
- `start().await` is for an embedded server. It returns a `RunningServer` handle
  and leaves process lifecycle to the caller.

```rust
let running = Server::builder()
    .listen(([127, 0, 0, 1], 0))
    .add(tasks)
    .start()
    .await?;

println!("listening at {}", running.local_addr());

// Later:
running.close().await?;
```

Port `0` requests an ephemeral port, useful in tests.

### 14.3 Browser compatibility

A Rust server should eventually support the same universal browser access as
Spine TS:

- gRPC-Web as the broad interoperability baseline;
- Connect where compatible and useful;
- exact CORS origin policy;
- bounded request/response bodies;
- authenticated session resolution;
- authorization before forwarding application calls;
- trusted reconstruction of actor and tenant context;
- bounded subscriptions with explicit cancellation and shutdown behavior.

Proposed configuration shape:

```rust
let browser = BrowserGateway::builder()
    .allow_origin("https://tasks.example.com".parse()?)
    .sessions(session_resolver)
    .authorize(access_policy)
    .contexts(context_resolver)
    .model(crate::model::registry())
    .build()?;

Server::builder()
    .listen(([0, 0, 0, 0], 8080))
    .browser(browser)
    .add(tasks)
    .run()
    .await
```

The bounded context must not read cookies, OAuth tokens, CORS headers, or TLS
certificates. Those belong at the server/gateway seam.

### 14.4 Authentication and authorization

The framework can define small traits:

```rust
trait SessionResolver: Send + Sync {
    async fn resolve(&self, request: &HttpRequestParts)
        -> Result<Option<Principal>, SessionError>;
}

trait AuthorizationPolicy: Send + Sync {
    async fn authorize(
        &self,
        principal: &Principal,
        operation: &Operation,
    ) -> Result<Authorization, AuthorizationError>;
}
```

Exact Rust syntax for async traits depends on the supported Rust version and
object-safety design. These are edge adapters, so async is appropriate.

Trusted context resolution produces framework-owned actor/tenant metadata. It
must not forward an untrusted client's self-declared actor or tenant unchanged.

### 14.5 Service composition

The normal application should not individually register generated RPC servers:

```rust
// Avoid requiring this in every application.
router.add_service(CommandServiceServer::new(/* ... */));
router.add_service(QueryServiceServer::new(/* ... */));
router.add_service(SubscriptionServiceServer::new(/* ... */));
```

`Server::add(context)` should compose the correct Spine services once. An
advanced embedding interface may expose a Tower-compatible adapter for an
application that must share a listener with other routes.

### 14.6 Readiness and health

Readiness should become true only after:

- every context builds successfully;
- storage adapters are usable according to configured policy;
- transport listeners bind;
- required delivery workers start;
- no required registry or route is missing.

Liveness should not fail merely because an optional downstream storage call
briefly failed. The exact readiness/liveness distinction must be documented and
observable through standard health endpoints.

### 14.7 Shutdown

A safe shutdown sequence is roughly:

1. Mark server draining and fail readiness.
2. Stop accepting new connections/requests.
3. Cancel or finish active streams according to protocol policy.
4. Stop context intake.
5. Drain bounded server-owned work until a deadline.
6. Stop delivery workers and release leases.
7. Close contexts and owned storage.
8. Close the listener and telemetry exporters.

Every step needs a bounded timeout and an observable result. Dropping a Tokio
task is not a sufficient shutdown contract for persisted delivery work.

## 15. Storage interface

### 15.1 What application code should see

For ordinary use, application code selects an adapter:

```rust
let context = BoundedContext::single_tenant("Tasks")
    .storage(InMemory::new())
    .add(TaskAggregate)
    .build()
    .await?;
```

or:

```rust
let storage = PostgresStorage::connect(database_url).await?;

let context = BoundedContext::single_tenant("Tasks")
    .storage(storage)
    .add(TaskAggregate)
    .build()
    .await?;
```

Handlers remain storage-neutral.

### 15.2 Storage capabilities

Not every adapter supports every guarantee. The framework should model
capabilities explicitly rather than discover missing operations in production.

Possible capabilities include:

- atomic compare-and-set of current state;
- transactionally append event records with state;
- transactional outbox/inbox writes;
- query by generated columns;
- ordered pagination;
- tenant partitioning;
- lease/fencing operations;
- batch operations;
- consistent versus eventually consistent reads.

Context build should reject a configuration whose required capabilities are
absent.

### 15.3 Public trait versus internal traits

It may be tempting to expose one huge `StorageFactory` trait containing every
record, event, inbox, query, and maintenance operation. That would be difficult
to implement correctly and would freeze implementation details.

A better design may have:

- one small public adapter-construction interface;
- several sealed or package-internal capability traits;
- a conformance kit for third-party adapters;
- an explicitly versioned extension interface when external adapter authors
  genuinely exist.

The first two adapters prove which seams are real. An interface with only one
implementation is still hypothetical.

### 15.4 Proposed commit unit

The most important persistence decision is the atomic unit for an accepted
handler outcome.

An ideal durable commit records, as one transaction where the provider permits:

- expected prior entity version;
- new current state and lifecycle/version metadata;
- emitted event envelope(s);
- traceability/origin data;
- outbox/inbox work needed for later dispatch;
- deduplication identity.

If the selected provider cannot make all of those atomic, the framework must
document the failure windows and recovery protocol. It should not report a
command accepted while silently losing the only durable evidence needed to
publish its event.

### 15.5 In-memory adapter

The in-memory adapter is for:

- unit/integration development;
- BlackBox tests;
- examples;
- behavioral reference tests.

It should implement the same logical semantics, including version conflicts
and deduplication, even if its implementation uses locks and maps. It should
not accidentally make tests pass by offering stronger synchronous visibility
than the documented distributed contract.

### 15.6 SQL adapter

A SQL implementation likely uses an async Rust toolkit and provider
transactions. It needs schema and migration ownership for:

- entity current records;
- query columns;
- event journal;
- outbox/inbox rows;
- subscriptions/delivery coordination;
- lease/fencing state;
- deduplication keys.

Generated query columns need a stable mapping from Protobuf scalar/value types
to database columns, including null/presence, collation, ordering, and schema
migration behavior.

### 15.7 Adapter conformance

Every storage adapter should run the same behavioral suite:

- create/read/update current state;
- compare-and-set conflict;
- `(set_once)` transition interaction;
- atomic accepted outcome;
- rejected draft persists nothing;
- query filters/order/limit;
- tenant isolation;
- duplicate event/inbox identity;
- lease expiration and fencing;
- shutdown and resource ownership;
- provider-specific failure injection.

## 16. Commands, events, queries, and subscriptions

### 16.1 Command intake

The command service should:

1. Authenticate/resolve trusted actor and tenant at the edge.
2. Decode the command envelope and packed domain command.
3. Look up the exact type URL in the model registry.
4. Validate the message before application code runs.
5. Select exactly one registered assignee.
6. Derive/validate the entity route.
7. Enqueue or execute through the repository runtime according to the accepted
   command service contract.
8. Sanitize framework failures returned to the client.

Unknown type URLs, malformed `Any`, invalid commands, missing routes, duplicate
assignees, and inactive runtime are different error categories and should have
stable diagnostics.

### 16.2 Command bus

Internally, the command bus routes by full type identity, not Rust `TypeId`
alone. `TypeId` is process-local and does not define a network contract.

The bus must provide bounded admission and explicit saturation behavior. An
unbounded Tokio channel would convert traffic spikes into memory growth.

### 16.3 Event publication

Accepted emitted events are wrapped with:

- generated event ID;
- event type URL and packed payload;
- timestamp;
- producer entity identity;
- originating command/event chain;
- actor and tenant context;
- rejection context when applicable.

Publication order must be explicit. A strong target is:

- current state and durable event/outbox facts commit first;
- event delivery begins only after commit;
- delivery may be at least once;
- consumers deduplicate using stable signal identity;
- one receiver failure does not erase the stored event;
- dispatch failure is observable and retryable according to policy.

### 16.4 Event bus fan-out

The event bus can have multiple matching subscribers/reactors. Registration
order should not accidentally become a cross-entity business ordering
guarantee unless documented.

For one entity/inbox route, delivery ordering and retry rules need explicit
semantics. Across independent routes, parallel execution is desirable.

### 16.5 Query interface

The server query protocol must remain compatible. Rust-native clients and tests
can additionally receive generated typed query helpers.

Candidate DSL:

```rust
let tasks = client
    .query::<TaskView>()
    .where_(task_view::COMPLETED.eq(false))
    .where_(task_view::TITLE.starts_with("Rust"))
    .order_by(task_view::TITLE.asc())
    .limit(100)
    .all()
    .await?;
```

The generator creates operators appropriate to the field type. A Boolean
column should not expose string comparison. The server still validates every
wire query because non-Rust clients can construct requests directly.

Query state is authoritative. Subscription notifications are not a replacement
for re-querying current state after reconnect.

### 16.6 Dynamic type decoding

Query responses and event subscriptions may contain `Any`. The generated model
registry should support:

```rust
registry.decode(type_url, bytes)
registry.pack(&message)
registry.descriptor(type_url)
```

Typed client helpers know the expected response type and verify it. Unknown
types stay an explicit error or opaque message according to the interface; they
must not be silently decoded as the wrong Rust struct.

### 16.7 Subscriptions

Proposed Rust client shape:

```rust
let mut updates = client
    .subscribe::<TaskView>()
    .where_(task_view::COMPLETED.eq(false))
    .start()
    .await?;

while let Some(update) = updates.next().await {
    match update? {
        SubscriptionUpdate::Entity(task) => { /* ... */ }
        SubscriptionUpdate::Removed(id) => { /* ... */ }
        SubscriptionUpdate::Reconnected => {
            // Re-query current state.
        }
    }
}
```

The exact public update variants must follow the existing wire model. The
important operational contract is:

- bounded per-subscription buffering;
- explicit overflow behavior;
- cancellation;
- no claim of complete event history;
- reconnect/re-subscribe followed by authoritative query;
- tenant and authorization checks for every target.

### 16.8 Horizontal delivery

When several application nodes serve the same context, an update produced on
node A may need to reach a subscription attached to node B. This requires a
durable or best-effort propagation mechanism separate from a process-local
broadcast channel.

The Rust implementation must adopt the same documented guarantee as the chosen
Spine baseline. It must not imply cluster-complete delivery if it implements
only local fan-out.

## 17. Rejections and failures

### 17.1 Three categories

The framework must distinguish:

1. **Domain rejection:** expected business refusal modeled as a Protobuf
   rejection; authored by application code.
2. **Validation failure:** command/model violates generated input constraints
   before the handler accepts it.
3. **Framework/infrastructure failure:** storage, queue, transport, corruption,
   unavailable runtime, panic, or internal invariant failure.

Conflating these categories makes clients retry permanent business refusal or
exposes internal failures as domain facts.

### 17.2 Domain rejection syntax

Recommended:

```rust
fn complete(/* ... */) -> Result<TaskCompleted, TaskAlreadyCompleted> {
    if scope.state().completed {
        Err(TaskAlreadyCompleted {
            id: Some(scope.id().clone()),
        })
    } else {
        // ...
        Ok(TaskCompleted {
            id: Some(scope.id().clone()),
        })
    }
}
```

The generated rejection type implements `RejectionMessage`. It may also
implement `Display` and `std::error::Error` for integration with Rust tooling,
but the serialized message remains the domain payload.

### 17.3 Multiple rejection types

Rust `Result` has one error type. When a handler can produce several modeled
rejections, generation can provide or application code can declare an enum:

```rust
#[derive(spine::RejectionSet)]
enum RenameTaskRejection {
    Unchanged(TaskTitleUnchanged),
    Forbidden(TaskRenameForbidden),
}
```

Handler:

```rust
fn rename(/* ... */) -> Result<TaskRenamed, RenameTaskRejection>
```

The derive generates conversion into the contained Protobuf rejection and a
static list of permitted rejection type URLs. `?` can work through generated
`From` implementations:

```rust
self.policy.check(/* ... */)?;
```

An alternative is a generated `OneOfRejections!(A, B)` wrapper. A named enum
usually gives clearer Rust diagnostics and a stable domain term.

### 17.4 Rejection event creation

Application code returns only the rejection message. The framework creates the
standard rejection event/envelope after rollback, attaching:

- the original rejected command;
- command ID and context;
- rejection message/type URL;
- timestamp and origin;
- safe throwable/error text if required by compatibility.

Application code should not pack `Any`, construct a rejection `Event`, or post
it manually.

### 17.5 Client redaction

Internal rejection subscribers may require rejected command and diagnostic
context. A client-facing subscription should apply the same redaction policy as
Spine TS/JVM compatibility requires, especially for command payloads, tokens,
and stacks.

### 17.6 Validation failures

The runtime validates commands before routing and handler invocation. State and
emitted messages are validated before commit/publication.

Validation should return structured violations with:

- message full name;
- field path;
- stable constraint/error code;
- safe localized/default message where supported;
- no raw secret values by default.

Validation failure does not invoke a domain handler and does not become an
application-authored rejection unless the shared Spine contract explicitly
defines such mapping.

### 17.7 Infrastructure failures

Server logs/traces should retain a causally linked internal error. Client
responses should expose stable public categories without filesystem paths,
database statements, credentials, or backtraces.

Retryability must be explicit. Examples:

- optimistic write conflict: possibly retryable;
- queue saturated: retryable after backoff or explicit resource exhaustion;
- unknown command type: permanent for this server version;
- invalid command: permanent until the client changes it;
- storage unavailable: retryable;
- corrupt stored record: not automatically retryable without intervention.

## 18. Testing experience

### 18.1 BlackBox is the primary application test interface

A framework user should test a bounded context as a client sees it:

```rust
let box_ = BlackBox::from(context).await?;
let user = box_.on_behalf_of("alice");

user.post(command).await?;
let rows = user.query::<TaskView>().all().await?;
```

BlackBox owns an ephemeral local server/client pair and closes it predictably.

### 18.2 Scope identities

Useful test scopes:

```rust
let guest = box_.as_guest();
let alice = box_.on_behalf_of("alice");
let acme_alice = box_.in_tenant("acme").on_behalf_of("alice");
```

Test identity remains explicit. The test should not mutate trusted command
context internals directly unless it is testing a lower-level extension seam.

### 18.3 Immediate versus eventual assertions

Command acceptance can be asserted immediately. A Projection update or
subscription observation may be asynchronous and should use bounded waiting:

```rust
let view = box_
    .eventually(|| async {
        user.query::<TaskView>().by_id(id.clone()).one().await
    })
    .within(std::time::Duration::from_secs(1))
    .await?;
```

There must be a timeout. An unbounded polling helper can hang CI forever.

### 18.4 Typed event/rejection observation

Candidate interface:

```rust
let completion = user
    .post(CompleteTask { id: Some(id.clone()) })
    .observe::<TaskCompleted>()
    .await?;

let rejected = user
    .post(CompleteTask { id: Some(id.clone()) })
    .observe_rejection::<TaskAlreadyCompleted>()
    .await?;
```

This must be reconciled with the actual command result/subscription protocol.
The test facade may coordinate public operations, but it must not claim an
observation the real protocol cannot provide.

### 18.5 Compile-fail tests for macros

Framework development should include compile-fail fixtures proving diagnostics
for:

- event used as assigned command;
- command returned from assignee;
- missing event output;
- wrong state in scope;
- async handler;
- mutable `&mut self` receiver;
- unregistered/ambiguous route;
- rejection from a non-rejection file/type;
- duplicate role marker;
- invalid method visibility or generics.

These tests should assert relevant diagnostic text without overfitting to every
compiler formatting detail.

### 18.6 Cross-language compatibility tests

At minimum:

- Rust server + existing TypeScript client;
- Rust server + compatible JVM client;
- TS/JVM server + future Rust client where applicable;
- golden `Any` type URLs and bytes;
- command context and event origin chains;
- validation and rejection payloads;
- query/filter/order semantics;
- subscription framing and cancellation;
- unknown type/error behavior.

### 18.7 Real-adapter tests

In-memory BlackBox tests do not prove SQL transactions, cloud consistency,
network partition behavior, or multi-node delivery. Each production adapter
needs opt-in disposable-provider tests with finite resources and cleanup.

## 19. Concurrency, performance, and reliability

### 19.1 Expected execution architecture

A possible command path is:

```text
network request
    -> bounded command intake
    -> generated type/validation lookup
    -> route to repository + entity ID
    -> await current-state load / acquire local turn
    -> invoke synchronous typed handler
    -> validate outcome
    -> await atomic durable commit
    -> acknowledge according to command protocol
    -> enqueue/publish durable event work
    -> parallel routed event deliveries
```

The architecture should avoid one global mutex or one single-thread actor for
the whole bounded context. Independent entity IDs should execute concurrently.

### 19.2 Local serialization

Within one process, concurrent commands for the same entity ID must not both
mutate the same old version and report success.

Possible implementation:

- a sharded map of per-entity async mutexes;
- acquire only for the load/handle/commit logical transaction;
- do not hold a synchronous mutex guard across `.await`;
- reclaim idle lock entries so unbounded IDs do not create an unbounded lock
  table;
- combine with storage version preconditions for multi-node correctness.

The exact locking strategy is implementation. The public guarantee is the
entity consistency rule and conflict behavior.

### 19.3 No async handler is a performance feature

Disallowing `async fn` handlers is not merely aesthetic. It prevents:

- a slow remote call from monopolizing an entity turn;
- a borrowed state draft from crossing arbitrary suspension points;
- non-repeatable side effects inside an automatically retried transaction;
- complicated `Send`/lifetime failures in user code;
- hidden latency inside what should be a fast state transition.

The runtime still uses async for storage and transport. Domain computation can
be CPU-bound, but a handler that performs long CPU work may need an explicit
bounded compute adapter rather than blocking a Tokio worker indefinitely.

### 19.4 Backpressure

Every queue needs a finite capacity and an explicit saturation result:

- command intake;
- event dispatch;
- per-entity pending work;
- subscription updates;
- durable delivery claims;
- authentication callbacks;
- telemetry export where loss policy matters.

Configuration should have safe defaults. Increasing a capacity changes memory
and latency behavior and should be observable.

### 19.5 Cancellation

Network request cancellation must not ambiguously cancel already committed
domain work.

The framework should distinguish:

- cancellation before command acceptance/admission;
- cancellation while queued but not started;
- client disconnect while an accepted transaction executes;
- cancellation after commit while response delivery is pending;
- subscription cancellation.

Once durable commit occurs, dropping the HTTP/gRPC future cannot undo the
domain fact. Idempotent command identity lets a client safely discover/retry an
unknown response outcome.

### 19.6 At-least-once delivery and idempotency

Durable event/process-manager delivery should assume that work can be retried.
The framework therefore needs:

- stable event/command IDs;
- an inbox row keyed by receiver and signal identity;
- atomic claim/lease state;
- final fencing so an expired worker cannot finalize newer work;
- bounded attempts and quarantine/dead-letter policy;
- idempotent state transition checks;
- observable stuck/retry/quarantine counts.

Rust's memory safety prevents data races in process, but it does not solve
distributed duplicate delivery. Those semantics must be designed explicitly.

### 19.7 Event ordering

“Events are ordered” is too vague. The design must separately address:

- emission order of multiple events from one accepted handler;
- delivery order to one entity inbox;
- order across different entity IDs;
- order across nodes;
- order after retry;
- Projection observation order;
- subscription notification order.

The implementation should guarantee only what it can preserve durably.

### 19.8 Expected performance relative to Spine TS

The Rust server is likely to improve:

- resident memory per server and per active entity/subscription;
- allocation rate;
- tail-latency predictability by avoiding garbage-collection pauses;
- CPU efficiency in serialization, routing, and dispatch;
- multi-core use inside one process;
- startup/runtime footprint for native deployments.

It may not significantly improve end-to-end latency when the critical path is
dominated by database transactions, network round trips, or delivery policy.
Rust can also lose its advantage through excessive cloning, boxed dynamic
dispatch, lock contention, descriptor parsing on every request, or an
overcomplicated abstraction layer.

No performance claim should be accepted without equivalent-semantics
benchmarks.

### 19.9 Benchmark plan

Compare Rust and TS using the same `.proto` model and externally visible
guarantees:

- in-memory command throughput;
- durable SQL command throughput;
- p50/p95/p99 command latency;
- same-ID contention versus independent IDs;
- event fan-out to 1, 10, and 100 receivers;
- subscription fan-out and slow consumers;
- memory per active subscription;
- memory per cached/active entity turn;
- cold start to readiness;
- graceful shutdown under load;
- retry/deduplication overhead;
- Protobuf pack/unpack and dynamic registry lookup;
- CPU and allocation profiles.

Tests must use equal durability and acknowledgment points. A Rust command that
acknowledges before durable event storage cannot be compared to a TS command
that acknowledges afterward.

### 19.10 Observability

Use structured tracing with stable fields:

- bounded context;
- tenant pseudonymous/stable identifier where policy allows;
- command/event type URL;
- command/event ID;
- entity type and safely formatted ID/fingerprint;
- handler role and generated handler name;
- queue wait, load, handler, validation, commit, and dispatch durations;
- attempt/lease/fencing outcome;
- public error code and internal causal chain.

Do not log packed payloads, session tokens, rejected commands, or arbitrary
state by default.

## 20. Crate and module layout

### 20.1 User-facing facade

A `spine` facade crate can re-export the stable application interface:

```rust
use spine::prelude::*;
```

Candidate facade exports:

- handler macros;
- generated model traits needed in bounds;
- `CommandScope` and `EventScope`;
- `BoundedContext` and builder;
- `Server` and `RunningServer`;
- core query/subscription client types used by tests/native clients;
- in-memory storage;
- `BlackBox` behind an optional feature.

The prelude should be curated, not a wildcard re-export of every internal type.

### 20.2 Internal workspace packages

One implementation workspace might contain:

```text
spine-rust/
├── crates/
│   ├── spine/                 # Stable facade
│   ├── spine-core/            # Message identity, registry, metadata
│   ├── spine-macros/          # proc-macro package
│   ├── spine-build/           # Cargo/Protobuf generation
│   ├── spine-server/          # Contexts, entities, buses, services
│   ├── spine-storage/         # Internal/public storage seams + memory
│   ├── spine-storage-sql/     # SQL adapter
│   ├── spine-delivery/        # Inbox, leases, retry, worker runtime
│   ├── spine-transport/       # Transport-neutral signal routing
│   ├── spine-grpc/            # gRPC/Connect/gRPC-Web adapters
│   ├── spine-auth/            # Gateway extension contracts
│   ├── spine-client/          # Optional native client
│   └── spine-testing/         # BlackBox and conformance kits
├── proto/
├── examples/
└── compatibility-tests/
```

This is an implementation decomposition, not a recommendation that application
authors depend on twelve crates. Most internals should sit behind the facade.

### 20.3 Proc-macro separation

Rust requires procedural macros to live in a `proc-macro` crate. `spine-macros`
therefore exists even if users import macros through `spine`:

```rust
#[spine::handlers(state = Task)]
```

The macro crate should share a small versioned contract with runtime crates. It
must not depend on the complete server implementation, which would increase
compile time and create dependency cycles.

### 20.4 Build dependency separation

`spine-build` runs on the build host, even when the application targets another
architecture. It should depend on descriptor/code-generation libraries, not on
Tokio server runtime or production storage.

Cross-compilation tests must verify that build-time host code does not confuse
host and target configuration.

### 20.5 Feature flags

Feature flags can keep dependencies bounded:

```toml
spine = { version = "0.1", features = ["server", "grpc-web"] }
```

Potential features:

- `server`;
- `client`;
- `testing`;
- `grpc-web` / `connect`;
- telemetry integrations.

Database providers should generally remain separate adapter crates rather than
features that pull every driver into the facade.

Feature combinations require CI coverage. An optional feature that compiles
only in the all-features build is not sufficient.

### 20.6 Model package separation

For a multi-application system:

```text
workspace/
├── tasks-model/       # Protobuf + generated Rust model
├── tasks-server/      # Handler hosts and context
├── tasks-cli/         # Rust native client
└── tasks-web/         # May remain TypeScript
```

`tasks-model` exposes no server internals. This mirrors the fact that commands,
events, IDs, and query types belong to the shared protocol/domain model.

## 21. Diagnostics and developer tooling

### 21.1 Errors should point to authored code

If a handler has the wrong return role, the useful diagnostic is:

```text
error: #[spine::assign] handler `create_task` must emit EventMessage types
  --> src/domain/task_aggregate.rs:24:10
   |
24 |     ) -> ScheduleTask {
   |          ^^^^^^^^^^^ `ScheduleTask` is a CommandMessage
```

It is not useful to show a 40-line generic trait error in a hidden generated
module. The macro should attach spans and, where possible, emit focused
pre-checks. A lower-level compiler cause may follow.

### 21.2 Protobuf diagnostics

Model errors should report:

- source `.proto` path, line, and column;
- full message/field name;
- option name;
- stable diagnostic code;
- corrective suggestion when unambiguous.

Example:

```text
SPINE-RS-MODEL-014: `(column)` is not supported on repeated field
`example.tasks.TaskView.labels`
  proto/example/tasks/task_views.proto:22:3
```

### 21.3 `cargo spine`

A companion Cargo subcommand could provide:

```text
cargo spine check
cargo spine generate --inspect target/spine-generated
cargo spine descriptors
cargo spine routes
cargo spine doctor
```

- `check` validates model/generation without a full server run.
- `generate --inspect` writes formatted disposable generated output for humans.
- `descriptors` lists full names, type URLs, entity kinds, and columns.
- `routes` prints generated routing/handler plans for a selected binary or
  manifest when technically feasible.
- `doctor` checks compiler, `protoc`, versions, and environment.

The build itself must not depend on a globally installed Cargo subcommand.

### 21.4 IDE behavior

The chosen generation pattern must work with rust-analyzer:

- generated modules resolve without running the server;
- macro expansion is inspectable;
- errors link back to authored methods;
- generated documentation is available;
- changing `.proto` causes predictable regeneration/reanalysis;
- code completion sees message fields, scope methods, and generated columns.

IDE behavior should be part of the vertical spike, not deferred until after the
macro interface is frozen.

### 21.5 Generated-code inspection

Users sometimes need to understand a trait error or type URL. Provide an
explicit inspection command and stable headers in generated files:

```rust
// @generated by spine-build 0.1.x
// Source descriptor fingerprint: ...
// Do not edit.
```

Normal output remains under `OUT_DIR`; the inspection copy is disposable.

### 21.6 Compile-time cost

Procedural macros and Protobuf generation can make Rust builds slow. Measure:

- clean model generation;
- clean full build;
- incremental handler-body edit;
- incremental `.proto` edit;
- rust-analyzer response;
- macro expansion time;
- generated code size and monomorphization.

Avoid generating a unique large generic dispatcher graph for every trivial
combination when a small erased internal adapter would preserve equivalent
runtime performance with much lower build cost.

## 22. Interoperability requirements

### 22.1 Type URLs are public contract

For every message, Rust must calculate exactly the same type URL as compatible
JVM/TS implementations. Do not derive it from Rust module paths.

Golden tests should cover:

```text
type.example.tasks/example.tasks.CreateTask
```

or the exact Spine format established by the descriptor/options. Prefix,
slash, package, nesting, and case all matter.

### 22.2 `Any` packing

Cross-language tests should pack in one language and unpack in another. They
must cover:

- nested messages;
- unknown fields;
- default values and presence;
- enums including unknown numeric values;
- maps/repeated fields;
- rejection payloads;
- query results;
- descriptor imports.

### 22.3 Service protocol

Rust must use the existing Protobuf service definitions and compatible status
mapping. Adding a more ergonomic Rust client method does not permit changing
the server wire RPC.

Streaming tests must cover headers, trailers, cancellation, half-close where
applicable, gRPC-Web framing, and browser constraints.

### 22.4 Metadata and causality

Exact compatibility matters for:

- command/event IDs;
- timestamps and time zones where modeled;
- actor and tenant context;
- source command/source event chains;
- producer IDs;
- entity versions;
- rejection context;
- redacted client update form.

Rust-native types such as `SystemTime` or UUID crates are adapters around the
wire model, not replacements for it.

### 22.5 Unknown fields and version evolution

The Protobuf runtime choice must preserve compatible unknown-field behavior
where the protocol relies on forward/backward evolution. Regeneration and
runtime version policies must be explicit, especially if generated Rust code
and its Protobuf runtime require exact version matching.

### 22.6 Cross-language deployment topology

Supported topologies could include:

- Rust server with TS browser client;
- Rust and JVM bounded contexts communicating through transport/delivery;
- Rust server behind the same Envoy/gRPC-Web setup as JVM/TS;
- Rust native CLI/mobile/desktop client;
- standalone Rust authentication gateway forwarding to a compatible backend;
- compatible TS/JVM gateway forwarding to Rust application services.

Each claimed topology needs an executable compatibility test, not only shared
`.proto` compilation.

### 22.7 Behavioral compatibility matrix

Maintain a versioned matrix:

| Capability                   | Rust ↔ TS | Rust ↔ JVM | Notes                            |
| ---------------------------- | --------- | ---------- | -------------------------------- |
| Protobuf binary and `Any`    | Required  | Required   | Golden bidirectional tests       |
| Command posting              | Required  | Required   | Status/error mapping included    |
| Query                        | Required  | Required   | Filters, masks, ordering, limits |
| Subscription                 | Required  | Required   | Framing, cancellation, reconnect |
| Typed rejection              | Required  | Required   | Context and redaction included   |
| Delivery/inbox               | Versioned | Versioned  | Exact topology/guarantee stated  |
| Browser Connect optimization | Optional  | Optional   | gRPC-Web baseline remains        |

The final matrix should name concrete version ranges rather than “latest.”

## 23. Alternatives considered

### 23.1 Copy JVM annotations and use runtime reflection

**Shape:** Methods carry attributes; runtime discovers and invokes them.

**Rejected as the main design because:** Rust does not have the required
general method reflection, it would discard compile-time information, and
generated direct adapters are safer and faster.

### 23.2 Scan Rust source like Spine TS scans TypeScript

**Shape:** A tool parses application `.rs` files and writes a registry.

**Rejected because:** standalone parsing cannot reliably reproduce Cargo
features, macro expansion, module/type resolution, or target configuration.
Rust compiler-integrated macros and trait checks already provide a better seam.

### 23.3 Pure trait implementation per handler

**Shape:** `impl Assign<CreateTask> for TaskAggregate` for every method.

**Advantages:** maximally explicit, excellent type checking, no method
attributes.

**Disadvantages:** high boilerplate, fragments one entity across many `impl`
blocks, and still requires an enumeration mechanism to create a registry.

**Disposition:** valuable reference design and possible advanced escape hatch;
not recommended as the ordinary application form.

### 23.4 One macro mini-language

```rust
spine::aggregate! {
    TaskAggregate: Task {
        assign create_task(CreateTask) -> TaskCreated { /* ... */ }
    }
}
```

**Advantages:** macro sees everything and can generate concise code.

**Disadvantages:** methods are no longer ordinary Rust syntax; rustfmt, IDEs,
documentation, refactoring, and error messages become harder; domain code is
locked into the macro grammar.

**Disposition:** reject for normal handler authoring.

### 23.5 Hidden Aggregate base field generated into the struct

```rust
#[spine::aggregate(state = Task)]
struct TaskAggregate;

// Macro secretly adds state so handlers can call self.update(...).
```

**Advantages:** resembles Spine JVM/TS and yields short methods.

**Disadvantages:** the authored struct is not the struct that exists; shared
dependencies and per-entity state become mixed; construction and concurrency
are magical; Rust has no protected inheritance model; macro expansion becomes
surprising.

**Disposition:** prefer explicit `CommandScope`/`EventScope`.

### 23.6 Put state directly in the user's struct

```rust
struct TaskAggregate {
    state: Task,
}
```

**Rejected because:** the runtime would need to construct/mutate arbitrary
application structs per entity; injected dependencies would be duplicated;
state/version/lifecycle ownership becomes unclear; concurrent reuse is harder.

### 23.7 Global linker registry (`inventory`-style)

**Shape:** Every handler contributes itself to a distributed static registry;
the context discovers it automatically.

**Advantages:** minimal context assembly.

**Disadvantages:** implicit membership, linker/target constraints, surprising
test contamination, hard dependency injection, dead-code/link behavior, and
runtime duplicate discovery.

**Disposition:** explicit `.add(...)` is clearer and more portable.

### 23.8 Async domain handlers

**Advantages:** convenient calls to databases and remote APIs from domain code.

**Disadvantages:** holds entity work across suspension, complicates retries and
borrows, introduces nondeterministic side effects, and makes transaction
latency unbounded.

**Disposition:** reject initially. Model external work through messages,
Process Managers, and adapters outside the state transition.

### 23.9 Manually authored dynamic registry

```rust
registry.assign::<CreateTask>("complete", |any, state| { /* ... */ });
```

**Rejected for normal use because:** repeats type metadata, encourages string
names and downcasts, and exposes dispatcher implementation. It may remain an
internal testing or migration interface.

### 23.10 Generate checked-in Rust source

**Advantages:** easy inspection and some IDE behavior; build does not require
generation when artifacts are present.

**Disadvantages:** large diffs, stale artifacts, generator-version drift, merge
conflicts, and duplicated source of truth.

**Disposition:** normal generation under `OUT_DIR`; provide an explicit
inspection command. Revisit only if packaging/offline constraints prove that
checked-in generated sources are necessary.

### 23.11 Infer all handler roles without method attributes

Input and output marker traits could infer many roles:

- command in + event out => assign;
- event in + command out => command reaction;
- event in + event out => react;
- event in + unit out => subscribe.

This is attractive but not complete: reactors may emit nothing, rejection
handling adds variants, and intent can be unclear. Explicit role markers improve
readability and diagnostics at a small syntax cost.

**Disposition:** keep role attributes.

## 24. Possible delivery sequence

This is a risk-reduction sequence, not an estimate or authorization to build.

### 24.1 Phase 0: architecture spike

Prove one vertical slice:

1. Compile the existing to-do Protobuf model and Spine custom options.
2. Generate Rust message roles, entity metadata, and exact type URLs.
3. Compile one `#[spine::assign]` Aggregate handler.
4. Execute command -> draft -> event -> current state in memory.
5. Expose the compatible command and query service over native gRPC.
6. Drive it from the existing TypeScript Node client.
7. Verify rejection rollback.
8. Measure clean/incremental builds and inspect IDE behavior.

The spike should be allowed to discard its code. Its deliverable is evidence
for runtime choice, macro shape, message ergonomics, and wire compatibility.

### 24.2 Phase 1: model and compile-time contracts

- Descriptor intake and custom options.
- Deterministic Cargo generation.
- Message/type registry and `Any`.
- Command/event/rejection/entity marker traits.
- Validation and transition metadata.
- Handler macro for Assign and Subscribe.
- Compile-fail diagnostics.

No production network server is needed until these contracts are stable.

### 24.3 Phase 2: in-process domain runtime

- Bounded context and explicit registration.
- Aggregate/Projection repositories.
- Framework-owned draft transaction.
- Command/event buses.
- Rejections and context metadata.
- In-memory storage.
- BlackBox in-process/public-service behavior.

### 24.4 Phase 3: compatible server and TS client proof

- Native gRPC services.
- Query and subscription service behavior.
- Server lifecycle and bounded queues.
- Existing TS client compatibility suite.
- JVM client compatibility subset.

### 24.5 Phase 4: durable SQL execution

- Versioned record schema/migrations.
- Atomic state/event/outbox commit.
- Query columns.
- Inbox/dedup/retry/fencing.
- Real database conformance/failure tests.
- Multi-process execution.

### 24.6 Phase 5: browser and deployment

- gRPC-Web baseline.
- Optional Connect optimization.
- Authentication/authorization gateway seams.
- CORS/body/time/stream bounds.
- Containers and orchestrator health/shutdown.
- Existing TS browser-client application proof.

### 24.7 Phase 6: broader parity

- Process Managers and durable handoffs if not earlier.
- External events/integration broker semantics.
- Additional storage adapters.
- Multi-node subscription propagation.
- Native Rust client.
- Advanced diagnostics and tooling.

Each phase should close one coherent behavioral boundary and add compatibility
tests. Avoid porting package-by-package while core transaction and type
contracts are unsettled.

## 25. Open questions

These questions should drive future Q&A. They are not incidental details.

### 25.1 Product and compatibility

1. Is the target “Spine TS semantics in Rust,” “Spine JVM semantics in Rust,”
   or a named reconciled subset?
2. Must the first server interoperate with JVM clients, TS clients, or both?
3. Which exact server/service versions define compatibility?
4. Is current-state Aggregate loading mandatory, or is event-sourced
   reconstruction desired?
5. Which delivery and subscription guarantees are required in the first useful
   release?

### 25.2 Handler interface

6. Is `#[spine::handlers(state = Task)]` the best outer spelling?
7. Should the outer attribute name the generated state type or a generated
   state descriptor constant?
8. Should handlers receive `&Command` or own `Command` by value?
9. Are `CommandScope` and `EventScope` the right names?
10. Should state ID be `scope.id()` or part of a more general entity view?
11. Should handler hosts always use `&self`, or are static associated functions
    better for empty hosts?
12. Should multiple annotated `impl` blocks per host be supported?
13. Which output shapes are supported without creating trait/coherence
    ambiguity?
14. How are several rejection types declared?
15. Is any class of async handler justified, and if so, what transaction rule
    contains it?

### 25.3 Model generation

16. `prost`, official Google Rust Protobuf, or another runtime?
17. How are required Protobuf fields made pleasant and safe in validated
    handlers?
18. Is `protoc` downloaded/pinned, embedded, system-provided, or replaced by a
    pure-Rust descriptor compiler?
19. How do imported model crates share descriptor and Rust type identity?
20. How are generated code/runtime version mismatches detected?
21. Which Spine custom options are required for milestone one?
22. Should generated model code live only in `OUT_DIR`, or should publishable
    model crates contain checked artifacts?

### 25.4 Runtime semantics

23. What is the exact durable atomic unit for accepted command execution?
24. When does command posting report success relative to handler completion,
    state commit, event persistence, and dispatch?
25. How are optimistic conflicts retried, bounded, and surfaced?
26. How are panics handled under unwind versus abort builds?
27. What are the exact guarantees for multiple emitted-event ordering?
28. Are Projection updates guaranteed at least once? How are they deduplicated?
29. What route syntax supports one-to-many routing without hiding allocations
    or ordering?
30. Which entity lifecycle operations are public to handlers?

### 25.5 Storage and deployment

31. Which durable provider is the first reference: PostgreSQL, MySQL, or
    another store?
32. Are third-party storage adapters a first-release extension requirement?
33. How are query-column schema migrations generated and applied?
34. What is the multi-node command serialization strategy?
35. What delivery system replaces or interoperates with the existing topology?
36. Is browser serving integrated into the Rust application process initially,
    or delegated to a standalone gateway?

### 25.6 Developer experience

37. What minimum supported Rust version is required?
38. What is the acceptable clean and incremental build-time budget?
39. Does rust-analyzer correctly expand and diagnose the chosen macros?
40. Which generated internals should be visible in rustdoc?
41. How does an application inspect its final handler and route plan?
42. How small can the public facade remain while allowing real extension?

## 26. Compact glossary

**Aggregate** — Entity that handles assigned commands, protects consistency for
one identity, changes current state, and emits events or rejections.

**Attribute** — Rust `#[...]` syntax. In this design, an input to compile-time
code generation, not passive runtime reflection metadata.

**BlackBox** — Test facade that exercises a bounded context through public
command/query/subscription behavior.

**Borrow** — Temporary reference to a value (`&T` or `&mut T`) checked by the
Rust compiler.

**Bounded context** — Named domain context containing registered entity
handlers, repositories, buses, model metadata, and selected storage.

**Build script** — Cargo's `build.rs`, compiled and run before the package; used
here for deterministic Protobuf/model generation.

**Command scope** — Proposed short-lived mutable capability containing one
entity draft and trusted command context during a command handler.

**Crate** — One compiled Rust library or executable target.

**Descriptor set** — Protobuf schema information used by code generators and
dynamic type registries.

**Entity state** — Protobuf message marked with a Spine entity kind and used as
the current stored state for an Aggregate, Projection, or Process Manager.

**Event scope** — Proposed short-lived mutable capability containing one entity
draft and trusted event context during an event handler.

**Handler host** — Application-authored Rust struct whose methods implement
domain behavior. Shared behavior/dependencies live here; per-entity state does
not.

**Marker trait** — Generated trait implementation proving a model role such as
command, event, rejection, or entity state.

**Process Manager** — Stateful entity coordinating a workflow by consuming and
emitting commands/events over time.

**Projection** — Entity maintaining query-visible read-side state from events.

**Procedural macro** — Rust compile-time program that consumes and produces
Rust syntax.

**Rejection** — Protobuf-modeled business fact explaining why a command was not
accepted; represented by the error side of a handler `Result`.

**Trait** — Rust declaration of behavior/capability used for generic checking
and polymorphism.

**Type URL** — Stable Protobuf identity used when packing a message into `Any`.
It comes from model metadata, not a Rust module path.

## 27. Reference material

### 27.1 Local Spine TS sources used for this draft

The following repository documents describe the current comparison point:

- `README.md` — framework overview and package map.
- `packages/server/README.md` — end-user server, Aggregate, context, and
  lifecycle examples.
- `docs/api/README.md` — generated handler registry, metadata, entity,
  transaction, bus, services, storage, delivery, and protocol details.
- `docs/architecture/README.md` — runtime architecture and transaction model.
- `docs/USER_GUIDE.md` — end-to-end application behavior.
- `examples/todo/` — Aggregate, Projection, typed rejection, context, server,
  and BlackBox example.
- `examples/message-board/` — browser/authenticated application example.
- `packages/server/src/handler/build-time-handler-analyzer.ts` — current TS
  decorator/type analysis.
- `packages/server/src/handler/generated-handler-registry.ts` — current logical
  generated-registry contract.
- `packages/server/src/handler/handler-decorators.ts` — decorator adapter.

These are evidence for concepts, not a command to copy every TS implementation
choice.

### 27.2 Rust and ecosystem references

- [Rust Reference: procedural macros](https://doc.rust-lang.org/stable/reference/procedural-macros.html)
  — compile-time token-stream transformation and attribute macros.
- [Cargo Book: build scripts](https://doc.rust-lang.org/cargo/reference/build-scripts.html)
  — `build.rs`, `OUT_DIR`, and change tracking.
- [prost-build documentation](https://docs.rs/prost-build/latest/prost_build/)
  — Rust Protobuf generation and descriptor-set compilation.
- [Tokio](https://tokio.rs/) — asynchronous runtime for native Rust network
  applications.
- [Tonic](https://docs.rs/tonic/latest/tonic/) — Rust gRPC implementation built
  on the Tokio/Hyper/Tower ecosystem.
- [Protocol Buffers Rust reference](https://protobuf.dev/reference/rust/) —
  official Rust generated-code and runtime design.

### 27.3 How a future Codex agent should treat this document

A future analysis agent should:

1. Treat every code example as a proposal unless labeled as existing behavior.
2. Verify Rust language/library feasibility against current primary
   documentation and a compiling spike.
3. Compare behavioral claims with the named Spine TS/JVM baseline rather than
   assuming this draft is authoritative.
4. Preserve the separation between shared handler host and per-entity mutable
   scope unless it presents and evaluates a better alternative.
5. Challenge unresolved items, especially Protobuf runtime choice,
   required-field ergonomics, persistence atomicity, and command acknowledgment
   semantics.
6. Prefer a minimal compiling vertical slice over designing all packages in the
   abstract.
7. Record decisions separately from hypotheses when this draft becomes a real
   specification.

---

## Working conclusion

The natural Rust projection of Spine is not “Java annotations with square
brackets.” It is:

- Protobuf descriptors generating model capabilities;
- an attribute macro converting ordinary Rust methods into typed adapters;
- Rust trait bounds proving handler roles;
- explicit bounded-context membership;
- short-lived scope values carrying state mutation authority;
- `Result` carrying domain rejections;
- async infrastructure surrounding synchronous domain transitions.

This shape preserves the part of Spine that matters—its domain model,
generated contracts, routing, transactional entity behavior, and client
protocol—while letting Rust enforce ownership and concurrency rules that JVM
reflection and TypeScript source analysis cannot express in the same way.
