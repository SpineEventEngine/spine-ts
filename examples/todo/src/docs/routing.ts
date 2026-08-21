import { EventRouting } from "@spine-event-engine/server";
import type { UserId } from "@spine-event-engine/proto";

import { TaskReassignedSchema } from "../../generated/spine/examples/todo/task_events_pb.js";
import type { TaskListId } from "../../generated/spine/examples/todo/task_id_pb.js";
import { TaskAssignmentEvent as TaskAssignmentEventToken } from "../../generated/interfaces/task-assignment-event.js";
import { TaskEvent } from "../../generated/interfaces/task-event.js";

const taskListRouting = EventRouting.create<TaskListId>().route(TaskEvent, (event) =>
  event.taskListId === undefined ? [] : [event.taskListId],
);
const assigneeRouting = EventRouting.create<UserId>()
  .route(TaskAssignmentEventToken, (event) =>
    event.assignee === undefined ? [] : [event.assignee],
  )
  .route(TaskReassignedSchema, (event) =>
    event.previousAssignee === undefined || event.assignee === undefined
      ? []
      : [event.previousAssignee, event.assignee],
  );

void taskListRouting;
void assigneeRouting;
