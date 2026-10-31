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

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { AnySchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, it, vi } from "vitest";
import { AnyPacker, TypeRegistry, TypeUrls } from "@spine-event-engine/core";
import { Code } from "@connectrpc/connect";
import { ActorContextSchema } from "@spine-event-engine/proto";
import {
  AppQuerySchema,
  QuerySchema,
  TargetFiltersSchema,
  TargetSchema,
} from "@spine-event-engine/proto/client";
import { serverTestFixturesProtoModule } from "../../test-fixtures/generated/proto-module.js";
import { GetProjectOverview_QuerySchema } from "../../test-fixtures/generated/repository-routing/project_queries_pb.js";
import { ProjectIdSchema } from "../../test-fixtures/generated/repository-routing/project_identifiers_pb.js";
import {
  RegisteredProjectStateSchema,
  type RegisteredProjectState,
} from "../../test-fixtures/generated/repository-routing/project_states_pb.js";
import {
  ProjectIssueViewSchema,
  ProjectIssueSectionSchema,
  ProjectIssuesViewSchema,
  type ProjectIssueView,
  type ProjectIssuesView,
} from "../../test-fixtures/generated/repository-routing/project_issue_types_pb.js";
import { ReadSideFilter, type ReadSideContext } from "../../src/stand/read-side-filter.js";
import { ReadSideFilterEngine } from "../../src/stand/read-side-filter-engine.js";
import { ReadSideMessages } from "../../src/stand/read-side-message.js";

const registry = TypeRegistry.from(serverTestFixturesProtoModule);
const context: ReadSideContext = {
  operation: {
    kind: "direct",
    read: { typeUrl: TypeUrls.derive(ProjectIssueViewSchema), id: "issue-1" },
  },
};

const readonlyContextContract = (current: ReadSideContext): void => {
  if (current.operation.kind === "query" && current.operation.query.id) {
    // @ts-expect-error Query ID fields are read-only inside a filter.
    current.operation.query.id.value = "changed";
  }
  if (current.operation.kind === "app-query" && current.operation.appQuery.message) {
    // @ts-expect-error Packed request bytes are read-only inside a filter.
    current.operation.appQuery.message.value[0] = 0;
  }
  if (current.operation.kind === "history" && current.operation.history.source === "agent") {
    const { view, request } = current.operation.history;
    if (view.kind === "conversation") {
      // @ts-expect-error Nested conversation ID cannot be rewritten by a filter.
      view.conversation.value = "another-conversation";
    }
    if (request.cursor) {
      const cursorCopy = request.cursor.value.slice();
      void cursorCopy;
      // @ts-expect-error Nested cursor bytes cannot be rewritten by a filter.
      request.cursor.value[0] = 0;
    }
  }
};
void readonlyContextContract;

describe("ReadSideFilter", () => {
  it("preserves an uninspected unknown Event payload but rejects it when nested inspection is requested", async () => {
    class StateOnly extends ReadSideFilter<typeof ProjectIssueViewSchema> {
      constructor(nested: boolean) {
        super(ProjectIssueViewSchema, { nested });
      }
      filter(issue: ProjectIssueView): ProjectIssueView {
        return issue;
      }
    }
    const unknown = create(AnySchema, {
      typeUrl: "type.spine.io/example.UnknownEvent",
      value: new Uint8Array([8, 1]),
    });
    const retained = await new ReadSideFilterEngine([new StateOnly(false)], registry).applyPacked(
      unknown,
      context,
    );
    expect(retained).toEqual(unknown);
    expect(retained).not.toBe(unknown);
    await expect(
      new ReadSideFilterEngine([new StateOnly(true)], registry).applyPacked(unknown, context),
    ).rejects.toThrow("not registered");
  });
  it("passes a typed detached root through registered filters in order", async () => {
    const calls: string[] = [];
    class Rename extends ReadSideFilter<typeof ProjectIssueViewSchema> {
      constructor(private readonly suffix: string) {
        super(ProjectIssueViewSchema);
      }
      filter(issue: ProjectIssueView): ProjectIssueView {
        calls.push(issue.title);
        issue.title += this.suffix;
        return issue;
      }
    }
    const input = create(ProjectIssueViewSchema, { id: "issue-1", title: "Open" });
    const output = await new ReadSideFilterEngine(
      [new Rename("!"), new Rename("?")],
      registry,
    ).apply(ProjectIssueViewSchema, input, context);
    expect(calls).toEqual(["Open", "Open!"]);
    expect(output?.title).toBe("Open!?");
    expect(input.title).toBe("Open");
  });

  it("rejects a root schema absent from the ordinary type registry", async () => {
    const incomplete = new TypeRegistry();
    incomplete.register(ProjectIssueViewSchema);
    await expect(
      new ReadSideFilterEngine([], incomplete).apply(
        ProjectIssuesViewSchema,
        create(ProjectIssuesViewSchema, { projectId: "project-unregistered" }),
        context,
      ),
    ).rejects.toThrow("not registered");
  });

  it("matches nested domain messages only when the filter opts in", async () => {
    class Hide extends ReadSideFilter<typeof ProjectIssueViewSchema> {
      constructor(nested: boolean) {
        super(ProjectIssueViewSchema, { nested });
      }
      filter(issue: ProjectIssueView): ProjectIssueView {
        issue.title = "Hidden";
        return issue;
      }
    }
    const source = create(ProjectIssuesViewSchema, {
      projectId: "project-1",
      primary: create(ProjectIssueViewSchema, { id: "issue-1", title: "Visible" }),
    });
    const rootOnly = await new ReadSideFilterEngine([new Hide(false)], registry).apply(
      ProjectIssuesViewSchema,
      source,
      context,
    );
    const nested = await new ReadSideFilterEngine([new Hide(true)], registry).apply(
      ProjectIssuesViewSchema,
      source,
      context,
    );
    expect(rootOnly?.primary?.title).toBe("Visible");
    expect(nested?.primary?.title).toBe("Hidden");
    expect(source.primary?.title).toBe("Visible");
  });

  it("visits replacement children through intermediates and freezes parent snapshots", async () => {
    const seen: string[] = [];
    class ReplaceProject extends ReadSideFilter<typeof ProjectIssuesViewSchema> {
      constructor() {
        super(ProjectIssuesViewSchema);
      }
      filter(view: ProjectIssuesView): ProjectIssuesView {
        return create(ProjectIssuesViewSchema, {
          projectId: view.projectId,
          section: create(ProjectIssueSectionSchema, {
            issue: create(ProjectIssueViewSchema, { id: "added", title: "New" }),
          }),
        });
      }
    }
    class InspectIssue extends ReadSideFilter<typeof ProjectIssueViewSchema> {
      constructor() {
        super(ProjectIssueViewSchema, { nested: true });
      }
      filter(issue: ProjectIssueView, nested: ReadSideContext): ProjectIssueView {
        seen.push(`${nested.field?.name ?? ""}:${issue.id}`);
        expect(Object.isFrozen(nested.parent)).toBe(true);
        expect(() => {
          (nested.parent as unknown as { issue: unknown }).issue = undefined;
        }).toThrow();
        issue.title = "Reviewed";
        return issue;
      }
    }
    const input = create(ProjectIssuesViewSchema, { projectId: "project-1" });
    const result = await new ReadSideFilterEngine(
      [new ReplaceProject(), new InspectIssue()],
      registry,
    ).apply(ProjectIssuesViewSchema, input, context);
    expect(seen).toEqual(["issue:added"]);
    expect(result?.section?.issue?.title).toBe("Reviewed");
    expect(input.section).toBeUndefined();
  });

  it("removes singular, list, map, and active oneof children without pruning the parent", async () => {
    const seen: string[] = [];
    class RemoveIssue extends ReadSideFilter<typeof ProjectIssueViewSchema> {
      constructor() {
        super(ProjectIssueViewSchema, { nested: true });
      }
      filter(issue: ProjectIssueView, nested: ReadSideContext): ProjectIssueView | null {
        seen.push(
          `${nested.field?.name ?? ""}:${String(nested.field?.index ?? nested.field?.key ?? "one")}:${issue.id}`,
        );
        return issue.id.startsWith("hide") ? null : issue;
      }
    }
    const issue = (id: string) => create(ProjectIssueViewSchema, { id, title: id });
    const source = create(ProjectIssuesViewSchema, {
      projectId: "project-2",
      primary: issue("hide-primary"),
      issues: [issue("keep-0"), issue("hide-1"), issue("keep-2")],
      issueByKey: { zebra: issue("keep-z"), alpha: issue("hide-a") },
      featured: { case: "featuredIssue", value: issue("hide-featured") },
    });
    const result = await new ReadSideFilterEngine([new RemoveIssue()], registry).apply(
      ProjectIssuesViewSchema,
      source,
      context,
    );
    expect(result?.projectId).toBe("project-2");
    expect(result?.primary).toBeUndefined();
    expect(result?.issues.map((value) => value.id)).toEqual(["keep-0", "keep-2"]);
    expect(Object.keys(result?.issueByKey ?? {})).toEqual(["zebra"]);
    expect(result?.featured.case).toBeUndefined();
    expect(seen).toEqual([
      "primary:one:hide-primary",
      "issues:0:keep-0",
      "issues:1:hide-1",
      "issues:2:keep-2",
      "issue_by_key:alpha:hide-a",
      "issue_by_key:zebra:keep-z",
      "featured_issue:one:hide-featured",
    ]);
    expect(source.issues).toHaveLength(3);
    expect(source.featured.case).toBe("featuredIssue");
  });

  it("preserves a selected scalar oneof while inspecting other nested children", async () => {
    class Inspect extends ReadSideFilter<typeof ProjectIssueViewSchema> {
      constructor() {
        super(ProjectIssueViewSchema, { nested: true });
      }
      filter(issue: ProjectIssueView): ProjectIssueView {
        issue.title = "Visible";
        return issue;
      }
    }
    const source = create(ProjectIssuesViewSchema, {
      projectId: "project-label",
      primary: create(ProjectIssueViewSchema, { id: "issue-label" }),
      featured: { case: "featuredLabel", value: "Priority" },
    });
    const result = await new ReadSideFilterEngine([new Inspect()], registry).apply(
      ProjectIssuesViewSchema,
      source,
      context,
    );
    expect(result?.featured).toEqual({ case: "featuredLabel", value: "Priority" });
    expect(result?.primary?.title).toBe("Visible");
  });

  it("decodes known Any, retains its exact registered URL, and rejects unknown or malformed inspection", async () => {
    const custom = new TypeRegistry();
    custom.register(ProjectIssuesViewSchema);
    custom.register(ProjectIssueViewSchema, {
      typeUrl: "custom.example/repository_routing.ProjectIssueView",
    });
    custom.register(AnySchema);
    class Redact extends ReadSideFilter<typeof ProjectIssueViewSchema> {
      constructor() {
        super(ProjectIssueViewSchema, { nested: true });
      }
      filter(issue: ProjectIssueView): ProjectIssueView {
        issue.title = "Redacted";
        return issue;
      }
    }
    const payload = create(ProjectIssueViewSchema, { id: "issue-3", title: "Private" });
    const packed = create(AnySchema, {
      typeUrl: "custom.example/repository_routing.ProjectIssueView",
      value: toBinary(ProjectIssueViewSchema, payload),
    });
    const input = create(ProjectIssuesViewSchema, { projectId: "project-3", attachment: packed });
    const filtered = await new ReadSideFilterEngine([new Redact()], custom).apply(
      ProjectIssuesViewSchema,
      input,
      context,
    );
    expect(filtered?.attachment?.typeUrl).toBe(packed.typeUrl);
    if (filtered?.attachment === undefined) throw new Error("Expected filtered attachment.");
    expect(AnyPacker.unpackUsing(custom, filtered.attachment) as ProjectIssueView).toMatchObject({
      title: "Redacted",
    });
    if (input.attachment === undefined) throw new Error("Expected source attachment.");
    expect(AnyPacker.unpackUsing(custom, input.attachment) as ProjectIssueView).toMatchObject({
      title: "Private",
    });
    await expect(
      new ReadSideFilterEngine([new Redact()], custom).apply(
        ProjectIssuesViewSchema,
        create(ProjectIssuesViewSchema, {
          attachment: create(AnySchema, { typeUrl: "unknown/Issue" }),
        }),
        context,
      ),
    ).rejects.toThrow("Unregistered nested Any");
    await expect(
      new ReadSideFilterEngine([new Redact()], custom).apply(
        ProjectIssuesViewSchema,
        create(ProjectIssuesViewSchema, {
          attachment: create(AnySchema, { typeUrl: packed.typeUrl, value: new Uint8Array([255]) }),
        }),
        context,
      ),
    ).rejects.toThrow();
    const untouched = await new ReadSideFilterEngine([], custom).apply(
      ProjectIssuesViewSchema,
      create(ProjectIssuesViewSchema, {
        attachment: create(AnySchema, { typeUrl: "unknown/Issue" }),
      }),
      context,
    );
    expect(untouched?.attachment?.typeUrl).toBe("unknown/Issue");
  });

  it("removes decoded Any payloads from singular, repeated, and map containers", async () => {
    class RemovePackedIssue extends ReadSideFilter<typeof ProjectIssueViewSchema> {
      constructor() {
        super(ProjectIssueViewSchema, { nested: true });
      }
      filter(issue: ProjectIssueView): ProjectIssueView | null {
        return issue.id === "hidden" ? null : issue;
      }
    }
    const packed = (id: string) =>
      AnyPacker.pack(ProjectIssueViewSchema, create(ProjectIssueViewSchema, { id }));
    const source = create(ProjectIssuesViewSchema, {
      projectId: "project-packed",
      attachment: packed("hidden"),
      attachments: [packed("visible"), packed("hidden"), packed("visible-2")],
      attachmentByKey: { b: packed("visible"), a: packed("hidden") },
    });
    const result = await new ReadSideFilterEngine([new RemovePackedIssue()], registry).apply(
      ProjectIssuesViewSchema,
      source,
      context,
    );
    expect(result?.projectId).toBe("project-packed");
    expect(result?.attachment).toBeUndefined();
    expect(result?.attachments).toHaveLength(2);
    expect(Object.keys(result?.attachmentByKey ?? {})).toEqual(["b"]);
    expect(source.attachment).toBeDefined();
    expect(source.attachments).toHaveLength(3);
  });

  it("isolates parent Any bytes and application-query bytes between callbacks and siblings", async () => {
    const packed = (id: string) =>
      AnyPacker.pack(ProjectIssueViewSchema, create(ProjectIssueViewSchema, { id }));
    const request = create(AppQuerySchema, {
      id: { value: "q-issue-view" },
      context: create(ActorContextSchema, {
        actor: { value: "reader-1" },
        timestamp: create(TimestampSchema, { seconds: 1n }),
      }),
      message: AnyPacker.pack(
        GetProjectOverview_QuerySchema,
        create(GetProjectOverview_QuerySchema, {
          project: create(ProjectIdSchema, { value: "project-1" }),
        }),
      ),
    });
    const requestMessage = request.message;
    if (requestMessage === undefined) throw new Error("Expected application query payload.");
    const expectedQueryByte = requestMessage.value[0];
    const expectedParentBytes = [packed("one").value[0], packed("two").value[0]];
    const seen: number[] = [];
    class CorruptSnapshot extends ReadSideFilter<typeof ProjectIssueViewSchema> {
      constructor() {
        super(ProjectIssueViewSchema, { nested: true });
      }
      filter(issue: ProjectIssueView, current: ReadSideContext): ProjectIssueView {
        const parent = current.parent as unknown as { value: Uint8Array };
        parent.value[0] = 0;
        if (current.operation.kind === "app-query") {
          const message = current.operation.appQuery.message;
          if (message === undefined) throw new Error("Expected application query payload.");
          (message.value as Uint8Array)[0] = 0;
        }
        return issue;
      }
    }
    class InspectSnapshot extends ReadSideFilter<typeof ProjectIssueViewSchema> {
      constructor() {
        super(ProjectIssueViewSchema, { nested: true });
      }
      filter(issue: ProjectIssueView, current: ReadSideContext): ProjectIssueView {
        const parent = current.parent as unknown as { value: Uint8Array };
        seen.push(parent.value[0] ?? -1);
        expect(current.operation.kind).toBe("app-query");
        if (current.operation.kind === "app-query") {
          const message = current.operation.appQuery.message;
          if (message === undefined) throw new Error("Expected application query payload.");
          expect(message.value[0]).toBe(expectedQueryByte);
          expect(
            fromBinary(GetProjectOverview_QuerySchema, message.value.slice()).project?.value,
          ).toBe("project-1");
        }
        return issue;
      }
    }
    const input = create(ProjectIssuesViewSchema, {
      projectId: "project-1",
      attachments: [packed("one"), packed("two")],
    });
    await new ReadSideFilterEngine([new CorruptSnapshot(), new InspectSnapshot()], registry).apply(
      ProjectIssuesViewSchema,
      input,
      { operation: { kind: "app-query", appQuery: request } },
    );
    expect(seen).toEqual(expectedParentBytes);
    expect(requestMessage.value[0]).toBe(expectedQueryByte);
  });

  it("shows later siblings the parent before earlier child edits", async () => {
    class RenameIssue extends ReadSideFilter<typeof ProjectIssueViewSchema> {
      constructor() {
        super(ProjectIssueViewSchema, { nested: true });
      }
      filter(issue: ProjectIssueView, current: ReadSideContext): ProjectIssueView {
        if (issue.id === "second") {
          const parent = current.parent as ProjectIssuesView;
          expect(parent.issues[0]?.title).toBe("First original");
        }
        issue.title = "Visible";
        return issue;
      }
    }
    const result = await new ReadSideFilterEngine([new RenameIssue()], registry).apply(
      ProjectIssuesViewSchema,
      create(ProjectIssuesViewSchema, {
        projectId: "project-siblings",
        issues: [
          create(ProjectIssueViewSchema, { id: "first", title: "First original" }),
          create(ProjectIssueViewSchema, { id: "second", title: "Second original" }),
        ],
      }),
      context,
    );
    expect(result?.issues.map((issue) => issue.title)).toEqual(["Visible", "Visible"]);
  });

  it("keeps a real entity Query's packed ID bytes stable across root callbacks", async () => {
    const id = create(ProjectIdSchema, { value: "project-1" });
    const query = create(QuerySchema, {
      id: { value: "q-project-1" },
      context: create(ActorContextSchema, {
        actor: { value: "reader-1" },
        timestamp: create(TimestampSchema, { seconds: 1n }),
      }),
      target: create(TargetSchema, {
        type: TypeUrls.derive(RegisteredProjectStateSchema),
        criterion: {
          case: "filters",
          value: create(TargetFiltersSchema, {
            idFilter: { id: [AnyPacker.pack(ProjectIdSchema, id)] },
          }),
        },
      }),
    });
    const selected = query.target?.criterion;
    if (selected?.case !== "filters") throw new Error("Expected ID-filtered entity Query.");
    const expected = selected.value.idFilter?.id[0]?.value[0];
    class CorruptQuery extends ReadSideFilter<typeof RegisteredProjectStateSchema> {
      constructor() {
        super(RegisteredProjectStateSchema);
      }
      filter(state: RegisteredProjectState, current: ReadSideContext): RegisteredProjectState {
        if (current.operation.kind === "query") {
          const target = current.operation.query.target;
          const criterion = target?.criterion;
          if (criterion?.case === "filters") {
            const bytes = criterion.value.idFilter?.id[0]?.value as Uint8Array | undefined;
            if (bytes !== undefined) bytes[0] = 0;
          }
        }
        return state;
      }
    }
    class InspectQuery extends ReadSideFilter<typeof RegisteredProjectStateSchema> {
      constructor() {
        super(RegisteredProjectStateSchema);
      }
      filter(state: RegisteredProjectState, current: ReadSideContext): RegisteredProjectState {
        expect(current.operation.kind).toBe("query");
        if (current.operation.kind === "query") {
          const criterion = current.operation.query.target?.criterion;
          expect(criterion?.case).toBe("filters");
          if (criterion?.case === "filters")
            expect(criterion.value.idFilter?.id[0]?.value[0]).toBe(expected);
        }
        return state;
      }
    }
    await new ReadSideFilterEngine([new CorruptQuery(), new InspectQuery()], registry).apply(
      RegisteredProjectStateSchema,
      create(RegisteredProjectStateSchema, { id, name: "Project One" }),
      { operation: { kind: "query", query } },
    );
    expect(selected.value.idFilter?.id[0]?.value[0]).toBe(expected);
  });

  it("avoids parent-subtree copies when nested filters do not match descendants", async () => {
    const first = create(ProjectIssueViewSchema, { id: "first" });
    let current = first;
    for (let index = 0; index < 2_000; index++) {
      current.related = create(ProjectIssueViewSchema, { id: `issue-${String(index)}` });
      current = current.related;
    }
    class ObserveProject extends ReadSideFilter<typeof ProjectIssuesViewSchema> {
      constructor() {
        super(ProjectIssuesViewSchema, { nested: true });
      }
      filter(view: ProjectIssuesView): ProjectIssuesView {
        return view;
      }
    }
    const copy = vi.spyOn(ReadSideMessages, "copy");
    try {
      const result = await new ReadSideFilterEngine([new ObserveProject()], registry).apply(
        ProjectIssuesViewSchema,
        create(ProjectIssuesViewSchema, { projectId: "project-deep", primary: first }),
        context,
      );
      expect(result?.primary?.id).toBe("first");
      expect(copy.mock.calls.length).toBeLessThan(20);
    } finally {
      copy.mockRestore();
    }
  });

  it("isolates retained callback objects and concurrent readers", async () => {
    const retained: ProjectIssueView[] = [];
    class Capture extends ReadSideFilter<typeof ProjectIssueViewSchema> {
      constructor() {
        super(ProjectIssueViewSchema);
      }
      async filter(issue: ProjectIssueView): Promise<ProjectIssueView> {
        retained.push(issue);
        await Promise.resolve();
        issue.title = `${issue.title}:visible`;
        return issue;
      }
    }
    const source = create(ProjectIssueViewSchema, { id: "shared", title: "Original" });
    const engine = new ReadSideFilterEngine([new Capture()], registry);
    const [first, second] = await Promise.all([
      engine.apply(ProjectIssueViewSchema, source, context),
      engine.apply(ProjectIssueViewSchema, source, context),
    ]);
    const captured = retained[0];
    if (captured === undefined) throw new Error("Expected captured filter argument.");
    captured.title = "Changed later";
    expect(first?.title).toBe("Original:visible");
    expect(second?.title).toBe("Original:visible");
    expect(source.title).toBe("Original");
  });

  it("snapshots verified reader facts before an awaited filter resumes", async () => {
    const facts = { policy: { roles: ["reader"], enabled: true } };
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    class Inspect extends ReadSideFilter<typeof ProjectIssueViewSchema> {
      constructor() {
        super(ProjectIssueViewSchema);
      }
      async filter(issue: ProjectIssueView, current: ReadSideContext): Promise<ProjectIssueView> {
        await waiting;
        expect(current.principal?.id).toBe("reader-1");
        expect(current.authorityFacts?.policy).toEqual({ roles: ["reader"], enabled: true });
        expect(Object.isFrozen(current.authorityFacts?.policy)).toBe(true);
        return issue;
      }
    }
    const pending = new ReadSideFilterEngine([new Inspect()], registry).apply(
      ProjectIssueViewSchema,
      create(ProjectIssueViewSchema, { id: "issue-context" }),
      {
        operation: {
          kind: "direct",
          read: { typeUrl: TypeUrls.derive(ProjectIssueViewSchema), id: "issue-1" },
        },
        principal: { id: "reader-1" },
        authorityFacts: facts,
      },
    );
    facts.policy.roles.push("admin");
    release();
    await expect(pending).resolves.toMatchObject({ id: "issue-context" });
  });

  it("rejects wrong replacement types, cyclic values, and canceled continuation", async () => {
    class Wrong extends ReadSideFilter<typeof ProjectIssueViewSchema> {
      constructor() {
        super(ProjectIssueViewSchema);
      }
      filter(): ProjectIssueView {
        return create(ProjectIssuesViewSchema) as unknown as ProjectIssueView;
      }
    }
    const issue = create(ProjectIssueViewSchema, { id: "issue-4" });
    await expect(
      new ReadSideFilterEngine([new Wrong()], registry).apply(
        ProjectIssueViewSchema,
        issue,
        context,
      ),
    ).rejects.toThrow("returned");
    class Malformed extends ReadSideFilter<typeof ProjectIssueViewSchema> {
      constructor() {
        super(ProjectIssueViewSchema);
      }
      filter(value: ProjectIssueView): ProjectIssueView {
        (value as unknown as { title: unknown }).title = () => "unserializable";
        return value;
      }
    }
    await expect(
      new ReadSideFilterEngine([new Malformed()], registry).apply(
        ProjectIssueViewSchema,
        issue,
        context,
      ),
    ).rejects.toThrow("unserializable");
    const cyclic = create(ProjectIssueViewSchema, { id: "cyclic" });
    cyclic.related = cyclic;
    await expect(
      new ReadSideFilterEngine([], registry).apply(ProjectIssueViewSchema, cyclic, context),
    ).rejects.toThrow("Cyclic");
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const controller = new AbortController();
    class Wait extends ReadSideFilter<typeof ProjectIssueViewSchema> {
      constructor() {
        super(ProjectIssueViewSchema);
      }
      async filter(value: ProjectIssueView): Promise<ProjectIssueView> {
        await waiting;
        return value;
      }
    }
    const pending = new ReadSideFilterEngine([new Wait()], registry).apply(
      ProjectIssueViewSchema,
      issue,
      { ...context, signal: controller.signal },
    );
    controller.abort();
    release();
    await expect(pending).rejects.toMatchObject({ code: Code.Canceled });
  });

  it("traverses a deep valid chain without call-stack recursion", async () => {
    const first = create(ProjectIssueViewSchema, { id: "start" });
    let current = first;
    for (let index = 0; index < 2_000; index++) {
      current.related = create(ProjectIssueViewSchema, { id: `issue-${String(index)}` });
      current = current.related;
    }
    const result = await new ReadSideFilterEngine([], registry).apply(
      ProjectIssueViewSchema,
      first,
      context,
    );
    expect(result?.related?.id).toBe("issue-0");
    expect(current.id).toBe("issue-1999");
  });

  it("visits a deep nested chain in order without recursion", async () => {
    const first = create(ProjectIssueViewSchema, { id: "root" });
    let current = first;
    for (let index = 0; index < 300; index++) {
      current.related = create(ProjectIssueViewSchema, { id: `child-${String(index)}` });
      current = current.related;
    }
    const visited: string[] = [];
    class Observe extends ReadSideFilter<typeof ProjectIssueViewSchema> {
      constructor() {
        super(ProjectIssueViewSchema, { nested: true });
      }
      filter(issue: ProjectIssueView, nested: ReadSideContext): ProjectIssueView {
        visited.push(issue.id);
        if (issue.id !== "root") expect(nested.field?.name).toBe("related");
        return issue;
      }
    }
    const result = await new ReadSideFilterEngine([new Observe()], registry).apply(
      ProjectIssueViewSchema,
      first,
      context,
    );
    expect(visited).toHaveLength(301);
    expect(visited.at(-1)).toBe("child-299");
    expect(result?.related?.id).toBe("child-0");
  });
});
