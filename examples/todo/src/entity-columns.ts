import { EntityColumn, type EntityColumns } from "@spine-event-engine/client-node";

import { TaskListColumnDefinition } from "../generated/spine/example/todo/v1/task_list_columns.js";
import { TaskListSchema } from "../generated/spine/example/todo/v1/task_list_pb.js";

/** Typed query columns generated for the to-do TaskList Projection. */
export const TaskListColumns: EntityColumns<
  typeof TaskListSchema,
  (typeof TaskListColumnDefinition)["entries"]
> = EntityColumn.register(TaskListSchema, TaskListColumnDefinition);
