import { create } from "@bufbuild/protobuf";

import { TaskCreatedSchema } from "../../generated/spine/examples/todo/task_events_pb.js";
import { TaskIdSchema, TaskListIdSchema } from "../../generated/spine/examples/todo/task_id_pb.js";

function createTask(id: string, taskListId: string, title: string) {
  return create(TaskCreatedSchema, {
    id: create(TaskIdSchema, { value: id }),
    taskListId: create(TaskListIdSchema, { value: taskListId }),
    title,
  });
}

void createTask;
