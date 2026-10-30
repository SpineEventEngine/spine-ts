import { create } from "@bufbuild/protobuf";
import type { AppQueryResponseFor } from "@spine-event-engine/core";
import { GetProjectOverview } from "../../../test-fixtures/generated/repository-routing/project_queries_app_query.js";

const query: GetProjectOverview.Query = create(GetProjectOverview.querySchema);
const response: AppQueryResponseFor<typeof query> = create(GetProjectOverview.responseSchema);
void query;
void response;
