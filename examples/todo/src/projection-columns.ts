import { ProjectionColumn, type ProjectionColumns } from "@spine-ts/client";

import { TaskListColumnDefinition } from "../generated/spine/example/todo/v1/task_list_columns.js";
import { TaskListSchema } from "../generated/spine/example/todo/v1/task_list_pb.js";

/** Typed query columns generated for the to-do TaskList Projection. */
export const TaskListColumns: ProjectionColumns<
  typeof TaskListSchema,
  (typeof TaskListColumnDefinition)["entries"]
> = ProjectionColumn.register(TaskListSchema, TaskListColumnDefinition);
